import type { ChatCompletionChunk } from '@/core/model/types'
import { ApiRequestError, handleErrorResponse } from './errors'

export async function* apiStreamRequest(
  url: string,
  apiKey: string,
  options: Record<string, any>,
  timeout?: number,
  signal?: AbortSignal,
): AsyncGenerator<ChatCompletionChunk> {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream',
    'Authorization': `Bearer ${apiKey}`,
  }

  // Timeout only applies to the initial connection (waiting for first byte).
  // Once streaming starts, the connection stays alive — only the caller's
  // abort signal can cancel it.
  const controller = new AbortController()
  const timeoutId = timeout ? setTimeout(() => controller.abort(new DOMException('Timed out waiting for response', 'TimeoutError')), timeout) : undefined
  const combinedSignal = signal
    ? AbortSignal.any([signal, controller.signal])
    : controller.signal

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...options, stream: true }),
    signal: combinedSignal,
  })

  // Connection established — cancel the timeout so streaming can run indefinitely
  if (timeoutId) clearTimeout(timeoutId)

  if (!response.ok) {
    throw new ApiRequestError(await handleErrorResponse(response))
  }

  if (!response.body) {
    throw new Error('API error: response body is null')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data:')) {
        continue
      }

      const data = trimmed.slice(5).trim()
      if (data === '[DONE]') {
        return
      }

      if (!data) {
        continue
      }

      try {
        yield JSON.parse(data) as ChatCompletionChunk
      }
      catch {
        continue
      }
    }
  }
}
