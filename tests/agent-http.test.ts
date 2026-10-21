import test, { afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { apiRequest } from '../src/core/client/request'
import { apiStreamRequest } from '../src/core/client/stream-request'
import { invoke } from '../src/core/model/invoke'

afterEach(() => mock.restoreAll())

test('JSON model requests use the configured endpoint without redirecting credentials', async () => {
  const requests: Array<{ url: string; init: RequestInit }> = []
  mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    requests.push({ url, init })
    return Response.json({ ok: true })
  })
  assert.deepEqual(await apiRequest('https://proxy.example/v1/chat/completions', 'synthetic-key', { messages: [] }, 100), { ok: true })
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, 'https://proxy.example/v1/chat/completions')
  assert.equal(requests[0].init.redirect, 'error')
  assert.equal((requests[0].init.headers as Record<string, string>).Authorization, 'Bearer synthetic-key')
})

test('both same-origin and cross-origin model redirects fail closed without retry or follow-up', async () => {
  for (const location of ['https://proxy.example/canonical', 'https://untrusted.example/collect']) {
    let calls = 0
    mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
      calls++
      assert.equal(init.redirect, 'error')
      // A synthetic redirect Response also exercises wrappers that do not implement fetch's redirect policy.
      return Response.json({}, { status: 307, headers: { Location: location } })
    })
    await assert.rejects(apiRequest('https://proxy.example/v1', 'synthetic-key', {}, 100), /307/)
    await assert.rejects(async () => {
      for await (const _ of apiStreamRequest('https://proxy.example/v1', 'synthetic-key', {}, 100)) { /* consume */ }
    }, /307/)
    assert.equal(calls, 2)
    mock.restoreAll()
  }
})

test('JSON body timeout cancels the reader even after headers have arrived', async () => {
  let cancelled = false
  const response = new Response(new ReadableStream({ cancel() { cancelled = true } }))
  mock.method(globalThis, 'fetch', async () => response)
  await assert.rejects(apiRequest('https://example.test', 'test', {}, 15), { name: 'TimeoutError' })
  assert.equal(cancelled, true)
  assert.equal(response.body?.locked, false)
})

test('stalled provider error bodies respect request cancellation and release readers', async () => {
  let cancelled = false
  const response = new Response(new ReadableStream({ cancel() { cancelled = true } }), { status: 503 })
  mock.method(globalThis, 'fetch', async () => response)
  const controller = new AbortController()
  const pending = apiRequest('https://example.test', 'test', {}, 1000, 'POST', controller.signal)
  setTimeout(() => controller.abort(), 10)
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(cancelled, true)
  assert.equal(response.body?.locked, false)
})

test('unified model HTTP boundary removes PII and preserves tool protocol identifiers', async () => {
  let sent: any
  mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    sent = JSON.parse(init.body as string)
    return Response.json({ choices: [{ message: { role: 'assistant', content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })
  })
  await invoke({ provider: 'deepseek', model: 'test', apiKey: 'synthetic-key', baseURL: 'https://example.test', maxRetries: 0 }, {
    messages: [
      { role: 'assistant', content: null, tool_calls: [{ id: 'call_13812345678', type: 'function', function: { name: 'query', arguments: JSON.stringify({ phone: '13812345678' }) } }] },
      { role: 'tool', tool_call_id: 'call_13812345678', content: '联系 alice@example.com' },
      { role: 'tool', tool_call_id: 'call_secret', content: JSON.stringify({ success: true, data: JSON.stringify({ password: 'synthetic-secret-value' }) }) },
    ],
  })
  assert.equal(sent.messages[0].tool_calls[0].id, 'call_13812345678')
  assert.equal(sent.messages[1].tool_call_id, 'call_13812345678')
  assert.equal(sent.messages[0].tool_calls[0].function.arguments.includes('13812345678'), false)
  assert.equal(sent.messages[1].content.includes('alice@example.com'), false)
  assert.equal(sent.messages[2].content.includes('synthetic-secret-value'), false)
})
