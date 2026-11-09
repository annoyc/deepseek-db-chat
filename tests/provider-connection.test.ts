import test, { afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { encrypt } from '@/server/crypto'
import { testProviderConnection } from '@/server/providers'

const previousKey = process.env.ENCRYPTION_KEY
process.env.ENCRYPTION_KEY = '11'.repeat(32)
afterEach(() => mock.restoreAll())
test.after(() => {
  if (previousKey === undefined) delete process.env.ENCRYPTION_KEY
  else process.env.ENCRYPTION_KEY = previousKey
})

function sse(chunks: unknown[]): Response {
  const body = chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n'
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
}

const toolCallStream = (name: string) => sse([
  { id: '1', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name, arguments: '' } }] }, finish_reason: null }] },
  { id: '1', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"status":"ok"}' } }] }, finish_reason: 'tool_calls' }] },
])

const completion = (content: string) => Response.json({
  id: '1', object: 'chat.completion', created: 0, model: 'm',
  choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content, reasoning_content: null, tool_calls: [] }, logprobs: null }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
})

const request = (thinkingStyle: string) => ({
  provider: 'custom-test', model: 'm', apiKey: encrypt('synthetic-user-key'), baseURL: 'https://proxy.example/v1', thinkingStyle,
})

test('connection test passes when streaming tool calls, JSON and thinking all work', async () => {
  const bodies: any[] = []
  mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, 'https://proxy.example/v1/chat/completions')
    assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer synthetic-user-key')
    const body = JSON.parse(String(init.body))
    bodies.push(body)
    if (body.stream) return toolCallStream('report_status')
    return completion(body.response_format ? '{"ok": true}' : 'ok')
  })
  const result = await testProviderConnection(request('enable_thinking'))
  assert.equal(result.ok, true)
  assert.deepEqual(result.checks.map(c => [c.key, c.status]), [['tools', 'pass'], ['json', 'pass'], ['thinking', 'pass']])
  assert.equal(bodies[0].tools[0].function.name, 'report_status')
  assert.equal(bodies[0].enable_thinking, false)
  assert.equal(bodies[2].enable_thinking, true)
})

test('connection test reports a model that ignores tools and skips thinking for style none', async () => {
  mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    assert.equal('enable_thinking' in body || 'thinking' in body, false)
    if (body.stream) return sse([{ id: '1', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }] }])
    return completion('not json')
  })
  const result = await testProviderConnection(request('none'))
  assert.equal(result.ok, false)
  assert.deepEqual(result.checks.map(c => [c.key, c.status]), [['tools', 'fail'], ['json', 'fail']])
  assert.match(result.checks[0].detail!, /function calling/)
})

test('authentication failures stop the remaining probes', async () => {
  let calls = 0
  mock.method(globalThis, 'fetch', async () => {
    calls++
    return Response.json({ error: { message: 'invalid key' } }, { status: 401 })
  })
  const result = await testProviderConnection(request('enable_thinking'))
  assert.equal(calls, 1)
  assert.deepEqual(result.checks.map(c => [c.key, c.status]), [['tools', 'fail'], ['json', 'skip'], ['thinking', 'skip']])
  assert.match(result.checks[0].detail!, /鉴权失败/)
})

test('a rejected thinking parameter suggests switching the style off', async () => {
  mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    if (body.enable_thinking === true) return Response.json({ error: { message: 'unknown parameter enable_thinking' } }, { status: 400 })
    if (body.stream) return toolCallStream('report_status')
    return completion('{"ok":true}')
  })
  const result = await testProviderConnection(request('enable_thinking'))
  assert.deepEqual(result.checks.map(c => [c.key, c.status]), [['tools', 'pass'], ['json', 'pass'], ['thinking', 'fail']])
  assert.match(result.checks[2].detail!, /不发送/)
})

test('an empty JSON-mode reply is retried once; non-JSON replies are previewed', async () => {
  let jsonCalls = 0
  mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    if (body.stream) return toolCallStream('report_status')
    if (body.response_format) return completion(jsonCalls++ === 0 ? '' : "{ok: true}")
    return completion('ok')
  })
  const recovered = await testProviderConnection(request('none'))
  assert.equal(jsonCalls, 2)
  assert.deepEqual(recovered.checks.map(c => [c.key, c.status]), [['tools', 'pass'], ['json', 'pass']])

  mock.restoreAll()
  mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    if (body.stream) return toolCallStream('report_status')
    return completion('Sure! Here is the answer you asked for.')
  })
  const failed = await testProviderConnection(request('none'))
  assert.equal(failed.checks[1].status, 'fail')
  assert.match(failed.checks[1].detail!, /「Sure! Here is the answer/)
})
