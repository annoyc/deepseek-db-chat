import test from 'node:test'
import assert from 'node:assert/strict'
import { encrypt, decrypt } from '@/server/crypto'
import { resolveAiCredentials } from '@/server/ai-credentials'

test('server keys and cached copies are bound to the trusted endpoint; custom keys still work', () => {
  const keys = ['ENCRYPTION_KEY', 'DEEPSEEK_API_KEY', 'DEEPSEEK_API_BASE_URL', 'BAILIAN_API_KEY']
  const previous = new Map(keys.map(key => [key, process.env[key]]))
  try {
    process.env.ENCRYPTION_KEY = '11'.repeat(32)
    process.env.DEEPSEEK_API_KEY = 'synthetic-server-key'
    process.env.BAILIAN_API_KEY = 'synthetic-other-server-key'
    delete process.env.DEEPSEEK_API_BASE_URL
    assert.deepEqual(resolveAiCredentials('deepseek'), {
      apiKey: 'synthetic-server-key', baseURL: 'https://api.deepseek.com',
    })
    assert.equal(resolveAiCredentials('deepseek', undefined, 'https://api.deepseek.com/').apiKey, 'synthetic-server-key')
    assert.throws(() => resolveAiCredentials('deepseek', undefined, 'https://untrusted.example'), /自有 API Key/)
    assert.throws(() => resolveAiCredentials('deepseek', encrypt('synthetic-server-key'), 'https://untrusted.example'), /自有 API Key/)
    assert.throws(() => resolveAiCredentials('deepseek', encrypt('synthetic-other-server-key'), 'https://untrusted.example'), /跨服务/)
    const custom = encrypt('synthetic-user-key')
    assert.equal(decrypt(custom), 'synthetic-user-key')
    assert.deepEqual(resolveAiCredentials('deepseek', custom, 'https://proxy.example/v1/'), {
      apiKey: 'synthetic-user-key', baseURL: 'https://proxy.example/v1',
    })
    process.env.DEEPSEEK_API_BASE_URL = 'https://managed-proxy.example/v1/'
    assert.equal(resolveAiCredentials('deepseek').baseURL, 'https://managed-proxy.example/v1')
    assert.throws(() => resolveAiCredentials('deepseek', undefined, 'https://api.deepseek.com'), /自有 API Key/)
    assert.throws(() => resolveAiCredentials('deepseek', custom, 'file:///tmp/config'), /HTTP/)
    assert.throws(() => resolveAiCredentials('deepseek', custom, 'https://user:password@proxy.example'), /HTTP/)
    process.env.ENCRYPTION_KEY = 'z'.repeat(64)
    assert.throws(() => encrypt('synthetic'), /ENCRYPTION_KEY/)
  } finally {
    for (const key of keys) {
      const value = previous.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
