import { createServerFn } from '@tanstack/react-start'
import { createDbAgent } from '@/server/agent'
import { getConnectionById } from '@/server/store'
import type { StreamChunk } from '@/lib/types'

interface ChatInput {
  connectionId: string
  message: string
  history?: { role: 'user' | 'assistant'; content: string }[]
  model?: string
  apiKey?: string
}

export const chatStream = createServerFn({ method: 'POST', response: 'raw' }).handler(
  async ({ data }: { data: ChatInput }): Promise<Response> => {
    const connection = getConnectionById(data.connectionId)
    if (!connection) {
      return new Response(
        formatSSE({ type: 'error', message: '数据库连接不存在' }),
        { headers: sseHeaders() }
      )
    }

    const { agent, resultStore } = createDbAgent(connection, {
      model: data.model,
      apiKey: data.apiKey,
    })
    const encoder = new TextEncoder()

    const stream = new ReadableStream({
      async start(controller) {
        try {
          const agentStream = agent.stream({
            prompt: data.message,
            messages: data.history as any,
          })

          let pendingToolNames: string[] = []
          let executeSqlDetected = false

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
                pendingToolNames = []
                for (const tc of event.toolCalls) {
                  let args: Record<string, unknown> = {}
                  try {
                    args = JSON.parse(tc.function.arguments || '{}')
                  } catch {}
                  const name = tc.function.name
                  pendingToolNames.push(name)
                  controller.enqueue(encoder.encode(formatSSE({ type: 'tool-call-start', name, args })))
                  if (name === 'execute_sql') {
                    executeSqlDetected = true
                  }
                }
                break
              }

              case 'step': {
                for (const name of pendingToolNames) {
                  const queue = resultStore.get(name)
                  const result = queue?.shift() ?? ''
                  if (queue?.length === 0) resultStore.delete(name)
                  const displayResult = name === 'execute_sql' ? '' : result
                  controller.enqueue(encoder.encode(formatSSE({ type: 'tool-call-end', name, result: displayResult })))
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

            if (executeSqlDetected) break
          }

          for (const name of pendingToolNames) {
            const queue = resultStore.get(name)
            const result = queue?.shift() ?? ''
            if (queue?.length === 0) resultStore.delete(name)
            const displayResult = name === 'execute_sql' ? '' : result
            controller.enqueue(encoder.encode(formatSSE({ type: 'tool-call-end', name, result: displayResult })))
          }

          controller.enqueue(encoder.encode(formatSSE({ type: 'finish' })))
        } catch (err) {
          const msg = err instanceof Error ? err.message : '未知错误'
          controller.enqueue(encoder.encode(formatSSE({ type: 'error', message: msg })))
        } finally {
          controller.close()
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
