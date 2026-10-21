import test, { afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { apiStreamRequest } from '../src/core/client/stream-request'
import { abortable, createManagedStream } from '../src/core/client/lifecycle'
import { withRetry } from '../src/core/client/retry'
import { ApiRequestError } from '../src/core/client/errors'
import { requestKnowledgeBackend, readKnowledgeStream } from '../src/core/client/knowledge-request'

const encoder = new TextEncoder()
afterEach(() => mock.restoreAll())

test('cancelling the response immediately aborts upstream work and ignores late writes', async () => {
  let upstreamSignal: AbortSignal | undefined
  let finished = false
  const stream = createManagedStream(async ({ signal, enqueue }) => {
    upstreamSignal = signal
    try { await abortable(new Promise<void>(() => {}), signal) }
    finally { finished = true; enqueue(encoder.encode('late')) }
  }, { deadlineMs: 1000, onError: () => assert.fail('cancel is not an error event') })
  await Promise.resolve()
  await stream.cancel()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(upstreamSignal?.aborted, true)
  assert.equal(finished, true)
})

test('task deadline emits one error and closes the stream without double-close', async () => {
  let errors = 0
  const stream = createManagedStream(async ({ signal }) => {
    await abortable(new Promise<void>(() => {}), signal)
  }, { deadlineMs: 15, onError: (error, enqueue) => {
    assert.equal((error as Error).name, 'TimeoutError')
    errors++
    enqueue(encoder.encode('timeout'))
  } })
  assert.equal(await new Response(stream).text(), 'timeout')
  assert.equal(errors, 1)
})

test('first-byte timeout covers empty response headers and releases upstream reader', async () => {
  let cancelled = false
  mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({ cancel() { cancelled = true } }), { headers: { 'content-type': 'text/event-stream' } }))
  await assert.rejects(async () => {
    for await (const _ of apiStreamRequest('https://example.test', 'test', {}, 15)) { /* consume */ }
  }, /first response byte/)
  assert.equal(cancelled, true)
})

test('stream idle timeout is distinct from first-byte and total deadlines', async () => {
  let cancelled = false
  mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    start(c) { c.enqueue(encoder.encode('data: {"choices":[]}\n\n')) },
    cancel() { cancelled = true },
  })))
  const received: unknown[] = []
  await assert.rejects(async () => {
    for await (const chunk of apiStreamRequest('https://example.test', 'test', {}, 100, undefined, { idleTimeoutMs: 15, deadlineMs: 300 })) received.push(chunk)
  }, /idle timeout/)
  assert.equal(received.length, 1)
  assert.equal(cancelled, true)
})

test('consumer early return cancels the model body and supports split/final SSE events', async () => {
  let cancelled = false
  mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    start(c) { c.enqueue(encoder.encode('data: {"cho')); c.enqueue(encoder.encode('ices":[]}\n\n')) },
    cancel() { cancelled = true },
  })))
  for await (const _ of apiStreamRequest('https://example.test', 'test', {})) break
  assert.equal(cancelled, true)
})

test('aborting retry backoff prevents a second provider request', async () => {
  const controller = new AbortController()
  let attempts = 0
  const result = withRetry(async () => {
    attempts++
    throw new ApiRequestError({ status: 429, message: 'rate limited', retryAfter: 10 })
  }, 3, controller.signal)
  setTimeout(() => controller.abort(), 10)
  await assert.rejects(result, { name: 'AbortError' })
  assert.equal(attempts, 1)
})

test('knowledge only falls back for explicitly unsupported streaming endpoints', async () => {
  for (const status of [404, 405, 501]) {
    const paths: string[] = []
    mock.method(globalThis, 'fetch', async (url: string) => {
      paths.push(url)
      return paths.length === 1 ? new Response('', { status }) : Response.json({ answer: 'ok' })
    })
    const result = await requestKnowledgeBackend('https://example.test', { message: 'hello' }, new AbortController().signal)
    assert.equal(result.streaming, false)
    assert.deepEqual(paths, ['https://example.test/chat/stream', 'https://example.test/chat'])
    mock.restoreAll()
  }
})

test('knowledge network failures, 500 and invalid content types do not replay generation', async () => {
  for (const response of [new Error('network'), new Response('', { status: 500 }), new Response('not SSE')]) {
    let calls = 0
    mock.method(globalThis, 'fetch', async () => { calls++; if (response instanceof Error) throw response; return response })
    await assert.rejects(requestKnowledgeBackend('https://example.test', {}, new AbortController().signal))
    assert.equal(calls, 1)
    mock.restoreAll()
  }
})

test('knowledge idle timeout cancels the backend reader', async () => {
  let cancelled = false
  const response = new Response(new ReadableStream({ cancel() { cancelled = true } }))
  await assert.rejects(async () => {
    for await (const _ of readKnowledgeStream(response, new AbortController().signal, 15)) { /* consume */ }
  }, { name: 'TimeoutError' })
  assert.equal(cancelled, true)
})

test('stream total deadline still expires while data keeps arriving', async () => {
  let timer: ReturnType<typeof setInterval>
  let cancelled = false
  mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    start(c) {
      c.enqueue(encoder.encode('data: {"choices":[]}\n\n'))
      timer = setInterval(() => c.enqueue(encoder.encode(': keepalive\n\n')), 5)
    },
    cancel() { cancelled = true; clearInterval(timer) },
  })))
  await assert.rejects(async () => {
    for await (const _ of apiStreamRequest('https://example.test', 'test', {}, 100, undefined, { idleTimeoutMs: 100, deadlineMs: 25 })) { /* consume */ }
  }, /Task deadline exceeded/)
  assert.equal(cancelled, true)
})
