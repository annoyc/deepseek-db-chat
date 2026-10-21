import type { ChatCompletionChunk } from '@/core/model/types'
import { ApiRequestError, handleErrorResponse } from './errors'
import { abortable, createAbortScope } from './lifecycle'

export async function* apiStreamRequest(
  url: string,
  apiKey: string,
  options: Record<string, any>,
  timeout = 60000,
  signal?: AbortSignal,
  limits: { idleTimeoutMs?: number; deadlineMs?: number } = {},
): AsyncGenerator<ChatCompletionChunk> {
  const scope = createAbortScope(signal, limits.deadlineMs ?? 180000)
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const armTimeout = (ms: number, message: string) => {
    if (timer) clearTimeout(timer)
    if (ms > 0) timer = setTimeout(() => scope.abort(new DOMException(message, 'TimeoutError')), ms)
  }
  armTimeout(timeout, 'Timed out waiting for first response byte')
  try {
    scope.signal.throwIfAborted()
    const response = await abortable(fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ ...options, stream: true }),
      signal: scope.signal,
      redirect: 'error',
    }), scope.signal)
    if (!response.ok) throw new ApiRequestError(await handleErrorResponse(response, scope.signal))
    if (!response.body) throw new Error('API error: response body is null')
    reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await abortable(reader.read(), scope.signal)
      if (done) break
      armTimeout(limits.idleTimeoutMs ?? 120000, 'Response stream idle timeout')
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const data = trimmed.slice(5).trim()
        if (data === '[DONE]') return
        if (!data) continue
        // Invalid events are an upstream protocol error, not a successful empty answer.
        yield JSON.parse(data) as ChatCompletionChunk
      }
    }
    const finalLine = (buffer + decoder.decode()).trim()
    if (finalLine.startsWith('data:')) {
      const data = finalLine.slice(5).trim()
      if (data && data !== '[DONE]') yield JSON.parse(data) as ChatCompletionChunk
    }
  } finally {
    if (timer) clearTimeout(timer)
    scope.abort()
    if (reader) {
      void reader.cancel().catch(() => {})
      reader.releaseLock()
    }
    scope.dispose()
  }
}
