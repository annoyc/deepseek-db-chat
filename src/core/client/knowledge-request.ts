import { abortable, createAbortScope } from './lifecycle'

/** A failed generation must not be replayed merely because streaming failed. */
export async function requestKnowledgeBackend(base: string, payload: unknown, signal: AbortSignal) {
  const request = (path: string) => fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json' },
    body: JSON.stringify(payload),
    signal,
    redirect: 'error',
  })
  signal.throwIfAborted()
  const response = await abortable(request('/chat/stream'), signal)
  if ([404, 405, 501].includes(response.status)) {
    await response.body?.cancel()
    signal.throwIfAborted()
    const fallback = await abortable(request('/chat'), signal)
    if (!fallback.ok) {
      await fallback.body?.cancel()
      throw new Error(`知识库服务返回 HTTP ${fallback.status}`)
    }
    return { response: fallback, streaming: false }
  }
  if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream')) {
    await response.body?.cancel()
    throw new Error(response.ok ? '知识库流式响应格式无效' : `知识库服务返回 HTTP ${response.status}`)
  }
  return { response, streaming: true }
}

export async function* readKnowledgeStream(response: Response, signal: AbortSignal, idleTimeoutMs = 60000) {
  if (!response.body) throw new Error('知识库流式接口没有返回响应体')
  const reader = response.body.getReader()
  try {
    while (true) {
      const scope = createAbortScope(signal, idleTimeoutMs)
      try {
        const { done, value } = await abortable(reader.read(), scope.signal)
        if (done) return
        yield value
      } finally {
        scope.dispose()
      }
    }
  } finally {
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
