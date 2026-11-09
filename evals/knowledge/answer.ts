import type { KnowledgeCitation } from '../../src/lib/knowledge-types'
import { NO_EVIDENCE_ANSWER } from '../../src/server/knowledge/pipeline'
import type { KbEvalCase } from './scorer'

/** What one end-to-end run of the knowledge pipeline produced. */
export interface AnswerOutcome {
  text: string
  /** Final evidence, with `cited` set by the citation check. */
  citations: KnowledgeCitation[]
  citationCheck?: { status: string; output?: string }
  modelCalls: number
  latencyMs: number
  error?: string
}

export interface AnswerScore {
  /** The answer says the knowledge base has no basis (or no model call was made). */
  refused: boolean
  /** The citation check passed and the answer cites at least one source. */
  citationsValid: boolean
  cited: number
  /** Cited provisions that belong to a gold group. */
  citedRelevant: number
  goldGroups: number
  /** Gold groups with at least one cited provision. */
  goldGroupsCited: number
}

const REFUSAL = /知识库中未找到/

export function scoreAnswer(evalCase: KbEvalCase, outcome: AnswerOutcome, locate: (chunkId: string) => string[]): AnswerScore {
  const cited = outcome.citations.filter(c => c.cited)
  const citedLocators = cited.map(c => locate(c.chunkId))
  const isGold = (locators: string[]) => evalCase.gold.some(group => locators.some(l => group.includes(l)))
  return {
    refused: outcome.text.trim() === NO_EVIDENCE_ANSWER || REFUSAL.test(outcome.text),
    citationsValid: outcome.citationCheck?.status === 'done' && cited.length > 0,
    cited: cited.length,
    citedRelevant: citedLocators.filter(isGold).length,
    goldGroups: evalCase.gold.length,
    goldGroupsCited: evalCase.gold.filter(group => citedLocators.some(locators => locators.some(l => group.includes(l)))).length,
  }
}

export interface AnswerMetrics {
  cases: number
  outOfScopeCases: number
  errors: number
  /** In scope: answered rather than refused (higher is better). */
  answeredRate: number
  /** In scope, answered: citation check passed with at least one citation. */
  citationValidRate: number
  /** In scope, answered with citations: share of cited provisions that are gold. */
  citedPrecision: number
  /** In scope: share of gold facts the answer cites. */
  goldCoverage: number
  /** Out of scope: refused (higher is better). */
  outOfScopeRefusalRate: number
  latencyMs: { p50: number; p90: number }
  meanModelCalls: number
}

const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN

function percentile(values: number[], p: number): number {
  if (!values.length) return NaN
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]
}

export function summarizeAnswers(rows: { evalCase: KbEvalCase; outcome: AnswerOutcome; score: AnswerScore }[]): AnswerMetrics {
  const ok = rows.filter(r => !r.outcome.error)
  const inScope = ok.filter(r => r.evalCase.gold.length)
  const answered = inScope.filter(r => !r.score.refused)
  const withCitations = answered.filter(r => r.score.cited > 0)
  const outOfScope = ok.filter(r => !r.evalCase.gold.length)
  return {
    cases: inScope.length,
    outOfScopeCases: outOfScope.length,
    errors: rows.length - ok.length,
    answeredRate: mean(inScope.map(r => Number(!r.score.refused))),
    citationValidRate: mean(answered.map(r => Number(r.score.citationsValid))),
    citedPrecision: mean(withCitations.map(r => r.score.citedRelevant / r.score.cited)),
    goldCoverage: mean(inScope.map(r => r.score.goldGroupsCited / r.score.goldGroups)),
    outOfScopeRefusalRate: mean(outOfScope.map(r => Number(r.score.refused))),
    latencyMs: { p50: percentile(ok.map(r => r.outcome.latencyMs), 0.5), p90: percentile(ok.map(r => r.outcome.latencyMs), 0.9) },
    meanModelCalls: mean(ok.map(r => r.outcome.modelCalls)),
  }
}
