import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MetricCards, isKpiResult } from '../src/components/chat/MetricCards'
import { DataSummary } from '../src/components/chat/DataSummary'
import { AnalysisReportCard } from '../src/components/chat/AnalysisReportCard'
import { KnowledgeContextPanel } from '../src/components/knowledge/KnowledgeContextPanel'
import { getKnowledgeServiceLabel, KnowledgeServiceStatus } from '../src/components/knowledge/KnowledgeServiceStatus'
import { formatResultMetricValue, formatResultStatistic } from '../src/lib/result-data'
import type { SqlResultInfo } from '../src/lib/types'
import type { KnowledgeHealth, KnowledgeMessage } from '../src/lib/knowledge-types'

test('KPI values preserve decimal precision and never infer currency or percentage scales', () => {
  const result: SqlResultInfo = {
    columns: ['total', 'rate', 'ratio', '平均数量', '电量（MWh）', '成交金额（USD）'],
    rows: [{ total: 123, rate: 0.00123, ratio: 1.25, 平均数量: 2.75, '电量（MWh）': '18.0002', '成交金额（USD）': '12.3456' }],
    rowCount: 1,
    executionTime: 0,
  }
  const markup = renderToStaticMarkup(createElement(MetricCards, { result }))
  for (const expected of ['123', '0.00123', '1.25', '2.75', '18.0002', '12.3456', '电量（MWh）', '成交金额（USD）']) assert.ok(markup.includes(expected))
  assert.equal(markup.includes('¥'), false)
  assert.equal(markup.includes('%'), false)
  assert.equal(formatResultMetricValue('9007199254740993.0001'), '9007199254740993.0001')
})

test('empty or non-numeric result values do not masquerade as zero-valued KPI cards', () => {
  const result: SqlResultInfo = { columns: ['rate'], rows: [], rowCount: 1, executionTime: 0 }
  assert.equal(isKpiResult(result), false)
  for (const value of ['', ' ', null, undefined, false]) {
    assert.equal(isKpiResult({ ...result, rows: [{ rate: value }] }), false)
  }
  assert.equal(isKpiResult({ ...result, rows: [{ rate: 0 }] }), true)
})

test('summary statistics retain small decimal values without invented units', () => {
  assert.equal(formatResultStatistic(0.00012), '0.00012')
  const result: SqlResultInfo = { columns: ['rate'], rows: [{ rate: 0.00012 }, { rate: 0.00014 }], rowCount: 2, executionTime: 0 }
  const markup = renderToStaticMarkup(createElement(DataSummary, { result }))
  assert.ok(markup.includes('0.00012'))
  assert.ok(markup.includes('0.00014'))
  assert.equal(markup.includes('%'), false)
  assert.equal(markup.includes('¥'), false)
})

test('model-written reports are identified as AI analysis and preserve explicit units', () => {
  const markup = renderToStaticMarkup(createElement(AnalysisReportCard, {
    report: { summary: '模型生成的分析', metrics: [{ name: '交易电量', value: '120', unit: 'MWh' }] },
  }))
  assert.ok(markup.includes('AI 分析 · 请结合查询结果核对'))
  assert.ok(markup.includes('MWh'))
  assert.ok(markup.includes('120'))
})

test('knowledge health distinguishes pending/offline/online without revealing internal details', () => {
  const health: KnowledgeHealth = { status: 'offline', backendBase: 'http://internal-service:7860', lmModel: '/private/model', error: 'connect ECONNREFUSED http://internal-service:7860' }
  assert.equal(getKnowledgeServiceLabel(null, false), '未检测')
  assert.equal(getKnowledgeServiceLabel(health, true), '检测中')
  assert.equal(getKnowledgeServiceLabel(health, false), '暂不可用')
  assert.equal(getKnowledgeServiceLabel({ status: 'ok' }, false), '在线')
  const markup = renderToStaticMarkup(createElement(KnowledgeServiceStatus, { health, checking: false }))
  assert.ok(markup.includes('请重新检测'))
  for (const privateText of ['internal-service', 'ECONNREFUSED', '/private/model']) assert.equal(markup.includes(privateText), false)
})

test('knowledge Q/A evidence is marked unverified while real web source links remain intact', () => {
  const message: KnowledgeMessage = {
    id: 'answer', role: 'assistant', content: '回答', timestamp: '2026-10-21T00:00:00Z',
    evidence: { subQuestions: [], progress: [], toolSteps: [], memorySnippets: [{ question: '规则是什么？', answer: '历史回答' }], webResults: [{ title: '原始规则页面', url: 'https://example.com/rules', snippet: '页面片段' }] },
  }
  const markup = renderToStaticMarkup(createElement(KnowledgeContextPanel, { message, onClose() {} }))
  assert.ok(markup.includes('历史问答片段，未核验原始依据'))
  assert.ok(markup.includes('历史回答'))
  assert.ok(markup.includes('href="https://example.com/rules"'))
})
