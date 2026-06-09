function normalizeBase(baseUrl: string | undefined): string {
  if (!baseUrl) throw new Error('baseURL is not configured — check provider settings or environment variables')
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
}

export function getChatEndpoint(baseUrl: string): string {
  return new URL('chat/completions', normalizeBase(baseUrl)).toString()
}

export function getFimEndpoint(baseUrl: string): string {
  return new URL('completions', normalizeBase(baseUrl)).toString()
}

export function getModelsEndpoint(baseUrl: string): string {
  return new URL('models', normalizeBase(baseUrl)).toString()
}

export function getBalanceEndpoint(baseUrl: string): string {
  return new URL('user/balance', normalizeBase(baseUrl)).toString()
}
