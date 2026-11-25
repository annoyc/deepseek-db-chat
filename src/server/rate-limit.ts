import { createHash, randomBytes } from 'node:crypto'
import { ApiRequestError } from '@/core/client/errors'
import { parseAnonymousUserIdFromCookieHeader } from '@/lib/anonymous-user'
import { resolveAiTargetWithMeta, type AiRequestConfig, type AiTargetWithMeta } from './ai-credentials'

export type DemoRateLimitScope = 'chat' | 'aux' | 'upload'

export class DemoRateLimitError extends Error {
  public readonly retryAfterSeconds: number
  public readonly scope: DemoRateLimitScope

  constructor(message: string, retryAfterSeconds: number, scope: DemoRateLimitScope) {
    super(message)
    this.name = 'DemoRateLimitError'
    this.retryAfterSeconds = retryAfterSeconds
    this.scope = scope
  }
}

interface WindowRule {
  windowMs: number
  limit: number
}

interface ScopeRules {
  perClient: WindowRule[]
  global: WindowRule[]
}

const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000
const MAX_CLIENT_BUCKETS = 4096
const PROCESS_SALT = randomBytes(16).toString('hex')

const clientBuckets = new Map<DemoRateLimitScope, Map<string, number[]>>()
const globalBuckets = new Map<DemoRateLimitScope, number[]>()

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const n = Number(raw.trim())
  return Number.isInteger(n) && n > 0 ? n : fallback
}

function isRateLimitEnabled(env: NodeJS.ProcessEnv): boolean {
  const raw = env.DEMO_RATE_LIMIT_ENABLED?.trim().toLowerCase()
  return raw !== 'false' && raw !== '0'
}

function getScopeRules(scope: DemoRateLimitScope, env: NodeJS.ProcessEnv): ScopeRules {
  if (scope === 'chat') {
    return {
      perClient: [
        { windowMs: MINUTE_MS, limit: parsePositiveInt(env.DEMO_RATE_LIMIT_PER_MINUTE, 10) },
        { windowMs: HOUR_MS, limit: parsePositiveInt(env.DEMO_RATE_LIMIT_PER_HOUR, 40) },
      ],
      global: [
        { windowMs: MINUTE_MS, limit: parsePositiveInt(env.DEMO_RATE_LIMIT_GLOBAL_PER_MINUTE, 120) },
      ],
    }
  }
  if (scope === 'aux') {
    return {
      perClient: [
        { windowMs: MINUTE_MS, limit: parsePositiveInt(env.DEMO_AUX_RATE_LIMIT_PER_MINUTE, 30) },
        { windowMs: HOUR_MS, limit: 120 },
      ],
      global: [
        { windowMs: MINUTE_MS, limit: 300 },
      ],
    }
  }
  return {
    perClient: [
      { windowMs: HOUR_MS, limit: parsePositiveInt(env.DEMO_UPLOAD_RATE_LIMIT_PER_HOUR, 15) },
    ],
    global: [
      { windowMs: HOUR_MS, limit: 60 },
    ],
  }
}

function hashIdentifier(kind: 'ip' | 'cookie', raw: string): string {
  return createHash('sha256').update(`${PROCESS_SALT}:${kind}:${raw}`).digest('hex').slice(0, 32)
}

/**
 * Derive a privacy-preserving client bucket key from forwarding headers or
 * anonymous cookie without keeping raw IP addresses in memory or logs.
 */
export function resolveRateLimitClientKey(request?: Pick<Request, 'headers'> | null): string {
  const headers = request?.headers
  if (headers) {
    for (const headerName of ['x-vercel-forwarded-for', 'cf-connecting-ip', 'x-real-ip', 'x-forwarded-for']) {
      const raw = headers.get(headerName)
      const firstHop = raw?.split(',')[0]?.trim()
      if (firstHop) return hashIdentifier('ip', firstHop)
    }
    const cookieId = parseAnonymousUserIdFromCookieHeader(headers.get('cookie'))
    if (cookieId) return hashIdentifier('cookie', cookieId)
  }
  return 'anonymous-local'
}

function pruneTimestamps(timestamps: number[], cutoff: number): number[] {
  let firstValid = 0
  while (firstValid < timestamps.length && timestamps[firstValid]! <= cutoff) {
    firstValid++
  }
  return firstValid > 0 ? timestamps.slice(firstValid) : timestamps
}

function checkWindowExceeded(timestamps: number[], rules: WindowRule[], now: number): number | null {
  for (const rule of rules) {
    const cutoff = now - rule.windowMs
    const recent = pruneTimestamps(timestamps, cutoff)
    if (recent.length >= rule.limit) {
      const oldestInWindow = recent[recent.length - rule.limit]!
      const waitMs = Math.max(1000, oldestInWindow + rule.windowMs - now)
      return Math.max(1, Math.ceil(waitMs / 1000))
    }
  }
  return null
}

