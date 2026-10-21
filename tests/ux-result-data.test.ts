import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzeChartData } from '../src/components/chat/ResultChart'
import {
  buildResultChartRows,
  canUseResultPie,
  getResultPage,
  recommendResultChartType,
  resultRowsToMarkdown,
  sortResultRows,
  toResultNumber,
} from '../src/lib/result-data'

test('sorting includes rows beyond the first page without mutating the SQL result', () => {
  const rows = Array.from({ length: 250 }, (_, index) => ({ id: index + 1, amount: index }))
  const sorted = sortResultRows(rows, 'amount', 'desc')
  const first = getResultPage(sorted, 0)
  const last = getResultPage(sorted, 2)
  assert.equal(first.rows[0].amount, 249)
  assert.equal(first.rows.at(-1)?.amount, 150)
  assert.equal(last.rows.length, 50)
  assert.equal(last.rows.at(-1)?.amount, 0)
  assert.equal(rows[0].amount, 0)
  assert.equal(getResultPage(sorted, 20).page, 2)
})

test('numeric sorting preserves zero and puts missing values last in both directions', () => {
  const rows = [{ amount: null }, { amount: '10' }, { amount: 0 }, { amount: '2' }, { amount: undefined }]
  assert.deepEqual(sortResultRows(rows, 'amount', 'asc').map((row) => row.amount), [0, '2', '10', null, undefined])
  assert.deepEqual(sortResultRows(rows, 'amount', 'desc').map((row) => row.amount), ['10', '2', 0, null, undefined])
})

test('chart data includes all returned rows and preserves time granularity and long labels', () => {
  const rows = Array.from({ length: 125 }, (_, index) => ({ time: `2026-10-21T12:00:${String(index).padStart(3, '0')}Z`, amount: index }))
  const chart = buildResultChartRows(rows, 'time', ['amount'])
  assert.equal(chart.length, 125)
  assert.equal(chart[124].name, rows[124].time)
  assert.equal(chart[124].amount, 124)
  const dates = buildResultChartRows([
    { time: '2025-01-01T01:00:00+08:00', amount: 1 },
    { time: '2026-01-01T02:00:00+08:00', amount: 2 },
  ], 'time', ['amount'])
  assert.equal(dates[0].name, '2025-01-01T01:00:00+08:00')
  assert.equal(dates[1].name, '2026-01-01T02:00:00+08:00')
})

test('missing and invalid chart values remain gaps instead of fabricated zeroes', () => {
  const values = [null, undefined, '', ' ', false, 'invalid', Infinity, 0, '0', '-2.5']
  assert.deepEqual(values.map(toResultNumber), [null, null, null, null, null, null, null, 0, 0, -2.5])
  const chart = buildResultChartRows(values.map((amount, index) => ({ label: index, amount })), 'label', ['amount'])
  assert.deepEqual(chart.map((row) => row.amount), [null, null, null, null, null, null, null, 0, 0, -2.5])
})

test('chart recommendations preserve temporal and categorical semantics', () => {
  assert.equal(recommendResultChartType(true), 'line')
  assert.equal(recommendResultChartType(false), 'bar')
  const valid = [{ name: 'A', amount: 2 }, { name: 'B', amount: 3 }]
  assert.equal(canUseResultPie(valid, ['amount'], false), true)
  assert.equal(canUseResultPie(valid, ['amount'], true), false)
  assert.equal(canUseResultPie([{ name: 'A', amount: -2 }, valid[1]], ['amount'], false), false)
  assert.equal(canUseResultPie([{ name: 'A', amount: null }, valid[1]], ['amount'], false), false)
  assert.equal(canUseResultPie([valid[0], valid[0]], ['amount'], false), false)
  assert.equal(canUseResultPie(valid, ['amount', 'count'], false), false)
})

test('rendered chart analysis keeps complete SQL data in both automatic and AI-hinted paths', () => {
  const rows = Array.from({ length: 150 }, (_, index) => ({ date: `2026-10-21T${String(index % 24).padStart(2, '0')}:00:00+08:00`, amount: index === 5 ? null : index }))
  for (const hint of [undefined, { labelCol: 'date', valueCols: ['amount'] }]) {
    const analysis = analyzeChartData(['date', 'amount'], rows, hint)
    assert.ok(analysis)
    assert.equal(analysis.data.length, 150)
    assert.equal(analysis.data[149].name, rows[149].date)
    assert.equal(analysis.data[5].amount, null)
    assert.equal(analysis.recommended, 'line')
  }
})

test('many categories do not imply continuous time and remain a bar chart', () => {
  const rows = Array.from({ length: 40 }, (_, index) => ({ region: `区域 ${index}`, amount: index * 2 }))
  assert.equal(analyzeChartData(['region', 'amount'], rows)?.recommended, 'bar')
})

test('copy includes every returned row and escapes Markdown separators', () => {
  const rows = Array.from({ length: 125 }, (_, index) => ({ label: index === 124 ? 'last|row\nnext' : `row ${index}` }))
  const output = resultRowsToMarkdown(['label'], rows)
  assert.equal(output.split('\n').length, 127)
  assert.ok(output.includes('last\\|row<br>next'))
})
