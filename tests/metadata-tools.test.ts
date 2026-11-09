import test, { afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { closePool, getDatabaseOverview } from '../src/server/database'
import { createDbAgent } from '../src/server/agent'
import { createDbTools, TOOL_ERROR_PREFIX } from '../src/server/tools'
import type { DatabaseConnection } from '../src/lib/types'
import type { IntentClassification } from '../src/server/intent-router'

const originalKey = process.env.DEEPSEEK_API_KEY
afterEach(() => {
  mock.restoreAll()
  if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY
  else process.env.DEEPSEEK_API_KEY = originalKey
})

function fixture(id: string): DatabaseConnection {
  return {
    id: `metadata-${id}`, name: 'offline metadata fixture', host: 'never-connect.invalid',
    port: 3306, user: 'fixture', password: 'synthetic', database: 'sandbox', env: 'dev', createdAt: '2026-10-29',
  }
}

function mockDatabase(query: (sql: string, values?: unknown[]) => unknown[] | Promise<unknown[]>) {
  mock.method(mysql, 'createPool', () => ({
    getConnection: async () => ({
      query: async (options: { sql: string; timeout: number }, values?: unknown[]) => {
        assert.equal(options.timeout, 30_000)
        return [await query(options.sql, values), []]
      },
      release() {},
    }),
    async end() {},
  }) as any)
}

function tableTool(connection: DatabaseConnection) {
  const context = createDbTools(connection)
  const tool = context.tools.find(tool => tool.name === 'list_tables')!
  return { ...context, tool }
}

async function metadataResult(tool: ReturnType<typeof tableTool>['tool'], args = '{}') {
  const envelope = JSON.parse(await tool.execute(args))
  assert.equal(envelope.success, true)
  return JSON.parse(envelope.data)
}

test('table inventory returns an exact complete count and caches base tables and views independently', async () => {
  const connection = fixture('scopes')
  const queries: unknown[][] = []
  mockDatabase((sql, values) => {
    assert.match(sql, /SELECT TABLE_NAME FROM INFORMATION_SCHEMA\.TABLES/i)
    assert.match(sql, /WHERE TABLE_SCHEMA = \? AND TABLE_TYPE = \?/i)
    assert.match(sql, /ORDER BY TABLE_NAME/i)
    assert.equal(values?.[0], 'sandbox')
    queries.push(values!)
    return (values?.[1] === 'VIEW' ? ['active_users'] : ['orders', 'users']).map(TABLE_NAME => ({ TABLE_NAME }))
  })
  try {
    const { tool, resultStore } = tableTool(connection)
    const tables = await metadataResult(tool)
    assert.deepEqual(tables, {
      database: 'sandbox', table_type: 'BASE TABLE', table_count: 2, tables: ['orders', 'users'], complete: true,
    })
    assert.deepEqual(await metadataResult(tool, '{"table_type":"BASE TABLE"}'), tables)
    const views = await metadataResult(tool, '{"table_type":"VIEW"}')
    assert.deepEqual(views, {
      database: 'sandbox', table_type: 'VIEW', table_count: 1, tables: ['active_users'], complete: true,
    })
    assert.deepEqual(await metadataResult(tool, '{"table_type":"VIEW"}'), views)
    assert.deepEqual(queries, [['sandbox', 'BASE TABLE'], ['sandbox', 'VIEW']])
    assert.equal(resultStore.get('list_tables')?.length, 4)
    assert.equal(resultStore.has('execute_sql'), false)
  } finally { await closePool(connection.id) }
})

test('an empty database returns authoritative zero metadata and reuses the empty result', async () => {
  const connection = fixture('empty')
  let queries = 0
  mockDatabase(() => { queries++; return [] })
  try {
    const { tool } = tableTool(connection)
    assert.deepEqual(await metadataResult(tool), {
      database: 'sandbox', table_type: 'BASE TABLE', table_count: 0, tables: [], complete: true,
    })
    await metadataResult(tool)
    assert.equal(queries, 1)
  } finally { await closePool(connection.id) }
})

test('an overview with no base tables does not claim that views are absent', async () => {
  const connection = fixture('overview-empty')
  mockDatabase(() => [])
  try {
    assert.match(await getDatabaseOverview(connection), /没有基础表（BASE TABLE，不含视图）/)
  } finally { await closePool(connection.id) }
})

test('failed metadata retrieval is an error rather than zero and is not cached', async () => {
  const connection = fixture('failure')
  let queries = 0
  mockDatabase(() => {
    if (++queries === 1) throw new Error('metadata access denied')
    return [{ TABLE_NAME: 'users' }]
  })
  try {
    const { tool, resultStore } = tableTool(connection)
    const failed = JSON.parse(await tool.execute('{}'))
    assert.match(failed.data, /查询失败: metadata access denied/)
    assert.equal(failed.data.includes('table_count'), false)
    assert.equal(resultStore.get('list_tables')?.[0], `${TOOL_ERROR_PREFIX}metadata access denied`)
    assert.equal((await metadataResult(tool)).table_count, 1)
    assert.equal(queries, 2)
  } finally { await closePool(connection.id) }
})

test('unrecognized inventory scopes are rejected before querying the database', async () => {
  const poolMock = mock.method(mysql, 'createPool', () => { throw new Error('unexpected database access') })
  const { tool, resultStore } = tableTool(fixture('invalid-scope'))
  const result = JSON.parse(await tool.execute('{"table_type":"users; DROP TABLE users"}'))
  assert.equal(result.success, false)
  assert.match(result.error, /Invalid arguments/)
  assert.equal(poolMock.mock.callCount(), 0)
  assert.equal(resultStore.size, 0)
})

function intent(type: IntentClassification['intent']): IntentClassification {
  return {
    intent: type, confidence: 1, needsFilter: 0, needsPlanning: false,
    reasoning: 'offline fixture', routingHint: 'offline fixture', suggestedTables: [], skipOverview: false,
  }
}

function completion(message: object, finishReason = 'stop') {
  return Response.json({
    choices: [{ message: { role: 'assistant', ...message }, finish_reason: finishReason }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  })
}

test('schema exploration can answer a table count using the metadata tool without submitting SQL', async () => {
  process.env.DEEPSEEK_API_KEY = 'synthetic-test-key'
  const connection = fixture('agent-count')
  let queries = 0
  let requests = 0
  mockDatabase((_sql, values) => {
    queries++
    assert.deepEqual(values, ['sandbox', 'BASE TABLE'])
    return [{ TABLE_NAME: 'orders' }, { TABLE_NAME: 'users' }]
  })
  mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
    const body = JSON.parse(options.body as string)
    requests++
    const system = body.messages.find((message: any) => message.role === 'system').content
    assert.match(system, /元数据.*真实证据/)
    assert.doesNotMatch(system, /只有 execute_sql 返回的才是真实数据|路径 A（简单查询/)
    if (requests === 1) {
      return completion({ content: null, tool_calls: [{ id: 'inventory', type: 'function', function: { name: 'list_tables', arguments: '{}' } }] }, 'tool_calls')
    }
    assert.equal(requests, 2)
    const evidence = JSON.parse(body.messages.find((message: any) => message.tool_call_id === 'inventory').content)
    assert.equal(evidence.success, true)
    assert.equal(JSON.parse(evidence.data).table_count, 2)
    return completion({ content: '当前数据库共有 **2 张基础表**。' })
  })
  try {
    const { agent, resultStore } = await createDbAgent(connection, {
      model: 'test', thinkingMode: 'disabled', userQuery: '查询总共有多少表', intent: intent('explore_schema'),
    })
    const result = await agent.generate({ prompt: '查询总共有多少表' })
    assert.equal(result.text, '当前数据库共有 **2 张基础表**。')
    assert.equal(requests, 2)
    assert.equal(queries, 1)
    assert.deepEqual([...resultStore.keys()], ['list_tables'])
  } finally { await closePool(connection.id) }
})

