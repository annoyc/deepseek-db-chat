import { ApiRequestError, handleErrorResponse } from './errors'
import { abortable, createAbortScope } from './lifecycle'
import { readResponseJson } from './response-body'

export async function apiRequest<T>(
  url: string,
  apiKey: string,
  options: Record<string, any>,
  timeout?: number,
  method: 'GET' | 'POST' = 'POST',
  signal?: AbortSignal,
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${apiKey}`,
  }

  if (method === 'POST') {
    headers['Content-Type'] = 'application/json'
  }

  const scope = createAbortScope(signal, timeout)
  try {
    scope.signal.throwIfAborted()
    const response = await abortable(fetch(url, {
      method,
      headers,
      body: method === 'POST' ? JSON.stringify(options) : undefined,
      signal: scope.signal,
      // Callers configure the final endpoint; even same-origin redirects fail
      // closed so credentials are never automatically forwarded elsewhere.
      redirect: 'error',
    }), scope.signal)
    if (!response.ok) {
      throw new ApiRequestError(await handleErrorResponse(response, scope.signal))
    }
    return await readResponseJson<T>(response, scope.signal)
  } finally {
    scope.abort()
    scope.dispose()
  }
}
