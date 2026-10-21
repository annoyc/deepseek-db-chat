import { abortable } from './lifecycle'

/** Read JSON with a cancellable reader, including stalled response bodies. */
export async function readResponseJson<T>(response: Response, signal?: AbortSignal): Promise<T> {
  if (!response.body) throw new Error('API response body is empty')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  try {
    while (true) {
      signal?.throwIfAborted()
      const { done, value } = await abortable(reader.read(), signal)
      if (done) break
      text += decoder.decode(value, { stream: true })
    }
    return JSON.parse(text + decoder.decode()) as T
  } finally {
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
