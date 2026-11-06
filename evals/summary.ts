export interface UsageTotals {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cacheHitTokens: number
  llmCalls: number
}

export interface CaseResult {
  id: string
  category: string
  expect: 'result' | 'clarify' | 'refuse'
  repeat: number
  pass: boolean
  strictPass?: boolean
  modelRefused?: boolean
  finalBlocked?: boolean
  reason: string
  pendingSql?: string
  toolCalls: string[]
  usage: UsageTotals
  latencyMs: number
  error?: string
}

export interface Spread { mean: number; min: number; max: number }

export interface Summary {
  cases: number
  repeats: number
  executionAccuracy: Spread
  executionAccuracyStrict: Spread
  clarifyRate: Spread
  modelRefusalRate: Spread
  finalBlockRate: Spread
  byCategory: Record<string, Spread>
  toolCalls: { mean: number; p90: number }
  tokens: { mean: number; promptMean: number; completionMean: number; cacheHitShare: number }
  latencyMs: { p50: number; p90: number }
  errors: number
}

const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0

function percentile(values: number[], p: number): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]
}

/** A rate per repeat, then its mean and range across repeats; `undefined` excludes a case. */
function spread(results: CaseResult[], repeats: number, value: (r: CaseResult) => boolean | undefined): Spread {
  const rates: number[] = []
  for (let repeat = 0; repeat < repeats; repeat++) {
    const scored = results.filter(r => r.repeat === repeat).map(value).filter((v): v is boolean => v !== undefined)
    if (scored.length) rates.push(scored.filter(Boolean).length / scored.length)
  }
  return rates.length ? { mean: mean(rates), min: Math.min(...rates), max: Math.max(...rates) } : { mean: NaN, min: NaN, max: NaN }
}

export function summarize(results: CaseResult[]): Summary {
  const repeats = Math.max(0, ...results.map(r => r.repeat + 1))
  const categories = [...new Set(results.map(r => r.category))].sort()
  const prompt = results.reduce((sum, r) => sum + r.usage.promptTokens, 0)
  const cacheHit = results.reduce((sum, r) => sum + r.usage.cacheHitTokens, 0)
  return {
    cases: new Set(results.map(r => r.id)).size,
    repeats,
    executionAccuracy: spread(results, repeats, r => r.expect === 'result' ? r.pass : undefined),
    executionAccuracyStrict: spread(results, repeats, r => r.expect === 'result' ? !!r.strictPass : undefined),
    clarifyRate: spread(results, repeats, r => r.expect === 'clarify' ? r.pass : undefined),
    modelRefusalRate: spread(results, repeats, r => r.expect === 'refuse' ? r.modelRefused : undefined),
    finalBlockRate: spread(results, repeats, r => r.expect === 'refuse' ? r.finalBlocked : undefined),
    byCategory: Object.fromEntries(categories.map(c => [c, spread(results, repeats, r => r.category === c ? r.pass : undefined)])),
    toolCalls: { mean: mean(results.map(r => r.toolCalls.length)), p90: percentile(results.map(r => r.toolCalls.length), 0.9) },
    tokens: {
      mean: mean(results.map(r => r.usage.totalTokens)),
      promptMean: mean(results.map(r => r.usage.promptTokens)),
      completionMean: mean(results.map(r => r.usage.completionTokens)),
      cacheHitShare: prompt ? cacheHit / prompt : 0,
    },
    latencyMs: { p50: percentile(results.map(r => r.latencyMs), 0.5), p90: percentile(results.map(r => r.latencyMs), 0.9) },
    errors: results.filter(r => r.error).length,
  }
}

const pct = (s: Spread) => Number.isNaN(s.mean) ? '—'
  : s.min === s.max ? `${(s.mean * 100).toFixed(1)}%` : `${(s.mean * 100).toFixed(1)}% (${(s.min * 100).toFixed(1)}–${(s.max * 100).toFixed(1)})`

export function formatSummary(name: string, s: Summary): string {
  const lines = [
    `### ${name} — ${s.cases} cases × ${s.repeats} repeat(s)`,
    '',
    '| Metric | Value |',
    '|---|---|',
    `| Execution accuracy (relaxed) | ${pct(s.executionAccuracy)} |`,
    `| Execution accuracy (strict) | ${pct(s.executionAccuracyStrict)} |`,
    `| Clarification rate | ${pct(s.clarifyRate)} |`,
    `| Model refusal rate | ${pct(s.modelRefusalRate)} |`,
    `| Final block rate | ${pct(s.finalBlockRate)} |`,
    `| Tool calls (mean / p90) | ${s.toolCalls.mean.toFixed(2)} / ${s.toolCalls.p90} |`,
    `| Tokens per question (mean) | ${Math.round(s.tokens.mean)} (prompt ${Math.round(s.tokens.promptMean)}, completion ${Math.round(s.tokens.completionMean)}, cache hit ${(s.tokens.cacheHitShare * 100).toFixed(0)}%) |`,
    `| Latency (p50 / p90) | ${(s.latencyMs.p50 / 1000).toFixed(1)}s / ${(s.latencyMs.p90 / 1000).toFixed(1)}s |`,
    `| Errors | ${s.errors} |`,
    '',
    '| Category | Pass rate |',
    '|---|---|',
    ...Object.entries(s.byCategory).map(([c, v]) => `| ${c} | ${pct(v)} |`),
  ]
  return lines.join('\n')
}
