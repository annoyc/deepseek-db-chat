export const ANONYMOUS_USER_COOKIE = 'dbpilot_uid'
export const ANONYMOUS_USER_COOKIE_MAX_AGE = 60 * 60 * 24 * 365 // 1 year

const ANONYMOUS_USER_ID_PATTERN = /^anon_[a-zA-Z0-9_-]{8,64}$/

export function isValidAnonymousUserId(value: unknown): value is string {
  return typeof value === 'string' && ANONYMOUS_USER_ID_PATTERN.test(value)
}

export function parseAnonymousUserIdFromCookieHeader(
  cookieHeader: string | null | undefined,
): string | undefined {
  if (!cookieHeader) return undefined
  for (const part of cookieHeader.split(';')) {
    const eqIndex = part.indexOf('=')
    if (eqIndex <= 0) continue
    const name = part.slice(0, eqIndex).trim()
    if (name !== ANONYMOUS_USER_COOKIE) continue
    const rawValue = part.slice(eqIndex + 1).trim()
    try {
      const decoded = decodeURIComponent(rawValue)
      if (isValidAnonymousUserId(decoded)) return decoded
    } catch {
      if (isValidAnonymousUserId(rawValue)) return rawValue
    }
  }
  return undefined
}

export function createAnonymousUserId(): string {
  if (typeof crypto !== 'undefined') {
    if (typeof crypto.randomUUID === 'function') {
      return `anon_${crypto.randomUUID()}`
    }
    if (typeof crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(16)
      crypto.getRandomValues(bytes)
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
      return `anon_${hex}`
    }
  }
  const fallback = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`
  return `anon_${fallback}`
}

export function ensureAnonymousUserCookie(
  doc: Pick<Document, 'cookie'> | undefined = typeof document !== 'undefined' ? document : undefined,
  loc: Pick<Location, 'protocol'> | undefined = typeof window !== 'undefined' ? window.location : undefined,
): string | undefined {
  if (!doc) return undefined
  const existing = parseAnonymousUserIdFromCookieHeader(doc.cookie)
  if (existing) return existing

  const id = createAnonymousUserId()
  const secure = loc?.protocol === 'https:' ? '; Secure' : ''
  doc.cookie = `${ANONYMOUS_USER_COOKIE}=${id}; Path=/; Max-Age=${ANONYMOUS_USER_COOKIE_MAX_AGE}; SameSite=Lax${secure}`
  return id
}
