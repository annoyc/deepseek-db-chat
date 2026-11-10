import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { createManagedStream } from '@/core/client/lifecycle'
import { traceContent, traceMetadata } from '@/core/telemetry'
import { maskPII } from '@/lib/masking'
import { startActiveObservation, propagateAttributes } from '@langfuse/tracing'
import { createDbAgent } from '@/server/agent'
import { classifyIntentWithLLM } from '@/server/intent-router'
import { createChatEventMapper, parseResume, type ChatResumeInput } from '@/server/chat-events'
import { resolveDatabaseConnection } from '@/server/resolve-connection'
import { resolveSqlPermission } from '@/server/sql-policy'
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
  thinkingStyle?: string
  thinkingMode?: 'enabled' | 'disabled'
  reasoningEffort?: 'high' | 'max'
  sqlPermission?: 'readonly' | 'write'
  executionLog?: ExecutionLogEntry[]
  lastConfirmedSql?: string
  sqlExecutedCount?: number
  maxSqlExecutions?: number
  sessionId?: string
  isContinuation?: boolean
  /** Continue the agent run a confirmation suspended; `result` answers the pending tool call. */
  resume?: ChatResumeInput
}

export const chatStream = createServerFn({ method: 'POST' })
  .inputValidator((data: ChatInput) => data)
  .handler(
    async ({ data }): Promise<Response> => {
    const encoder = new TextEncoder()
    const stream = createManagedStream(async ({ signal, enqueue }) => {
        const controller = { enqueue }

        const runChat = async () => {
          try {
            if (!data.isContinuation && maskPII(data.message) !== data.message) {
              controller.enqueue(encoder.encode(formatSSE({ type: 'error', message: '请使用非敏感内部编号查询，敏感标识不会发送给模型' })))
              controller.enqueue(encoder.encode(formatSSE({ type: 'finish' })))
              return
            }
            const decryptedConnection = resolveDatabaseConnection(data.connection)
            const effectiveSqlPermission = resolveSqlPermission(decryptedConnection, data.sqlPermission)

            // Intent classification: skip for continuation scenarios (SQL result/error, revise, filter confirm)
            let intent = null
            if (!data.isContinuation && data.message) {
              controller.enqueue(encoder.encode(formatSSE({ type: 'status', message: '意图分析中...' })))
              const hasHistory = (data.executionLog?.length ?? 0) > 0 || (data.history?.length ?? 0) > 0
              intent = await classifyIntentWithLLM(data.message, hasHistory, {
                provider: data.provider,
                model: data.model,
                apiKey: data.apiKey,
                baseURL: data.baseURL,
                thinkingStyle: data.thinkingStyle,
              }, signal)
            }

            controller.enqueue(encoder.encode(formatSSE({
              type: 'status',
              message: data.isContinuation ? '分析结果中...' : '生成回复中...',
            })))

            const { agent } = await createDbAgent(decryptedConnection, {
              provider: data.provider,
              model: data.model,
              apiKey: data.apiKey,
              baseURL: data.baseURL,
              thinkingStyle: data.thinkingStyle,
              thinkingMode: data.thinkingMode,
              reasoningEffort: data.reasoningEffort,
              sqlPermission: effectiveSqlPermission,
              executionLog: data.executionLog,
              lastConfirmedSql: data.lastConfirmedSql,
              sqlExecutedCount: data.sqlExecutedCount,
              maxSqlExecutions: data.maxSqlExecutions,
              userQuery: data.message,
              intent,
              signal,
            })
            const resume = data.isContinuation ? parseResume(data.resume) : undefined
            const agentStream = agent.stream(resume
              ? { resume, signal }
              : { prompt: data.message, messages: data.history as any, signal })

            // The loop ends by itself when a tool suspends it; no early break is needed.
            const toChunks = createChatEventMapper()
            for await (const event of agentStream) {
              for (const chunk of toChunks(event)) {
                controller.enqueue(encoder.encode(formatSSE(chunk)))
              }
            }

            controller.enqueue(encoder.encode(formatSSE({ type: 'finish' })))
          } catch (err) {
            signal.throwIfAborted()
            console.error('[chat] Agent stream error:', err instanceof Error ? err.name : 'UnknownError')
            const msg = err instanceof Error && (err.name === 'TimeoutError' || (err as { type?: string }).type === 'timeout')
              ? 'AI 响应超时，请重试'
              : 'AI 服务异常，请稍后重试或检查服务配置'
            controller.enqueue(encoder.encode(formatSSE({ type: 'error', message: msg })))
            controller.enqueue(encoder.encode(formatSSE({ type: 'finish' })))
          } finally {
            void flushTraces().catch(() => console.warn('[chat] Trace flush failed'))
          }
        }

        if (langfuseSpanProcessor) {
          const userId = resolveUserId()
          await startActiveObservation('chat', async (span) => {
            span.update({
              input: traceContent({ message: data.message.slice(0, 500) }),
              metadata: traceMetadata({ provider: data.provider, model: data.model }),
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
    }, {
      signal: getRequest().signal,
      deadlineMs: 180000,
      onError(error, enqueue) {
        const message = error instanceof Error && error.name === 'TimeoutError'
          ? '任务超过 180 秒，已停止生成，请缩小查询范围后重试'
          : 'AI 服务异常，请稍后重试'
        enqueue(encoder.encode(formatSSE({ type: 'error', message })))
        enqueue(encoder.encode(formatSSE({ type: 'finish' })))
      },
    })

    return new Response(stream, { headers: sseHeaders() })
  }
)

function sseHeaders(): HeadersInit {
  return {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    'Connection': 'keep-alive',
  }
}

function formatSSE(data: StreamChunk): string {
  return `data: ${JSON.stringify(data)}\n\n`
}