/**
 * Consume one quota unit from the server-managed demo rate limiter.
 * Throws DemoRateLimitError with a user-facing prompt when exceeded.
 */
export function consumeDemoQuota(options: {
  request?: Pick<Request, 'headers'> | null
  scope?: DemoRateLimitScope
  now?: number
  env?: NodeJS.ProcessEnv
} = {}): void {
  const env = options.env ?? process.env
  if (!isRateLimitEnabled(env)) return

  const scope = options.scope ?? 'chat'
  const now = options.now ?? Date.now()
  const rules = getScopeRules(scope, env)
  const maxWindowMs = Math.max(
    ...rules.perClient.map((r) => r.windowMs),
    ...rules.global.map((r) => r.windowMs),
  )
  const cutoff = now - maxWindowMs

  const clientKey = resolveRateLimitClientKey(options.request)
  let scopeClients = clientBuckets.get(scope)
  if (!scopeClients) {
    scopeClients = new Map()
    clientBuckets.set(scope, scopeClients)
  }

  const existingClient = scopeClients.get(clientKey)
  const activeClient = existingClient ? pruneTimestamps(existingClient, cutoff) : []
  if (existingClient) {
    if (activeClient.length === 0) scopeClients.delete(clientKey)
    else scopeClients.set(clientKey, activeClient)
  }

  const clientWait = checkWindowExceeded(activeClient, rules.perClient, now)
  if (clientWait !== null) {
    throw new DemoRateLimitError(
      `公共演示通道请求较频繁，请在 ${clientWait} 秒后重试，或点击「设置 → 模型服务」填入自有 API Key 继续无限使用。`,
      clientWait,
      scope,
    )
  }

  const existingGlobal = globalBuckets.get(scope) ?? []
  const activeGlobal = pruneTimestamps(existingGlobal, cutoff)
  globalBuckets.set(scope, activeGlobal)

  const globalWait = checkWindowExceeded(activeGlobal, rules.global, now)
  if (globalWait !== null) {
    throw new DemoRateLimitError(
      `公共演示通道当前访问人数较多，请在 ${globalWait} 秒后重试，或点击「设置 → 模型服务」填入自有 API Key 继续使用。`,
      globalWait,
      scope,
    )
  }

  if (!scopeClients.has(clientKey) && scopeClients.size >= MAX_CLIENT_BUCKETS) {
    const oldestKey = scopeClients.keys().next().value
    if (oldestKey !== undefined) scopeClients.delete(oldestKey)
  }

  activeClient.push(now)
  scopeClients.set(clientKey, activeClient)

  activeGlobal.push(now)
  globalBuckets.set(scope, activeGlobal)
}

/**
 * Validate AI request credentials and enforce demo rate limits only when
 * the request consumes a server-managed API key.
 */
export function enforceServerKeyRateLimit(
  aiRequest: AiRequestConfig,
  request?: Pick<Request, 'headers'> | null,
  scope: DemoRateLimitScope = 'chat',
): AiTargetWithMeta {
  const target = resolveAiTargetWithMeta(aiRequest)
  if (target.usesServerKey) {
    consumeDemoQuota({ request, scope })
  }
  return target
}

/** Translate rate-limit, upstream quota, timeout, and auth failures into clear user messages. */
export function describeAiServiceError(
  error: unknown,
  options: { usesServerKey: boolean; timeoutMessage: string; fallbackMessage: string },
): string {
  if (error instanceof DemoRateLimitError) return error.message
  if (error instanceof Error && (error.name === 'TimeoutError' || (error as { type?: string }).type === 'timeout')) {
    return options.timeoutMessage
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 429) {
      return options.usesServerKey
        ? '公共演示通道当前访问人数较多（触发模型并发限流），请稍后重试，或点击「设置 → 模型服务」填入自有 API Key 继续使用。'
        : '模型服务触发限流（429），请稍后重试'
    }
    if (error.status === 402) {
      return options.usesServerKey
        ? '公共演示通道体验额度暂已用尽，请点击「设置 → 模型服务」填入自有 API Key 继续使用。'
        : '模型服务账户余额不足（402），请检查自有 API Key 额度'
    }
    if ((error.status === 401 || error.status === 403) && !options.usesServerKey) {
      return '自定义 API Key 鉴权失败，请在「设置 → 模型服务」中检查密钥'
    }
  }
  return options.fallbackMessage
}

/** Reset all in-memory rate-limit buckets (for tests). */
export function resetDemoRateLimiter(): void {
  clientBuckets.clear()
  globalBuckets.clear()
}
