import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { ApiRequestError } from '@/core/client/errors'
import { encrypt } from '@/server/crypto'
import { resolveAiTargetWithMeta } from '@/server/ai-credentials'
import {
  consumeDemoQuota,
  DemoRateLimitError,
  describeAiServiceError,
  enforceServerKeyRateLimit,
  resetDemoRateLimiter,
  resolveRateLimitClientKey,
} from '@/server/rate-limit'

const envKeys = [
  'DEEPSEEK_API_KEY',
  'ENCRYPTION_KEY',
  'DEMO_RATE_LIMIT_ENABLED',
  'DEMO_RATE_LIMIT_PER_MINUTE',
  'DEMO_RATE_LIMIT_PER_HOUR',
  'DEMO_RATE_LIMIT_GLOBAL_PER_MINUTE',
  'DEMO_AUX_RATE_LIMIT_PER_MINUTE',
  'DEMO_UPLOAD_RATE_LIMIT_PER_HOUR',
]

function setupEnv(t: TestContext, overrides: Record<string, string | undefined> = {}) {
  const previous = new Map(envKeys.map((key) => [key, process.env[key]]))
  const defaults: Record<string, string> = {
    DEEPSEEK_API_KEY: 'sk-server-demo-secret',
    ENCRYPTION_KEY: '42'.repeat(32),
    DEMO_RATE_LIMIT_ENABLED: 'true',
    DEMO_RATE_LIMIT_PER_MINUTE: '2',
    DEMO_RATE_LIMIT_PER_HOUR: '5',
    DEMO_RATE_LIMIT_GLOBAL_PER_MINUTE: '10',
    DEMO_AUX_RATE_LIMIT_PER_MINUTE: '2',
    DEMO_UPLOAD_RATE_LIMIT_PER_HOUR: '2',
  }
  for (const key of envKeys) {
    const val = Object.hasOwn(overrides, key) ? overrides[key] : defaults[key]
    if (val === undefined) delete process.env[key]
    else process.env[key] = val
  }
  resetDemoRateLimiter()
  t.after(() => {
    resetDemoRateLimiter()
    for (const [key, val] of previous) {
      if (val === undefined) delete process.env[key]
      else process.env[key] = val
    }
  })
}

function makeRequest(headers: Record<string, string>): Pick<Request, 'headers'> {
  return { headers: new Headers(headers) }
}

test('per-client minute and hour limits block excess demo calls with retry countdown and settings guidance', (t) => {
  setupEnv(t, { DEMO_RATE_LIMIT_PER_MINUTE: '2', DEMO_RATE_LIMIT_PER_HOUR: '3', DEMO_RATE_LIMIT_GLOBAL_PER_MINUTE: '50' })
  const req = makeRequest({ 'x-forwarded-for': '203.0.113.10' })

  consumeDemoQuota({ request: req, scope: 'chat', now: 1_000_000 })
  consumeDemoQuota({ request: req, scope: 'chat', now: 1_005_000 })

  assert.throws(
    () => consumeDemoQuota({ request: req, scope: 'chat', now: 1_010_000 }),
    (err: unknown) => {
      assert.ok(err instanceof DemoRateLimitError)
      assert.equal(err.scope, 'chat')
      assert.equal(err.retryAfterSeconds, 50)
      assert.match(err.message, /设置 → 模型服务/)
      assert.match(err.message, /自有 API Key/)
      return true
    },
  )

  // After the 1-minute window passes (past 1_005_000 + 60_000), the 3rd hourly request succeeds, and the 4th hits the hourly cap.
  consumeDemoQuota({ request: req, scope: 'chat', now: 1_061_000 })
  assert.throws(
    () => consumeDemoQuota({ request: req, scope: 'chat', now: 1_066_000 }),
    (err: unknown) => {
      assert.ok(err instanceof DemoRateLimitError)
      assert.ok(err.retryAfterSeconds > 3000)
      assert.match(err.message, /自有 API Key/)
      return true
    },
  )
})

test('aux and upload scopes are isolated from chat quota', (t) => {
  setupEnv(t, { DEMO_RATE_LIMIT_PER_MINUTE: '1', DEMO_AUX_RATE_LIMIT_PER_MINUTE: '2', DEMO_UPLOAD_RATE_LIMIT_PER_HOUR: '1' })
  const req = makeRequest({ 'x-real-ip': '198.51.100.22' })

  consumeDemoQuota({ request: req, scope: 'aux', now: 5_000_000 })
  consumeDemoQuota({ request: req, scope: 'aux', now: 5_001_000 })
  consumeDemoQuota({ request: req, scope: 'upload', now: 5_002_000 })

  // Chat quota is still untouched.
  consumeDemoQuota({ request: req, scope: 'chat', now: 5_003_000 })
  assert.throws(() => consumeDemoQuota({ request: req, scope: 'chat', now: 5_004_000 }), DemoRateLimitError)
})

test('global burst limit protects server key across distinct client IPs', (t) => {
  setupEnv(t, { DEMO_RATE_LIMIT_PER_MINUTE: '5', DEMO_RATE_LIMIT_GLOBAL_PER_MINUTE: '2' })
  consumeDemoQuota({ request: makeRequest({ 'x-vercel-forwarded-for': '192.0.2.1' }), scope: 'chat', now: 2_000_000 })
  consumeDemoQuota({ request: makeRequest({ 'x-vercel-forwarded-for': '192.0.2.2' }), scope: 'chat', now: 2_001_000 })

  assert.throws(
    () => consumeDemoQuota({ request: makeRequest({ 'x-vercel-forwarded-for': '192.0.2.3' }), scope: 'chat', now: 2_002_000 }),
    (err: unknown) => {
      assert.ok(err instanceof DemoRateLimitError)
      assert.match(err.message, /当前访问人数较多/)
      assert.match(err.message, /自有 API Key/)
      return true
    },
  )
})

