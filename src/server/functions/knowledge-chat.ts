import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { z } from 'zod'
import { maskPII } from '@/lib/masking'
import { abortable, createAbortScope, createManagedStream } from '@/core/client/lifecycle'
import { readKnowledgeStream, requestKnowledgeBackend } from '@/core/client/knowledge-request'
import { readResponseJson } from '@/core/client/response-body'
import { createModel, getProvider, type ModelProvider } from '@/core'
import type { KnowledgeChatInput, KnowledgeHealth, KnowledgeStreamChunk } from '@/lib/knowledge-types'
import { resolveAiCredentials } from '@/server/ai-credentials'
import { withTrace } from '@/server/langfuse'
import { createServerEmbedder } from '@/server/knowledge/embedding'
import { loadKnowledgeBase } from '@/server/knowledge/knowledge-base'
import { runKnowledgePipeline, type KnowledgePipelineDeps } from '@/server/knowledge/pipeline'
import { createBochaWebSearch } from '@/server/knowledge/web-search'

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
    'Cache-Control': 'no-store',
    'Connection': 'keep-alive',
  }
}

function formatSSE(data: KnowledgeStreamChunk): string {
  return `data: ${JSON.stringify(data)}\n\n`
}

function emit(
  controller: Pick<ReadableStreamDefaultController<Uint8Array>, 'enqueue'>,
  encoder: TextEncoder,
  chunk: KnowledgeStreamChunk,
) {
  controller.enqueue(encoder.encode(formatSSE(chunk)))
}

function buildBackendPayload(data: KnowledgeChatInput) {
  return {
    message: maskPII(data.message),
    use_web_search: data.useWebSearch,
    use_base_model: data.useBaseModel,
    answer_mode: data.answerMode,
    history: (data.history ?? []).map((turn) => ({ role: turn.role, content: maskPII(turn.content) })),
  }
}

async function emitFallbackChat(
  controller: Pick<ReadableStreamDefaultController<Uint8Array>, 'enqueue'>,
  encoder: TextEncoder,
  response: Response,
  signal: AbortSignal,
) {
  emit(controller, encoder, { type: 'status', message: '连接知识库服务...' })
  emit(controller, encoder, {
    type: 'tool',
    id: 'request',
    name: 'request',
    title: '调用知识库服务',
    status: 'running',
  })

  const body = await readResponseJson<MemoChatResponse>(response, signal)
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
  if (!body.answer) throw new Error('知识库服务未返回答案')
  emit(controller, encoder, { type: 'text', content: body.answer })
  emit(controller, encoder, {
    type: 'tool',
    id: 'synthesis',
    name: 'synthesis',
    title: '答案合成',
    status: 'done',
    output: '合成完成',
  })
}

const KnowledgeInputSchema = z.object({
  message: z.string().trim().min(1).max(16000),
  useWebSearch: z.boolean(),
  useBaseModel: z.boolean(),
  answerMode: z.enum(['concise', 'standard', 'deep']),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(32000) })).max(20).optional(),
  provider: z.string().max(40).optional(),
  model: z.string().max(120).optional(),
  apiKey: z.string().max(4096).optional(),
  baseURL: z.string().max(2048).optional(),
})

/** local (default): in-process RAG over the bundled index. remote: the MEMO_CHAT_API_BASE service. */
function knowledgeBackend(): 'local' | 'remote' {
  return process.env.KNOWLEDGE_BACKEND?.trim() === 'remote' ? 'remote' : 'local'
}

/** Errors whose message is written for users and contains no internal detail. */
class KnowledgeUserError extends Error {}

async function streamFromRemote(
  data: KnowledgeChatInput,
  signal: AbortSignal,
  enqueue: (value: Uint8Array) => void,
  encoder: TextEncoder,
) {
  const controller = { enqueue }
  // Includes connection and response headers; the entire task also has a deadline.
  const firstResponse = createAbortScope(signal, 30000)
  try {
    const result = await requestKnowledgeBackend(getBackendBase(), buildBackendPayload(data), firstResponse.signal)
    firstResponse.clearDeadline()
    if (result.streaming) {
      for await (const value of readKnowledgeStream(result.response, signal)) enqueue(value)
    } else {
      await emitFallbackChat(controller, encoder, result.response, signal)
    }
  } finally {
    firstResponse.abort()
    firstResponse.dispose()
  }
}