test('exact business row counts still submit SQL for confirmation instead of using approximate metadata', async () => {
  process.env.DEEPSEEK_API_KEY = 'synthetic-test-key'
  const connection = fixture('agent-rows')
  const queries: string[] = []
  let requests = 0
  mockDatabase(sql => {
    queries.push(sql)
    if (/^SELECT COUNT\(\*\) AS cnt FROM INFORMATION_SCHEMA\.TABLES/i.test(sql)) return [{ cnt: 1 }]
    if (sql === 'SHOW TABLES') return [{ Tables_in_sandbox: 'users' }]
    if (/SELECT COLUMN_NAME, COLUMN_TYPE/i.test(sql)) {
      return [{ COLUMN_NAME: 'id', COLUMN_TYPE: 'int', DATA_TYPE: 'int', IS_NULLABLE: 'NO', COLUMN_KEY: 'PRI', COLUMN_DEFAULT: null, COLUMN_COMMENT: '', EXTRA: 'auto_increment' }]
    }
    if (/^SHOW INDEX FROM/i.test(sql) || /FROM INFORMATION_SCHEMA\.KEY_COLUMN_USAGE/i.test(sql)) return []
    if (/^SELECT TABLE_ROWS FROM INFORMATION_SCHEMA\.TABLES/i.test(sql)) return [{ TABLE_ROWS: 123 }]
    assert.fail(`Business SQL must wait for user confirmation: ${sql}`)
  })
  mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
    const body = JSON.parse(options.body as string)
    requests++
    const system = body.messages.find((message: any) => message.role === 'system').content
    assert.match(system, /精确记录数|精确行数/)
    assert.match(system, /路径 A（简单查询/)
    let name: string
    let args: object
    if (requests === 1) {
      name = 'get_table_schema'
      args = { table_name: 'users' }
    } else {
      assert.equal(requests, 2)
      const schemaEvidence = JSON.parse(body.messages.find((message: any) => message.role === 'tool').content)
      assert.match(schemaEvidence.data, /~123 rows/)
      name = 'execute_sql'
      args = { sql: 'SELECT COUNT(*) AS user_count FROM users', explanation: '统计用户表准确记录数' }
    }
    const chunk = { choices: [{ delta: { tool_calls: [{ index: 0, id: `rows-${requests}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }] }
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
  })
  try {
    const { agent, resultStore } = await createDbAgent(connection, {
      model: 'test', thinkingMode: 'disabled', userQuery: 'users 表有多少条记录', intent: intent('simple_query'),
    })
    for await (const event of agent.stream({ prompt: 'users 表有多少条记录' })) {
      // Match the chat handler's boundary: stop as soon as SQL is pending confirmation.
      if (event.type === 'step' && resultStore.has('execute_sql')) break
    }
    assert.equal(requests, 2)
    const pending = JSON.parse(resultStore.get('execute_sql')![0])
    assert.equal(pending.status, 'pending_confirmation')
    assert.equal(pending.sql, 'SELECT COUNT(*) AS user_count FROM users')
    assert.equal(queries.some(sql => sql.includes('AS user_count')), false)
  } finally { await closePool(connection.id) }
})
