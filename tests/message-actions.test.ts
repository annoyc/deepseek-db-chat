import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildExportFilename,
  buildMarkdownExport,
  findTurnContext,
  trimExecutionLogForPrefix,
} from '../src/lib/message-actions'
import { submitLangfuseFeedback } from '../src/server/langfuse'

test('findTurnContext resolves user prompt, latest SQL result in turn, and turn position', () => {
  const messages = [
    { id: 'u1', role: 'user' as const, content: '看下本月GMV' },
    { id: 'a1', role: 'assistant' as const, content: '', sqlResult: { rowCount: 3 } },
    { id: 'a2', role: 'assistant' as const, content: '', sqlResult: { rowCount: 5 } },
    { id: 'a3', role: 'assistant' as const, content: '本月 GMV 为 120 万' },
    { id: 'u2', role: 'user' as const, content: '怎么理解复购口径？' },
    { id: 'a4', role: 'assistant' as const, content: '复购口径通常按去重买家计算' },
  ]

  const firstTurn = findTurnContext(messages, 'a3')
  assert.ok(firstTurn)
  assert.equal(firstTurn.userMessage?.id, 'u1')
  assert.equal(firstTurn.userMessageIndex, 0)
  assert.equal(firstTurn.latestVizMessageId, 'a2')
  assert.equal(firstTurn.isLatestTurn, false)

  const secondTurn = findTurnContext(messages, 'a4')
  assert.ok(secondTurn)
  assert.equal(secondTurn.userMessage?.id, 'u2')
  assert.equal(secondTurn.latestVizMessageId, null)
  assert.equal(secondTurn.isLatestTurn, true)
})

test('trimExecutionLogForPrefix drops SQL logs belonging to regenerated turns', () => {
  const log = [
    { sql: 'SELECT 1', success: true, summary: '1 row', timestamp: '2026-01-01T00:00:00Z' },
    { sql: 'SELECT 2', success: true, summary: '2 rows', timestamp: '2026-01-01T00:00:01Z' },
    { sql: 'SELECT 3', success: true, summary: '3 rows', timestamp: '2026-01-01T00:00:02Z' },
  ]

  assert.deepEqual(
    trimExecutionLogForPrefix(log, [{ role: 'user' }]),
    [],
  )
  assert.deepEqual(
    trimExecutionLogForPrefix(log, [
      { role: 'user' },
      { role: 'assistant', sqlResult: { rowCount: 1 } },
      { role: 'assistant' },
      { role: 'user' },
    ]),
    [log[0]],
  )
})

test('buildMarkdownExport formats question, answer, cited sources, and metadata footer', () => {
  const md = buildMarkdownExport({
    question: '近30天各品类GMV对比',
    answer: '美妆类目排名第一。',
    modelName: 'DeepSeek / DeepSeek V4.1 Flash',
    durationMs: 35600,
    queryCount: 8,
    citations: [
      { ref: '1', docTitle: '电力市场运行基本规则', locator: '第十条', statusLabel: '现行有效', cited: true },
      { ref: '2', docTitle: '未引用文档', cited: false },
    ],
    exportedAt: new Date(2026, 10, 23, 21, 5),
  })

  assert.match(md, /^# 近30天各品类GMV对比\n\n美妆类目排名第一。/)
  assert.match(md, /## 参考依据\n\n- \[1\] 电力市场运行基本规则 · 第十条（现行有效）/)
  assert.doesNotMatch(md, /未引用文档/)
  assert.match(md, /导出时间：2026-11-23 21:05 · 模型：DeepSeek \/ DeepSeek V4\.1 Flash · 8 次查询 · 耗时 35\.6s/)
})

test('buildExportFilename strips illegal filename characters and falls back cleanly', () => {
  const date = new Date(2026, 10, 23)
  assert.equal(
    buildExportFilename('华东/华南:复购率*对比?\n第二行', '分析报告', date),
    '华东 华南 复购率 对比-20261123.md',
  )
  assert.equal(buildExportFilename('   ', '数据分析报告', date), '数据分析报告-20261123.md')
})

test('submitLangfuseFeedback no-ops without credentials and sends idempotent upsert/delete when configured', async () => {
  const prevPub = process.env.LANGFUSE_PUBLIC_KEY
  const prevSec = process.env.LANGFUSE_SECRET_KEY
  const prevBase = process.env.LANGFUSE_BASE_URL

  try {
    delete process.env.LANGFUSE_PUBLIC_KEY
    delete process.env.LANGFUSE_SECRET_KEY
    let calls = 0
    const noOp = await submitLangfuseFeedback(
      { traceId: 'abcdef1234567890', rating: 'up', source: 'chat' },
      (async () => {
        calls++
        return new Response(null, { status: 200 })
      }) as typeof fetch,
    )
    assert.deepEqual(noOp, { synced: false })
    assert.equal(calls, 0)

    process.env.LANGFUSE_PUBLIC_KEY = 'pk-test'
    process.env.LANGFUSE_SECRET_KEY = 'sk-test'
    process.env.LANGFUSE_BASE_URL = 'https://us.cloud.langfuse.com/'

    const recorded: Array<{ url: string; method?: string; body?: string; auth?: string | null }> = []
    const mockFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      recorded.push({
        url: String(url),
        method: init?.method,
        body: typeof init?.body === 'string' ? init.body : undefined,
        auth: headers.get('authorization'),
      })
      return new Response('{}', { status: 200 })
    }) as typeof fetch

    const up = await submitLangfuseFeedback({ traceId: 'trace-12345678', rating: 'up', source: 'chat' }, mockFetch)
    assert.deepEqual(up, { synced: true })
    assert.equal(recorded[0].url, 'https://us.cloud.langfuse.com/api/public/scores')
    assert.equal(recorded[0].method, 'POST')
    assert.equal(recorded[0].auth, `Basic ${Buffer.from('pk-test:sk-test').toString('base64')}`)
    assert.deepEqual(JSON.parse(recorded[0].body!), {
      id: 'user-feedback:trace-12345678',
      traceId: 'trace-12345678',
      name: 'user_feedback',
      value: 1,
      dataType: 'BOOLEAN',
      metadata: { source: 'chat' },
    })

    const down = await submitLangfuseFeedback({ traceId: 'trace-12345678', rating: 'down', source: 'knowledge' }, mockFetch)
    assert.deepEqual(down, { synced: true })
    assert.equal(JSON.parse(recorded[1].body!).value, 0)

    const cleared = await submitLangfuseFeedback({ traceId: 'trace-12345678', rating: null }, mockFetch)
    assert.deepEqual(cleared, { synced: true })
    assert.equal(recorded[2].method, 'DELETE')
    assert.equal(recorded[2].url, 'https://us.cloud.langfuse.com/api/public/scores/user-feedback%3Atrace-12345678')
  } finally {
    if (prevPub === undefined) delete process.env.LANGFUSE_PUBLIC_KEY
    else process.env.LANGFUSE_PUBLIC_KEY = prevPub
    if (prevSec === undefined) delete process.env.LANGFUSE_SECRET_KEY
    else process.env.LANGFUSE_SECRET_KEY = prevSec
    if (prevBase === undefined) delete process.env.LANGFUSE_BASE_URL
    else process.env.LANGFUSE_BASE_URL = prevBase
  }
})