async function localPipelineDeps(data: KnowledgeChatInput): Promise<KnowledgePipelineDeps> {
  const providerId = (data.provider || 'deepseek') as ModelProvider
  let credentials: { apiKey: string; baseURL: string }
  let defaultModel: string
  try {
    defaultModel = getProvider(providerId).defaultModel
    credentials = resolveAiCredentials(providerId, data.apiKey, data.baseURL)
  } catch (error) {
    throw new KnowledgeUserError(error instanceof Error ? error.message : '模型配置无效')
  }
  const knowledgeBase = await loadKnowledgeBase()
  return {
    knowledgeBase: async () => knowledgeBase,
    chatModel: ({ purpose, thinking }) => createModel({
      provider: providerId,
      model: data.model || defaultModel,
      thinking: { type: thinking ? 'enabled' : 'disabled' },
      ...(purpose === 'analysis' ? { temperature: 0, timeout: 15000, maxRetries: 0 } : { timeout: 60000 }),
      ...credentials,
    }),
    embedder: knowledgeBase.embedding ? createServerEmbedder(knowledgeBase.embedding) : null,
    webSearch: createBochaWebSearch(),
    minSimilarity: Number(process.env.KB_MIN_SIMILARITY) || 0.3,
  }
}

export const knowledgeChatStream = createServerFn({ method: 'POST' })
  .inputValidator((data: KnowledgeChatInput) => KnowledgeInputSchema.parse(data))
  .handler(async ({ data }): Promise<Response> => {
    const backend = knowledgeBackend()
    const encoder = new TextEncoder()
    const stream = createManagedStream(async ({ signal, enqueue }) => {
      emit({ enqueue }, encoder, { type: 'status', message: '准备知识问答任务...' })
      if (backend === 'remote') {
        await streamFromRemote(data, signal, enqueue, encoder)
      } else {
        const deps = await localPipelineDeps(data)
        await withTrace({
          name: 'knowledge-chat',
          input: data.message,
          metadata: { provider: data.provider || 'deepseek', model: data.model, stream: true, messageCount: (data.history?.length ?? 0) + 1 },
          tags: ['knowledge', data.answerMode],
        }, async () => {
          const pipeline = runKnowledgePipeline({
            message: data.message,
            history: data.history ?? [],
            useWebSearch: data.useWebSearch,
            useBaseModel: data.useBaseModel,
            answerMode: data.answerMode,
          }, deps, signal)
          for await (const chunk of pipeline) emit({ enqueue }, encoder, chunk)
        })
      }
      emit({ enqueue }, encoder, { type: 'finish' })
    }, {
      signal: getRequest().signal,
      deadlineMs: 180000,
      onError(error, enqueue) {
        const message = error instanceof Error && error.name === 'TimeoutError'
          ? '知识库响应超时，已停止请求，请稍后重试'
          : error instanceof KnowledgeUserError
            ? error.message
            : backend === 'remote'
              ? '知识库服务不可用，请稍后重试'
              : error instanceof Error && error.name === 'ApiRequestError'
                ? '模型服务调用失败，请检查模型配置后重试'
                : '知识库问答失败，请稍后重试'
        if (backend === 'local' && !(error instanceof KnowledgeUserError)) {
          console.error('[knowledge-chat] pipeline failed:', error instanceof Error ? error.name : 'UnknownError')
        }
        enqueue(encoder.encode(formatSSE({ type: 'error', message })))
        enqueue(encoder.encode(formatSSE({ type: 'finish' })))
      },
    })
    return new Response(stream, { headers: sseHeaders() })
  })

async function localHealth(): Promise<KnowledgeHealth> {
  try {
    const kb = await loadKnowledgeBase()
    const hybrid = Boolean(kb.embedding && createServerEmbedder(kb.embedding))
    return {
      status: 'ok',
      mode: 'local',
      index: { documents: kb.documents.size, chunks: kb.chunks.length, retrieval: hybrid ? 'hybrid' : 'keyword' },
      webSearchAvailable: Boolean(process.env.BOCHA_API_KEY?.trim()),
    }
  } catch (error) {
    console.error('[knowledge-health] index load failed:', error instanceof Error ? error.name : 'UnknownError')
    return { status: 'offline', mode: 'local', error: '知识库索引不可用' }
  }
}

async function remoteHealth(): Promise<KnowledgeHealth> {
  const backendBase = getBackendBase()
  const requestSignal = getRequest().signal
  const scope = createAbortScope(requestSignal, 5000)
  try {
    const response = await abortable(fetch(`${backendBase}/health`, { method: 'GET', signal: scope.signal, redirect: 'error' }), scope.signal)
    const body = await readResponseJson<{ lm_model?: string; web_search_available?: boolean }>(response, scope.signal)
    if (!response.ok) throw new Error(`知识库服务返回 ${response.status}`)
    return {
      status: 'ok',
      mode: 'remote',
      lmModel: body.lm_model,
      webSearchAvailable: Boolean(body.web_search_available),
    }
  } catch (err) {
    requestSignal.throwIfAborted()
    return {
      status: 'offline',
      mode: 'remote',
      error: '无法连接知识库服务',
    }
  } finally {
    scope.abort()
    scope.dispose()
  }
}

export const knowledgeHealth = createServerFn({ method: 'GET' })
  .handler(async (): Promise<KnowledgeHealth> => knowledgeBackend() === 'remote' ? remoteHealth() : localHealth())
