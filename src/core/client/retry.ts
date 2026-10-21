import { ApiRequestError } from './errors'
import { abortableDelay } from './lifecycle'

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  signal?: AbortSignal,
): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    signal?.throwIfAborted()
    try {
      return await fn()
    }
    catch (error) {
      lastError = error
      if (attempt < maxRetries && error instanceof ApiRequestError && error.retryable) {
        const retryAfter = error.retryAfter
        const baseDelay = 1000 * 2 ** attempt
        const jitter = baseDelay * 0.3 * Math.random()
        const delay = retryAfter
          ? retryAfter * 1000
          : baseDelay + jitter
        await abortableDelay(delay, signal)
        continue
      }
      throw error
    }
  }
  throw lastError
}
