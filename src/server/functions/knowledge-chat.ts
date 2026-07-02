import { createServerFn } from '@tanstack/react-start'
import type { KnowledgeChatInput, KnowledgeHealth, KnowledgeStreamChunk } from '@/lib/knowledge-types'

interface MemoChatResponse {
  answer?: string
  sub_questions?: string[]
  memory_snippets?: { question: string; answer: string }[]
  web_results?: { title: string; url: string; snippet?: string; site_name?: string }[]
  detail?: string
}

const DEFAULT_BACKEND_BASE = 'http://127.0.0.1:7860'

function getBackendBase(): string {
  return (process.env.MEMO_CHAT_API_BASE || process.env.VITE_MEMO_CHAT_API_BASE || DEFAULT_BACKEND_BASE).replace(/\/$/, '')
}

function sseHeaders(): HeadersInit {
  return {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  }
}

function formatSSE(data: KnowledgeStreamChunk): string {
  return `data: ${JSON.stringify(data)}\n\n`
}

function emit(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  chunk: KnowledgeStreamChunk,
) {
  controller.enqueue(encoder.encode(formatSSE(chunk)))
}

function buildBackendPayload(data: KnowledgeChatInput) {
  return {
    message: data.message,
    use_web_search: data.useWebSearch,
    use_base_model: data.useBaseModel,
    answer_mode: data.answerMode,
    history: (data.history ?? []).map((turn) => ({ role: turn.role, content: turn.content })),
  }
}

async function pipeBackendStream(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  response: Response,
) {
  if (!response.body) throw new Error('知识库流式接口没有返回响应体')
  const reader = response.body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      controller.enqueue(value)
    }
  } finally {
    reader.releaseLock()
  }

  emit(controller, encoder, { type: 'finish' })
}

async function emitFallbackChat(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  data: KnowledgeChatInput,
  backendBase: string,
) {
  emit(controller, encoder, { type: 'status', message: '连接知识库服务...' })
  emit(controller, encoder, {
    type: 'tool',
    id: 'request',
    name: 'request',
    title: '调用知识库服务',
    status: 'running',
  })

  const response = await fetch(`${backendBase}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildBackendPayload(data)),
  })

  const body = (await response.json().catch(() => ({}))) as MemoChatResponse
  if (!response.ok) {
    emit(controller, encoder, {
      type: 'tool',
      id: 'request',
      name: 'request',
      title: '调用知识库服务',
      status: 'error',
      output: `HTTP ${response.status}`,
    })
    throw new Error(body.detail || `知识库服务返回 ${response.status}`)
  }
  emit(controller, encoder, {
    type: 'tool',
    id: 'request',
    name: 'request',
    title: '调用知识库服务',
    status: 'done',
    output: '已返回结果',
  })

  emit(controller, encoder, { type: 'status', message: '整理检索证据...' })

  const subQuestions = body.sub_questions ?? []
  const memorySnippets = body.memory_snippets ?? []
  const webResults = body.web_results ?? []

  // Reconstruct a coarse tool chain from the non-streaming response so the
  // timeline still renders when the backend lacks the /chat/stream endpoint.
  if (subQuestions.length > 0) {
    emit(controller, encoder, {
      type: 'tool',
      id: 'intent_analysis',
      name: 'intent_analysis',
      title: '意图分析与问题拆解',
      status: 'done',
      output: `拆解出 ${subQuestions.length} 个子问题`,
      detail: subQuestions.join('\n'),
    })
  }
  if (memorySnippets.length > 0) {
    emit(controller, encoder, {
      type: 'tool',
      id: 'memory_query',
      name: 'memory_query',
      title: '记忆库检索',
      status: 'done',
      output: `检索 ${memorySnippets.length} 条记忆片段`,
    })
  }
  if (webResults.length > 0) {
    emit(controller, encoder, {
      type: 'tool',
      id: 'web_search',
      name: 'web_search',
      title: '联网搜索（博查）',
      status: 'done',
      output: `命中 ${webResults.length} 条网页结果`,
    })
  }

  emit(controller, encoder, {
    type: 'evidence',
    subQuestions,
    memorySnippets,
    webResults,
  })

  emit(controller, encoder, { type: 'status', message: '生成最终回答...' })
  emit(controller, encoder, {
    type: 'tool',
    id: 'synthesis',
    name: 'synthesis',
    title: '答案合成',
    status: 'running',
  })
  const answer = body.answer || '（知识库服务未返回答案）'
  const chars = Array.from(answer)
  for (let i = 0; i < chars.length; i += 8) {
    emit(controller, encoder, { type: 'text', content: chars.slice(i, i + 8).join('') })
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  emit(controller, encoder, {
    type: 'tool',
    id: 'synthesis',
    name: 'synthesis',
    title: '答案合成',
    status: 'done',
    output: '合成完成',
  })
}

export const knowledgeChatStream = createServerFn({ method: 'POST' })
  .inputValidator((data: KnowledgeChatInput) => data)
  .handler(async ({ data }): Promise<Response> => {
    const backendBase = getBackendBase()
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()
        try {
          emit(controller, encoder, { type: 'status', message: '准备知识问答任务...' })

          const streamResponse = await fetch(`${backendBase}/chat/stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
            body: JSON.stringify(buildBackendPayload(data)),
          }).catch(() => null)

          if (
            streamResponse?.ok &&
            streamResponse.headers.get('content-type')?.includes('text/event-stream')
          ) {
            await pipeBackendStream(controller, encoder, streamResponse)
            return
          }

          await emitFallbackChat(controller, encoder, data, backendBase)
          emit(controller, encoder, { type: 'finish' })
        } catch (err) {
          const message = err instanceof Error ? err.message : '知识库问答服务异常'
          emit(controller, encoder, { type: 'error', message })
          emit(controller, encoder, { type: 'finish' })
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, { headers: sseHeaders() })
  })

export const knowledgeHealth = createServerFn({ method: 'GET' })
  .handler(async (): Promise<KnowledgeHealth> => {
    const backendBase = getBackendBase()
    try {
      const response = await fetch(`${backendBase}/health`, { method: 'GET' })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(`知识库服务返回 ${response.status}`)
      return {
        status: 'ok',
        lmModel: body.lm_model,
        webSearchAvailable: Boolean(body.web_search_available),
        backendBase,
      }
    } catch (err) {
      return {
        status: 'offline',
        backendBase,
        error: err instanceof Error ? err.message : '无法连接知识库服务',
      }
    }
  })
