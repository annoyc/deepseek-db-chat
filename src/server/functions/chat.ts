import { createServerFn } from '@tanstack/react-start'
import { startActiveObservation, propagateAttributes } from '@langfuse/tracing'
import { createDbAgent } from '@/server/agent'
import { TOOL_ERROR_PREFIX, type ResultStore } from '@/server/tools'
import { decrypt } from '@/server/crypto'
import { langfuseSpanProcessor, flushTraces, resolveUserId } from '@/server/langfuse'
import type { DatabaseConnection, StreamChunk, ExecutionLogEntry } from '@/lib/types'

interface ChatInput {
  connection: DatabaseConnection
  message: string
  history?: { role: 'user' | 'assistant'; content: string }[]
  provider?: string
  model?: string
  apiKey?: string
  baseURL?: string
  thinkingMode?: 'enabled' | 'disabled'
  reasoningEffort?: 'high' | 'max'
  sqlPermission?: 'readonly' | 'write'
  executionLog?: ExecutionLogEntry[]
  lastConfirmedSql?: string
  sqlExecutedCount?: number
  maxSqlExecutions?: number
  sessionId?: string
}

function drainToolResults(
  pendingNames: string[],
  resultStore: ResultStore,
  encoder: TextEncoder,
  controller: ReadableStreamDefaultController,
): string | undefined {
  let smartFilterResult: string | undefined
  for (const name of pendingNames) {
    const queue = resultStore.get(name)
    const result = queue?.shift() ?? ''
    if (queue?.length === 0) resultStore.delete(name)
    if (name === 'smart_filter') smartFilterResult = result
    const isError = result.startsWith(TOOL_ERROR_PREFIX)
    const isSmartFilter = name === 'smart_filter'
    const displayResult = (name === 'execute_sql' || isSmartFilter) ? '' : (isError ? result.slice(TOOL_ERROR_PREFIX.length) : result)
    const chunk: StreamChunk = isError
      ? { type: 'tool-call-end', name, result: '', error: displayResult }
      : { type: 'tool-call-end', name, result: displayResult }
    controller.enqueue(encoder.encode(formatSSE(chunk)))
  }
  return smartFilterResult
}

export const chatStream = createServerFn({ method: 'POST' })
  .inputValidator((data: ChatInput) => data)
  .handler(
    async ({ data }): Promise<Response> => {
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()

        const runChat = async () => {
          try {
            const decryptedConnection: DatabaseConnection = {
              ...data.connection,
              password: decrypt(data.connection.password),
            }
            const decryptedApiKey = data.apiKey ? decrypt(data.apiKey) : undefined
            const effectiveSqlPermission = decryptedConnection.env === 'prod' ? 'readonly' : data.sqlPermission
            const { agent, resultStore } = createDbAgent(decryptedConnection, {
              provider: data.provider as any,
              model: data.model,
              apiKey: decryptedApiKey,
              baseURL: data.baseURL,
              thinkingMode: data.thinkingMode,
              reasoningEffort: data.reasoningEffort,
              sqlPermission: effectiveSqlPermission,
              executionLog: data.executionLog,
              lastConfirmedSql: data.lastConfirmedSql,
              sqlExecutedCount: data.sqlExecutedCount,
              maxSqlExecutions: data.maxSqlExecutions,
            })
            const agentStream = agent.stream({
              prompt: data.message,
              messages: data.history as any,
            })

            let pendingToolNames: string[] = []
            let executeSqlDetected = false
            let smartFilterDetected = false
            let shouldBreak = false

            for await (const event of agentStream) {
              let chunk: StreamChunk | null = null

              switch (event.type) {
                case 'reasoning-delta':
                  chunk = { type: 'thinking', content: event.reasoningDelta }
                  break

                case 'text-delta':
                  chunk = { type: 'text', content: event.textDelta }
                  break

                case 'tool-call': {
                  for (const tc of event.toolCalls) {
                    let args: Record<string, unknown> = {}
                    try {
                      args = JSON.parse(tc.function.arguments || '{}')
                    } catch (err) { console.warn('[chat] Failed to parse tool call args:', err) }
                    const name = tc.function.name
                    pendingToolNames.push(name)
                    controller.enqueue(encoder.encode(formatSSE({ type: 'tool-call-start', name, args })))
                    if (name === 'execute_sql') {
                      executeSqlDetected = true
                    }
                    if (name === 'smart_filter') {
                      smartFilterDetected = true
                    }
                  }
                  break
                }

                case 'step': {
                  const smartFilterResult = drainToolResults(pendingToolNames, resultStore, encoder, controller)

                  if (smartFilterDetected && smartFilterResult) {
                    try {
                      let suggestedFilters: Record<string, unknown>[] = []
                      if (!smartFilterResult.startsWith(TOOL_ERROR_PREFIX)) {
                        const parsed = JSON.parse(smartFilterResult)
                        suggestedFilters = parsed.filters ?? []
                      }
                      controller.enqueue(encoder.encode(formatSSE({
                        type: 'smart-filter-confirm',
                        suggestedFilters: suggestedFilters as any,
                      })))
                    } catch (err) {
                      console.warn('[chat] Smart filter parsing failed:', err)
                      controller.enqueue(encoder.encode(formatSSE({
                        type: 'smart-filter-confirm',
                        suggestedFilters: [],
                      })))
                    }
                    shouldBreak = true
                  }

                  pendingToolNames = []
                  break
                }

                case 'finish':
                  break
              }

              if (chunk) {
                controller.enqueue(encoder.encode(formatSSE(chunk)))
              }

              if (executeSqlDetected || shouldBreak) break
            }

            drainToolResults(pendingToolNames, resultStore, encoder, controller)
            controller.enqueue(encoder.encode(formatSSE({ type: 'finish' })))
          } catch (err) {
            console.error('[chat] Agent stream error:', err)
            const msg = 'AI 服务异常，请检查 API Key 是否正确'
            controller.enqueue(encoder.encode(formatSSE({ type: 'error', message: msg })))
          } finally {
            controller.close()
            await flushTraces()
          }
        }

        if (langfuseSpanProcessor) {
          const userId = resolveUserId()
          await startActiveObservation('chat', async (span) => {
            span.update({
              input: { message: data.message.slice(0, 500) },
              metadata: { provider: data.provider, model: data.model, database: data.connection.database },
            })
            await propagateAttributes({
              userId,
              sessionId: data.sessionId,
              tags: ['chat'],
              traceName: 'chat',
            }, runChat)
          })
        } else {
          await runChat()
        }
      },
    })

    return new Response(stream, { headers: sseHeaders() })
  }
)

function sseHeaders(): HeadersInit {
  return {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  }
}

function formatSSE(data: StreamChunk): string {
  return `data: ${JSON.stringify(data)}\n\n`
}
