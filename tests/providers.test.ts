import test from 'node:test'
import assert from 'node:assert/strict'
import { encrypt } from '@/server/crypto'
import { resolveAiTarget } from '@/server/ai-credentials'
import { checkServerKey, describeServerProviders } from '@/server/providers'
import { buildThinkingParams, getProviderList } from '@/core/provider'
import { resolveConfig } from '@/core/model'
import { buildProviderOptions, compareModelLists, migrateLegacyBailian, parseModelList, formatModelList, validateBaseURL } from '@/lib/providers'
import { DEEPSEEK_PROVIDER } from '@/core/provider'
import { DEFAULT_MODEL } from '@/lib/constants'

const ENV_KEYS = ['ENCRYPTION_KEY', 'DEEPSEEK_API_KEY', 'DEEPSEEK_API_BASE_URL', 'BAILIAN_API_KEY', 'BAILIAN_API_BASE_URL', 'AI_PROVIDERS', 'QWEN_API_KEY']

function withEnv(values: Record<string, string | undefined>, fn: () => void) {
  const previous = new Map(ENV_KEYS.map(key => [key, process.env[key]]))
  try {
    for (const key of ENV_KEYS) delete process.env[key]
    process.env.ENCRYPTION_KEY = '11'.repeat(32)
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    fn()
  } finally {
    for (const key of ENV_KEYS) {
      const value = previous.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

test('custom providers require the user key and endpoint and never receive server keys', () => {
  withEnv({ DEEPSEEK_API_KEY: 'synthetic-server-key' }, () => {
    const userKey = encrypt('synthetic-user-key')
    assert.deepEqual(resolveAiTarget({ provider: 'custom-abc', apiKey: userKey, baseURL: 'https://proxy.example/v1/', thinkingStyle: 'enable_thinking' }), {
      provider: 'custom-abc', apiKey: 'synthetic-user-key', baseURL: 'https://proxy.example/v1', thinkingStyle: 'enable_thinking', supportsBeta: false,
    })
    assert.equal(resolveAiTarget({ provider: 'custom-abc', apiKey: userKey, baseURL: 'https://proxy.example/v1' }).thinkingStyle, 'none')
    assert.throws(() => resolveAiTarget({ provider: 'custom-abc', baseURL: 'https://proxy.example/v1' }), /自有 API Key/)
    assert.throws(() => resolveAiTarget({ provider: 'custom-abc', apiKey: userKey }), /Base URL/)
    assert.throws(() => resolveAiTarget({ provider: 'custom-abc', apiKey: encrypt('synthetic-server-key'), baseURL: 'https://proxy.example/v1' }), /服务器密钥/)
    assert.throws(() => resolveAiTarget({ provider: 'custom-abc', apiKey: userKey, baseURL: 'https://proxy.example/v1', thinkingStyle: 'evil' }), /思考参数/)
    assert.throws(() => resolveAiTarget({ provider: 'custom-abc', apiKey: userKey, baseURL: 'ftp://proxy.example' }), /HTTP/)
    assert.throws(() => resolveAiTarget({ provider: 'custom-abc', apiKey: userKey, baseURL: 'not a url' }), /HTTP/)
    assert.throws(() => resolveAiTarget({ provider: 'unknown', apiKey: userKey }), /未在服务器配置/)
    assert.throws(() => resolveAiTarget({ provider: '../x' }), /标识无效/)
    // A client-supplied thinking style never overrides a server provider's own.
    assert.equal(resolveAiTarget({ provider: 'deepseek', thinkingStyle: 'none' }).thinkingStyle, 'deepseek')
    assert.deepEqual(checkServerKey('custom-abc', userKey), { hasEnvKey: false, isServerKey: false })
  })
})

test('legacy BAILIAN_API_KEY keeps the 百炼 server provider; without it the provider is gone', () => {
  withEnv({}, () => {
    assert.deepEqual(getProviderList().map(p => p.id), ['deepseek'])
    assert.throws(() => resolveAiTarget({ provider: 'bailian' }), /未在服务器配置/)
  })
  withEnv({ BAILIAN_API_KEY: 'synthetic-bailian-key' }, () => {
    assert.deepEqual(getProviderList().map(p => p.id), ['deepseek', 'bailian'])
    const target = resolveAiTarget({ provider: 'bailian' })
    assert.equal(target.apiKey, 'synthetic-bailian-key')
    assert.equal(target.thinkingStyle, 'enable_thinking')
    assert.equal(target.baseURL, 'https://dashscope.aliyuncs.com/compatible-mode/v1')
  })
})

test('AI_PROVIDERS registers server providers and skips invalid entries', () => {
  const config = JSON.stringify([
    { id: 'qwen', name: '通义千问', baseURL: 'https://qwen.example/v1', apiKeyEnv: 'QWEN_API_KEY', models: ['qwen-a', { id: 'qwen-b', name: 'Qwen B' }], thinkingStyle: 'enable_thinking' },
    { id: 'custom-bad', name: 'x', baseURL: 'https://x.example', apiKeyEnv: 'X', models: ['m'] },
    { id: 'deepseek', name: 'dup', baseURL: 'https://x.example', apiKeyEnv: 'X', models: ['m'] },
    { id: 'nomodels', name: 'x', baseURL: 'https://x.example', apiKeyEnv: 'X', models: [] },
    { id: 'badurl', name: 'x', baseURL: 'file:///etc/passwd', apiKeyEnv: 'X', models: ['m'] },
  ])
  const warn = console.warn
  console.warn = () => {}
  try {
    withEnv({ AI_PROVIDERS: config, QWEN_API_KEY: 'synthetic-qwen-key' }, () => {
      assert.deepEqual(getProviderList().map(p => p.id), ['deepseek', 'qwen'])
      const qwen = describeServerProviders().find(p => p.id === 'qwen')!
      assert.equal(qwen.defaultModel, 'qwen-a')
      assert.equal(qwen.hasEnvKey, true)
      assert.equal(JSON.stringify(describeServerProviders()).includes('synthetic-qwen-key'), false)
      assert.equal(resolveAiTarget({ provider: 'qwen' }).apiKey, 'synthetic-qwen-key')
      // Server keys stay bound to their own provider.
      assert.throws(() => resolveAiTarget({ provider: 'deepseek', apiKey: encrypt('synthetic-qwen-key') }), /跨服务/)
    })
    withEnv({ AI_PROVIDERS: '{not json' }, () => {
      assert.deepEqual(getProviderList().map(p => p.id), ['deepseek'])
    })
  } finally {
    console.warn = warn
  }
})

test('thinking parameters follow the provider style', () => {
  assert.deepEqual(buildThinkingParams('deepseek', { type: 'enabled' }, 'high'), { thinking: { type: 'enabled', reasoning_effort: 'high' } })
  assert.deepEqual(buildThinkingParams('deepseek', { type: 'disabled' }, 'high'), { thinking: { type: 'disabled' } })
  assert.deepEqual(buildThinkingParams('enable_thinking', { type: 'disabled' }), { enable_thinking: false })
  assert.deepEqual(buildThinkingParams('enable_thinking', { type: 'enabled' }), { enable_thinking: true })
  assert.deepEqual(buildThinkingParams('none', { type: 'enabled' }, 'max'), {})
})

test('custom model configs never fall back to server credentials', () => {
  withEnv({ DEEPSEEK_API_KEY: 'synthetic-server-key' }, () => {
    assert.throws(() => resolveConfig({ provider: 'custom-abc', model: 'm', baseURL: 'https://x.example' }), /apiKey is required/)
    assert.throws(() => resolveConfig({ provider: 'custom-abc', model: 'm', apiKey: 'k' }), /baseURL is required/)
    const config = resolveConfig({ provider: 'custom-abc', model: 'm', apiKey: 'k', baseURL: 'https://x.example' })
    assert.equal(config.thinkingStyle, 'none')
    assert.equal(config.supportsBeta, false)
    assert.equal(resolveConfig({ provider: 'deepseek', model: 'm' }).supportsBeta, true)
    assert.throws(() => resolveConfig({ provider: 'nope', model: 'm', apiKey: 'k' }), /Unknown provider/)
  })
})

test('browser provider helpers: model lists, URLs, options and 百炼 migration', () => {
  assert.deepEqual(parseModelList(' a \n\nb | Model B\na\nc|x|y'), [{ id: 'a' }, { id: 'b', name: 'Model B' }, { id: 'c', name: 'x|y' }])
  assert.equal(formatModelList([{ id: 'a' }, { id: 'b', name: 'B' }]), 'a\nb | B')
  assert.equal(validateBaseURL('https://x.example/v1'), null)
  assert.ok(validateBaseURL('https://u:p@x.example'))
  assert.ok(validateBaseURL('javascript:alert(1)'))

  const custom = { id: 'custom-x', name: 'X', baseURL: 'https://x.example', apiKey: 'enc', models: [{ id: 'm1' }], thinkingStyle: 'none' as const }
  const options = buildProviderOptions(
    [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'd' }], defaultModel: 'd', thinkingStyle: 'deepseek', hasEnvKey: false }],
    [custom],
    {},
  )
  assert.deepEqual(options.map(o => [o.id, o.kind, o.defaultModel, o.configured]), [['deepseek', 'server', 'd', false], ['custom-x', 'custom', 'm1', true]])

  const migrated = migrateLegacyBailian({ bailian: { apiKey: 'enc-user', baseURL: '' }, deepseek: { apiKey: '', baseURL: '' } }, [], ['deepseek'])!
  assert.equal(migrated.migratedId, 'custom-bailian')
  assert.deepEqual(Object.keys(migrated.configs), ['deepseek'])
  assert.equal(migrated.customProviders[0].apiKey, 'enc-user')
  assert.equal(migrated.customProviders[0].thinkingStyle, 'enable_thinking')
  assert.equal(migrateLegacyBailian({ bailian: { apiKey: 'enc', baseURL: '' } }, [], ['deepseek', 'bailian']), null)
  assert.equal(migrateLegacyBailian({}, [], ['deepseek']), null)
  const keyless = migrateLegacyBailian({ bailian: { apiKey: '', baseURL: 'https://x' } }, [], ['deepseek'])!
  assert.equal(keyless.migratedId, undefined)
  assert.deepEqual(keyless.configs, {})
})

test('built-in DeepSeek defaults to the current Flash id and its default is listed', () => {
  assert.equal(DEEPSEEK_PROVIDER.defaultModel, 'deepseek-flash')
  assert.equal(DEFAULT_MODEL, DEEPSEEK_PROVIDER.defaultModel)
  assert.deepEqual(DEEPSEEK_PROVIDER.models.map(m => m.id), ['deepseek-flash', 'deepseek-v4-pro'])
})

test('fetched model ids are compared with the configured list without changing it', () => {
  const configured = [{ id: 'deepseek-flash', name: 'Flash' }, { id: 'deepseek-v4-pro' }, { id: 'old-model' }]
  const result = compareModelLists(configured, ['deepseek-v4-pro', 'deepseek-flash', 'deepseek-v5-preview'])
  assert.deepEqual(result.configured, ['deepseek-v4-pro', 'deepseek-flash'])
  assert.deepEqual(result.unconfigured, ['deepseek-v5-preview'])
  assert.deepEqual(result.missing, [{ id: 'old-model' }])
  assert.equal(configured.length, 3)
  assert.deepEqual(compareModelLists(configured, []).missing.length, 3)
})
