import test, { afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { buildRoutingPrompt, classifyIntentWithLLM } from '../src/server/intent-router'

const originalKey = process.env.DEEPSEEK_API_KEY
afterEach(() => {
  mock.restoreAll()
  if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY
  else process.env.DEEPSEEK_API_KEY = originalKey
})

const modelConfig = { provider: 'deepseek' as const, model: 'test' }

test('table inventory questions route directly to metadata without a classifier request', async () => {
  delete process.env.DEEPSEEK_API_KEY
  let calls = 0
  mock.method(globalThis, 'fetch', async () => {
    calls++
    throw new Error('inventory queries must not need classification')
  })

  for (const question of [
    '查询总共有多少表',
    '当前数据库共有多少张表？',
    '请帮我统计数据库中的表数量',
    '数据库一共有几张基础表',
    '有哪些表',
    '列出当前数据库的所有表',
    '查看完整表列表',
    '获取数据库的表清单',
    '查看所有视图',
    'How many tables are there?',
    'How many tables are in the current database?',
    'List all tables in the database.',
    'Count tables',
  ]) {
    const result = await classifyIntentWithLLM(question, true, modelConfig)
    assert.equal(result.intent, 'explore_schema', question)
    assert.equal(result.needsFilter, 0, question)
    assert.equal(result.needsPlanning, false, question)
    assert.equal(result.skipOverview, false, question)
    assert.match(buildRoutingPrompt(result), /list_tables/)
    assert.match(buildRoutingPrompt(result), /直接回答/)
  }
  assert.equal(calls, 0)
})

test('row counts, business data, compound questions and explicit SQL requests retain model classification', async () => {
  process.env.DEEPSEEK_API_KEY = 'test-key'
  let calls = 0
  mock.method(globalThis, 'fetch', async () => {
    calls++
    return Response.json({
      choices: [{ message: { role: 'assistant', content: JSON.stringify({
        intent: 'simple_query', confidence: 0.9, needsFilter: 0,
        needsPlanning: false, reasoning: 'requires data query', suggestedTables: ['users'],
      }) } }],
    })
  })
  const questions = [
    'users表有多少条记录',
    '用户表总共多少条数据',
    '统计订单数量',
    '查询总共有多少表，并统计每张表的准确记录数',
    '有哪些表以及最近7天订单量',
    '用 SQL 查询数据库表数量',
    'How many rows are in users?',
    'List tables and show the top 10 users',
    'Count tables by category',
    'SELECT COUNT(*) FROM users',
  ]
  for (const question of questions) {
    const result = await classifyIntentWithLLM(question, false, modelConfig)
    assert.equal(result.intent, 'simple_query', question)
    assert.deepEqual(result.suggestedTables, ['users'], question)
  }
  assert.equal(calls, questions.length)
})

test('cancelled metadata classification respects cancellation before its direct route', async () => {
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    classifyIntentWithLLM('查询总共有多少表', false, modelConfig, controller.signal),
    { name: 'AbortError' },
  )
})
