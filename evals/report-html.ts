import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import type { EvalCase } from './scorer'
import { summarize, type CaseResult } from './summary'

// Usage: pnpm eval:html [--result evals/results/baseline-deepseek-flash.json] [--out evals/site]
// Builds one self-contained static page (no external scripts) from a result file and the dataset.

const CATEGORY: Record<string, string> = {
  single_table: '单表查询', multi_table: '多表关联', aggregation: '聚合统计',
  time_range: '时间范围', ambiguous: '歧义问题', dangerous: '危险操作',
}
const EXPECT: Record<string, string> = { result: '结果集比对', clarify: '应向用户澄清', refuse: '应拒绝写操作' }

function reasonZh(r: CaseResult): string {
  const s = r.reason
  if (s === 'result matches') return '结果一致'
  if (s === 'no SQL submitted') return r.toolCalls.includes('smart_filter') ? '未提交 SQL，转而调用 smart_filter 追问' : '未提交 SQL'
  const rows = s.match(/^result differs \((\d+) rows\)$/)
  if (rows) return `结果不一致（返回 ${rows[1]} 行）`
  if (s === 'asked via smart_filter') return '调用 smart_filter 澄清'
  if (s === 'model declined') return '模型拒绝执行'
  if (s.startsWith('model tried unsafe SQL')) return '模型提交了写操作，被 AST 守卫拦截'
  if (s === 'unsafe SQL reached confirmation') return '危险 SQL 进入待确认'
  if (s.startsWith('predicted SQL failed')) return '预测 SQL 执行报错'
  if (s === 'guessed and submitted SQL') return '未澄清，直接猜测提交 SQL'
  if (s === 'did not ask via smart_filter') return '未调用 smart_filter'
  if (s === 'agent error') return 'Agent 运行出错'
  return s
}

async function main() {
  const { values } = parseArgs({
    options: {
      result: { type: 'string', default: 'evals/results/baseline-deepseek-flash.json' },
      dataset: { type: 'string', default: 'evals/dataset/questions.jsonl' },
      out: { type: 'string', default: 'evals/site' },
    },
  })
  const report = JSON.parse(await readFile(resolve(values.result!), 'utf8')) as {
    config: { name: string; model: string; thinkingMode?: string; reasoningEffort?: string; now: string }
    startedAt: string; results: CaseResult[]
  }
  const cases = (await readFile(resolve(values.dataset!), 'utf8')).split('\n').filter(l => l.trim()).map(l => JSON.parse(l) as EvalCase)
  const summary = summarize(report.results)
  const byId = new Map(cases.map(c => [c.id, c]))

  const runs = report.results.map(r => ({
    id: r.id, repeat: r.repeat + 1, category: r.category, pass: r.pass, modelRefused: r.modelRefused, finalBlocked: r.finalBlocked,
    reason: reasonZh(r), tools: r.toolCalls, tokens: r.usage.totalTokens, llmCalls: r.usage.llmCalls, latencyMs: r.latencyMs, sql: r.pendingSql ?? '',
  }))
  const questions = cases.map(c => {
    const own = runs.filter(r => r.id === c.id).sort((a, b) => a.repeat - b.repeat)
    const gold = c.expect.type === 'result' ? [c.expect.gold_sql].flat() : []
    return {
      id: c.id, category: c.category, question: c.question, expect: c.expect.type, notes: c.notes ?? '', gold,
      pattern: own.map(r => (r.pass ? '✓' : '✗')).join(''), fails: own.filter(r => !r.pass).length,
      tokens: own.reduce((a, r) => a + r.tokens, 0) / (own.length || 1), latencyMs: own.reduce((a, r) => a + r.latencyMs, 0) / (own.length || 1),
    }
  })
  const categories = Object.entries(summary.byCategory).map(([id, s]) => ({
    id, label: CATEGORY[id] ?? id, ...s,
    count: cases.filter(c => c.category === id).length,
    expect: EXPECT[cases.find(c => c.category === id)?.expect.type ?? ''] ?? '',
  })).sort((a, b) => Object.keys(CATEGORY).indexOf(a.id) - Object.keys(CATEGORY).indexOf(b.id))
  const danger = cases.filter(c => c.expect.type === 'refuse').map(c => {
    const own = runs.filter(r => r.id === c.id)
    return {
      id: c.id, question: c.question, runs: own.length,
      refused: own.filter(r => r.modelRefused).length,
      guarded: own.filter(r => r.modelRefused === false && r.finalBlocked).length,
      leaked: own.filter(r => r.finalBlocked === false).length,
    }
  })
  const resultCases = cases.filter(c => c.expect.type === 'result').length
  const data = {
    config: {
      model: report.config.model, thinking: report.config.thinkingMode ?? '', effort: report.config.reasoningEffort ?? '',
      now: report.config.now, startedAt: report.startedAt, cases: cases.length, repeats: summary.repeats,
    },
    summary: { ...summary, ppPerCase: 100 / resultCases },
    categories, danger, questions, runs,
    failures: runs.filter(r => !r.pass).map(r => ({ ...r, question: byId.get(r.id)?.question ?? '' })),
    labels: { category: CATEGORY, expect: EXPECT },
  }

  const template = await readFile(resolve('evals/report-template.html'), 'utf8')
  // JSON inside <script> must not be able to close the tag.
  const json = JSON.stringify(data).replace(/</g, '\\u003c')
    .replaceAll(String.fromCharCode(0x2028), '\\u2028').replaceAll(String.fromCharCode(0x2029), '\\u2029')
  // A function replacement keeps `$` sequences in the data from being read as patterns.
  const html = template.replace('/*__REPORT_DATA__*/null', () => json)
  const outDir = resolve(values.out!)
  await mkdir(outDir, { recursive: true })
  await writeFile(resolve(outDir, 'index.html'), html)
  console.log(`Wrote ${resolve(outDir, 'index.html')} (${cases.length} cases × ${summary.repeats} repeats, ${(html.length / 1024).toFixed(0)} KB)`)
}

await main()
