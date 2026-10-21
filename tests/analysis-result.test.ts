import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatSqlResultForAI } from '../src/lib/analysis-result'

test('statistics and samples never reintroduce raw PII', () => {
  for (const count of [4, 40]) {
    const prompt = formatSqlResultForAI('SELECT email, note, amount FROM sample', {
      columns: ['email', 'note', 'amount'],
      rows: Array.from({ length: count }, () => ({ email: 'alice@example.com', note: '联系 bob@example.org', amount: 12 })),
      rowCount: count, executionTime: 5,
    })
    assert.equal(prompt.includes('alice@example.com'), false)
    assert.equal(prompt.includes('bob@example.org'), false)
    assert.ok(prompt.includes(`总和=${count * 12}`))
  }
})

test('truncated analysis declares scope and includes the SQL actually executed', () => {
  const prompt = formatSqlResultForAI('SELECT amount FROM sample', {
    columns: ['amount'], rows: [{ amount: 12 }], rowCount: 1, executionTime: 5,
    executedSql: 'SELECT amount FROM sample LIMIT 2', truncated: true, maxRows: 1,
  })
  assert.ok(prompt.includes('LIMIT 2'))
  assert.ok(prompt.includes('结果已截断'))
  assert.ok(prompt.includes('不能推断全表总数'))
})
