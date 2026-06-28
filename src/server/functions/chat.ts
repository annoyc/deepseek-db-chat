import { createServerFn } from '@tanstack/react-start'
import { startActiveObservation, propagateAttributes } from '@langfuse/tracing'
import { createDbAgent } from '@/server/agent'
import { classifyIntentWithLLM } from '@/server/intent-router'
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
  isContinuation?: boolean
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
    const isReportAnalysis = name === 'report_analysis'
    const displayResult = (name === 'execute_sql' || isSmartFilter || isReportAnalysis) ? '' : (isError ? result.slice(TOOL_ERROR_PREFIX.length) : result)

    // Emit structured analysis report as a dedicated stream event
    if (isReportAnalysis && !isError && result) {
      try {
        const parsed = JSON.parse(result)
        if (parsed.report) {
          const reportChunk: StreamChunk = { type: 'analysis-report', report: parsed.report }
          controller.enqueue(encoder.encode(formatSSE(reportChunk)))
        }
      } catch { /* skip malformed report */ }
    }

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

        const STREAM_TIMEOUT_MS = 120_000

        const runChat = async () => {
          try {
            const decryptedConnection: DatabaseConnection = {
              ...data.connection,
              password: decrypt(data.connection.password),
            }
            const decryptedApiKey = data.apiKey ? decrypt(data.apiKey) : undefined
            const effectiveSqlPermission = decryptedConnection.env === 'prod' ? 'readonly' : data.sqlPermission

            // Intent classification: skip for continuation scenarios (SQL result/error, revise, filter confirm)
            let intent = null
            if (!data.isContinuation && data.message) {
              controller.enqueue(encoder.encode(formatSSE({ type: 'status', message: '意图分析中...' })))
              const hasHistory = (data.executionLog?.length ?? 0) > 0 || (data.history?.length ?? 0) > 0
              intent = await classifyIntentWithLLM(data.message, hasHistory, {
                provider: data.provider as any,
                model: data.model || '',
                apiKey: decryptedApiKey,
                baseURL: data.baseURL,
              })
            }

            controller.enqueue(encoder.encode(formatSSE({
              type: 'status',
              message: data.isContinuation ? '分析结果中...' : '生成回复中...',
            })))

            const { agent, resultStore } = await createDbAgent(decryptedConnection, {
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
              userQuery: data.message,
              intent,
            })
            const agentStream = agent.stream({
              prompt: data.message,
              messages: data.history as any,
            })

            let pendingToolNames: string[] = []
            let executeSqlDetected = false
            let smartFilterDetected = false
            let shouldBreak = false

            // Timeout protection: abort if no events for too long
            let lastEventTime = Date.now()
            const timeoutCheck = setInterval(() => {
              if (Date.now() - lastEventTime > STREAM_TIMEOUT_MS) {
                clearInterval(timeoutCheck)
                controller.enqueue(encoder.encode(formatSSE({ type: 'error', message: 'AI 响应超时（120s 无数据），请重试' })))
                controller.enqueue(encoder.encode(formatSSE({ type: 'finish' })))
                controller.close()
              }
            }, 10_000)

            try {
            for await (const event of agentStream) {
              lastEventTime = Date.now()
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
                  // Peek at execute_sql result BEFORE draining to decide break behavior
                  if (executeSqlDetected) {
                    const sqlQueue = resultStore.get('execute_sql')
                    if (sqlQueue && sqlQueue.length > 0) {
                      let isPendingConfirmation = false
                      try {
                        const parsed = JSON.parse(sqlQueue[0])
                        if (parsed.status === 'pending_confirmation') {
                          controller.enqueue(encoder.encode(formatSSE({
                            type: 'sql-confirm' as const,
                            sql: parsed.sql,
                            explanation: parsed.explanation,
                            intent_summary: parsed.intent_summary,
                            expected_shape: parsed.expected_shape,
                          })))
                          isPendingConfirmation = true
                        }
                      } catch { /* non-JSON result (e.g. security error) — let agent see it and self-correct */ }
                      if (isPendingConfirmation) {
                        shouldBreak = true
                      } else {
                        executeSqlDetected = false
                      }
                    }
                  }

                  const smartFilterResult = drainToolResults(pendingToolNames, resultStore, encoder, controller)

                  if (smartFilterDetected) {
                    try {
                      let suggestedFilters: Record<string, unknown>[] = []
                      if (smartFilterResult && !smartFilterResult.startsWith(TOOL_ERROR_PREFIX)) {
                        const parsed = JSON.parse(smartFilterResult)
                        suggestedFilters = parsed.filters ?? []
                      }
                      if (suggestedFilters.length > 0) {
                        controller.enqueue(encoder.encode(formatSSE({
                          type: 'smart-filter-confirm',
                          suggestedFilters: suggestedFilters as any,
                        })))
                      } else {
                        controller.enqueue(encoder.encode(formatSSE({
                          type: 'error',
                          message: '筛选参数生成失败，请重试或换一种描述。',
                        })))
                      }
                    } catch (err) {
                      console.warn('[chat] Smart filter parsing failed:', err)
                      controller.enqueue(encoder.encode(formatSSE({
                        type: 'error',
                        message: '筛选参数解析失败，请重试。',
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

              if (shouldBreak) break
            }
            } finally {
              clearInterval(timeoutCheck)
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
