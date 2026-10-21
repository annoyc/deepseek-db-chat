import test, { afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { subsetTables } from '../src/server/schema-subsetting'
import { classifyIntentWithLLM } from '../src/server/intent-router'
import { traceContent, traceMetadata, maskTelemetryAttribute, traceError } from '../src/core/telemetry'

const originalCapture = process.env.LANGFUSE_CAPTURE_CONTENT
const originalKey = process.env.DEEPSEEK_API_KEY
afterEach(() => {
  mock.restoreAll()
  if (originalCapture === undefined) delete process.env.LANGFUSE_CAPTURE_CONTENT
  else process.env.LANGFUSE_CAPTURE_CONTENT = originalCapture
  if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY
  else process.env.DEEPSEEK_API_KEY = originalKey
})

test('schema subsetting deduplicates seeded tables and reserves related join tables', () => {
  const tables = Array.from({ length: 50 }, (_, i) => ({ name: `orders_${i}`, comment: 'orders', rowCount: 1 }))
  tables.push({ name: 'customers', comment: 'clients', rowCount: 1 })
  const result = subsetTables(tables, 'orders', [{ from: 'orders_0', to: 'customers' }], ['ORDERS_0'])
  assert.equal(result.tables.length, 40)
  assert.equal(new Set(result.tables.map(t => t.name)).size, 40)
  assert.equal(result.hiddenCount, 11)
  assert.ok(result.tables.some(t => t.name === 'customers'))
})

test('intent classification performs one structured request with cancellation signal', async () => {
  process.env.DEEPSEEK_API_KEY = 'test-key'
  const controller = new AbortController()
  let calls = 0
  mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
    calls++
    const body = JSON.parse(options.body as string)
    assert.deepEqual(body.response_format, { type: 'json_object' })
    assert.equal(options.signal?.aborted, false)
    return Response.json({ choices: [{ message: { role: 'assistant', content: JSON.stringify({ intent: 'simple_query', confidence: 0.9, needsFilter: 0, needsPlanning: false, reasoning: 'count', suggestedTables: ['users'] }) } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })
  })
  const result = await classifyIntentWithLLM('users表有多少条记录', false, { provider: 'deepseek', model: 'test' }, controller.signal)
  assert.equal(result.intent, 'simple_query')
  assert.deepEqual(result.suggestedTables, ['users'])
  assert.equal(calls, 1)
})

test('cancelled classification is not swallowed as a successful fallback', async () => {
  process.env.DEEPSEEK_API_KEY = 'test-key'
  const controller = new AbortController()
  controller.abort()
  let calls = 0
  mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({}) })
  await assert.rejects(classifyIntentWithLLM('统计订单', false, { provider: 'deepseek', model: 'test' }, controller.signal), { name: 'AbortError' })
  assert.equal(calls, 0)
})

test('telemetry defaults to metadata only and excludes SQL/content/database/IP', () => {
  delete process.env.LANGFUSE_CAPTURE_CONTENT
  assert.equal(traceContent({ query: 'select secret', phone: '13812345678' }), undefined)
  assert.deepEqual(traceMetadata({ provider: 'deepseek', messageCount: 2, database: 'private_db', ip: '192.0.2.1', sql: 'select secret' }), { provider: 'deepseek', messageCount: 2 })
  assert.deepEqual(maskTelemetryAttribute({ input: 'secret', output: 'secret' }), {})
  assert.equal(traceError(new Error('mysql://root:password@db')), 'RequestError')
})

test('explicit telemetry content capture still masks PII', () => {
  process.env.LANGFUSE_CAPTURE_CONTENT = 'true'
  assert.equal(JSON.stringify(traceContent({ phone: '13812345678' })).includes('13812345678'), false)
  assert.equal(JSON.stringify(maskTelemetryAttribute(JSON.stringify({ email: 'alice@example.com' }))).includes('alice@example.com'), false)
})

test('agent early return closes all nested model iterators', async () => {
  const { generateStream } = await import('../src/core/generate/generate-stream')
  let cleanedUp = false
  const model = {
    withConfig() { return model },
    async *invokeStream() {
      try {
        yield { choices: [{ delta: { content: 'hello' }, finish_reason: null }] }
        await new Promise<void>(() => {})
      } finally { cleanedUp = true }
    },
  }
  for await (const event of generateStream({ model: model as any, prompt: 'hello' })) {
    if (event.type === 'text-delta') break
  }
  assert.equal(cleanedUp, true)
})

test('timed-out tools receive cancellation and are not automatically replayed', async () => {
  const { tool } = await import('../src/core/tool')
  const { z } = await import('zod')
  let calls = 0
  let cancelled = false
  const cancellableTool = tool({
    name: 'slow-read', description: 'test', schema: z.object({}), timeout: 15, retries: 3,
    execute: async (_args, { signal }) => {
      calls++
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => { cancelled = true; reject(signal.reason) }, { once: true })
      })
    },
  })
  const result = JSON.parse(await cancellableTool.execute('{}'))
  assert.equal(result.success, false)
  assert.equal(calls, 1)
  assert.equal(cancelled, true)
})
