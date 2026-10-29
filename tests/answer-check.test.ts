import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildAnswerCheckEvidence, buildAnswerCorrection, parseAnswerCheck } from '../src/lib/answer-check'
import type { ToolCallInfo } from '../src/lib/types'

test('failed or malformed answer checks remain unknown instead of reporting no hallucination', () => {
  for (const text of ['', '{', '{"hasFakeResult":"false"}', '{"other":true}']) {
    assert.deepEqual(parseAnswerCheck(text), { hasFakeResult: null, status: 'unavailable' })
  }
  assert.deepEqual(parseAnswerCheck('{"hasFakeResult":false}'), { hasFakeResult: false, status: 'not_detected' })
  assert.deepEqual(parseAnswerCheck('{"hasFakeResult":true}'), { hasFakeResult: true, status: 'suspected' })
})

test('a successful table list is schema evidence without requiring an SQL result', () => {
  const result = JSON.stringify({ database: 'demo', table_type: 'BASE TABLE', table_count: 2, tables: ['users', 'orders'], complete: true })
  const evidence = buildAnswerCheckEvidence(undefined, [{ name: 'list_tables', args: {}, status: 'completed', result }])
  const parsed = JSON.parse(evidence!)
  assert.equal(parsed.sqlResults, undefined)
  assert.deepEqual(parsed.metadata, [{ tool: 'list_tables', args: {}, result }])
  assert.deepEqual(JSON.parse(parsed.metadata[0].result).tables, ['users', 'orders'])
  // An empty database is also a successful result, rather than missing evidence.
  const empty = JSON.stringify({ table_count: 0, tables: [], complete: true })
  assert.equal(JSON.parse(buildAnswerCheckEvidence(undefined, [{ name: 'list_tables', args: {}, status: 'completed', result: empty }])!).metadata[0].result, empty)
})

test('only completed schema tools become metadata evidence, never SQL submissions or model reports', () => {
  const tools: ToolCallInfo[] = [
    { name: 'list_tables', args: {}, status: 'calling', result: 'stale result' },
    { name: 'list_tables', args: {}, status: 'error', result: 'stale result', error: 'permission denied' },
    { name: 'get_table_schema', args: { table_name: 'users' }, status: 'completed', error: 'failed', result: 'stale result' },
    { name: 'get_database_overview', args: {}, status: 'completed', result: ' ' },
    { name: 'execute_sql', args: { sql: 'SELECT COUNT(*) FROM users' }, status: 'completed', result: '{"status":"pending"}' },
    { name: 'report_analysis', args: {}, status: 'completed', result: '{"metrics":[{"value":"999"}]}' },
    { name: 'plan_query', args: {}, status: 'completed', result: '{"expected_row_type":"single_value"}' },
  ]
  assert.equal(buildAnswerCheckEvidence(undefined, tools), undefined)
})

test('schema evidence retains scope and approximation while remaining separate from confirmed SQL results', () => {
  const evidence = buildAnswerCheckEvidence('COUNT(*) = 421', [
    { name: 'get_database_overview', args: {}, status: 'completed', result: '共 100 张基础表（展示 10 张）\nusers (~400 rows)' },
    { name: 'get_table_schema', args: { table_name: 'users' }, status: 'completed', result: 'Table: users (~400 rows)\nColumns:\n  - id int PRIMARY KEY' },
    { name: 'list_tables', args: { table_type: 'VIEW' }, status: 'completed', result: '{"table_count":1,"tables":["active_users"],"table_type":"VIEW"}' },
  ])
  const parsed = JSON.parse(evidence!)
  assert.equal(parsed.sqlResults, 'COUNT(*) = 421')
  assert.equal(parsed.metadata.length, 3)
  assert.match(parsed.metadata[0].result, /~400 rows/)
  assert.equal(parsed.metadata[2].args.table_type, 'VIEW')
})

test('fresh metadata replaces repeated historical calls without merging different table scopes', () => {
  const evidence = buildAnswerCheckEvidence(undefined, [
    { name: 'list_tables', args: {}, status: 'completed', result: 'old list' },
    { name: 'list_tables', args: { table_type: 'VIEW' }, status: 'completed', result: 'view list' },
    { name: 'list_tables', args: {}, status: 'completed', result: 'fresh list' },
  ])
  const parsed = JSON.parse(evidence!)
  assert.equal(parsed.metadata.length, 2)
  assert.deepEqual(parsed.metadata.map((entry: { result: string }) => entry.result), ['fresh list', 'view list'])
})

test('a corrective retry preserves metadata grounding and only requests SQL for missing business data', () => {
  const evidence = buildAnswerCheckEvidence(undefined, [{ name: 'list_tables', args: {}, status: 'completed', result: '{"table_count":8,"tables":["users"]}' }])
  const correction = buildAnswerCorrection(evidence)
  assert.ok(correction.includes(evidence!))
  assert.match(correction, /证据足够时直接给出答案，无需提交 SQL/)
  assert.match(correction, /只有确实需要查询业务记录或精确聚合且没有已有结果时/)
  assert.match(correction, /近似行数不能作为精确记录数/)
  assert.match(buildAnswerCorrection(undefined), /暂无；请先获取所需的工具结果/)
})