test('user-supplied encrypted API keys set usesServerKey=false and bypass demo rate limits', (t) => {
  setupEnv(t, { DEMO_RATE_LIMIT_PER_MINUTE: '1', DEMO_RATE_LIMIT_GLOBAL_PER_MINUTE: '1' })
  const req = makeRequest({ 'x-forwarded-for': '203.0.113.77' })

  // Exhaust demo server-key quota for this client and globally.
  const serverTarget = enforceServerKeyRateLimit({ provider: 'deepseek', model: 'deepseek-flash' }, req, 'chat')
  assert.equal(serverTarget.usesServerKey, true)
  assert.throws(() => enforceServerKeyRateLimit({ provider: 'deepseek', model: 'deepseek-flash' }, req, 'chat'), DemoRateLimitError)

  // User key on built-in DeepSeek provider is never rate-limited.
  const userDeepSeek = { provider: 'deepseek', model: 'deepseek-flash', apiKey: encrypt('sk-user-owned-key') }
  assert.equal(resolveAiTargetWithMeta(userDeepSeek).usesServerKey, false)
  assert.equal(enforceServerKeyRateLimit(userDeepSeek, req, 'chat').usesServerKey, false)
  assert.equal(enforceServerKeyRateLimit(userDeepSeek, req, 'chat').usesServerKey, false)

  // Custom OpenAI-compatible provider is never rate-limited.
  const customProvider = {
    provider: 'custom-openrouter',
    model: 'deepseek/deepseek-chat',
    apiKey: encrypt('sk-custom-user-key'),
    baseURL: 'https://openrouter.ai/api/v1',
    thinkingStyle: 'none',
  }
  assert.equal(resolveAiTargetWithMeta(customProvider).usesServerKey, false)
  assert.equal(enforceServerKeyRateLimit(customProvider, req, 'chat').usesServerKey, false)
})

test('resolveRateLimitClientKey hashes IP/cookie identifiers and respects disable flag', (t) => {
  setupEnv(t, { DEMO_RATE_LIMIT_ENABLED: 'false', DEMO_RATE_LIMIT_PER_MINUTE: '1' })
  const rawIp = '203.0.113.99'
  const keyFromIp = resolveRateLimitClientKey(makeRequest({ 'x-forwarded-for': `${rawIp}, 10.0.0.1` }))
  assert.equal(keyFromIp.includes(rawIp), false)
  assert.equal(keyFromIp.length, 32)

  const keyFromCookie = resolveRateLimitClientKey(makeRequest({ cookie: 'dbpilot_uid=anon_12345678abcd' }))
  assert.equal(keyFromCookie.includes('anon_12345678abcd'), false)
  assert.equal(keyFromCookie.length, 32)

  assert.equal(resolveRateLimitClientKey(null), 'anonymous-local')

  // Disabled limiter allows repeated calls without throwing.
  const req = makeRequest({ 'x-forwarded-for': rawIp })
  consumeDemoQuota({ request: req, scope: 'chat', now: 3_000_000 })
  consumeDemoQuota({ request: req, scope: 'chat', now: 3_000_100 })
  consumeDemoQuota({ request: req, scope: 'chat', now: 3_000_200 })
})

test('describeAiServiceError tailors 429, 402, 401, timeout, and DemoRateLimitError messages', () => {
  const rateLimitErr = new DemoRateLimitError('限流提示：请配置自有 API Key', 12, 'chat')
  assert.equal(
    describeAiServiceError(rateLimitErr, { usesServerKey: true, timeoutMessage: 'timeout', fallbackMessage: 'fallback' }),
    '限流提示：请配置自有 API Key',
  )

  const err429 = new ApiRequestError({ status: 429, message: 'Too Many Requests' })
  assert.match(
    describeAiServiceError(err429, { usesServerKey: true, timeoutMessage: 'timeout', fallbackMessage: 'fallback' }),
    /自有 API Key/,
  )
  assert.equal(
    describeAiServiceError(err429, { usesServerKey: false, timeoutMessage: 'timeout', fallbackMessage: 'fallback' }),
    '模型服务触发限流（429），请稍后重试',
  )

  const err402 = new ApiRequestError({ status: 402, message: 'Insufficient Balance' })
  assert.match(
    describeAiServiceError(err402, { usesServerKey: true, timeoutMessage: 'timeout', fallbackMessage: 'fallback' }),
    /自有 API Key/,
  )
  assert.equal(
    describeAiServiceError(err402, { usesServerKey: false, timeoutMessage: 'timeout', fallbackMessage: 'fallback' }),
    '模型服务账户余额不足（402），请检查自有 API Key 额度',
  )

  const err401 = new ApiRequestError({ status: 401, message: 'Unauthorized' })
  assert.equal(
    describeAiServiceError(err401, { usesServerKey: false, timeoutMessage: 'timeout', fallbackMessage: 'fallback' }),
    '自定义 API Key 鉴权失败，请在「设置 → 模型服务」中检查密钥',
  )
  assert.equal(
    describeAiServiceError(err401, { usesServerKey: true, timeoutMessage: 'timeout', fallbackMessage: 'fallback' }),
    'fallback',
  )
})
