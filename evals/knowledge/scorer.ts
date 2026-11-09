import type { KbChunk } from '../../src/server/knowledge/types'

export interface KbEvalCase {
  id: string
  category: string
  question: string
  history?: { role: 'user' | 'assistant'; content: string }[]
  /**
   * One group per fact a complete answer needs; each group lists provisions that state
   * that fact equally well, as `docId:第X条` or `docId:名词解释N`. Empty for questions
   * the corpus cannot answer.
   */
  gold: string[][]
  notes?: string
}

const ARTICLE_LINE = /^(第[一二三四五六七八九十百零〇]+条)(?=\s)/gm
const LABEL_ARTICLE = /^(第[一二三四五六七八九十百零〇]+条)/
const GLOSSARY_LABEL = /^名词解释\s+(\d+)\./

/**
 * The provisions a chunk contains. Articles are read from the text (merged chunks hold
 * several); continuation parts of a split article only carry it in their label.
 */
export function chunkLocators(chunk: Pick<KbChunk, 'docId' | 'label' | 'text'>): string[] {
  const glossary = GLOSSARY_LABEL.exec(chunk.label)
  if (glossary) return [`${chunk.docId}:名词解释${glossary[1]}`]
  const articles = new Set([...chunk.text.matchAll(ARTICLE_LINE)].map(m => m[1]))
  const labelled = LABEL_ARTICLE.exec(chunk.label)
  if (labelled) articles.add(labelled[1])
  return [...articles].map(article => `${chunk.docId}:${article}`)
}

export interface RetrievalScore {
  /** Number of chunks retrieved (after relevance checks). */
  retrieved: number
  /** 1-based rank of the first chunk that satisfies any gold group; undefined if none does. */
  firstHit?: number
  /** For each gold group, the 1-based rank of the first chunk that satisfies it. */
  groupRanks: (number | undefined)[]
}

export function scoreRetrieval(evalCase: KbEvalCase, ranked: string[][]): RetrievalScore {
  const groupRanks = evalCase.gold.map((group) => {
    const index = ranked.findIndex(locators => locators.some(locator => group.includes(locator)))
    return index >= 0 ? index + 1 : undefined
  })
  const hits = groupRanks.filter((rank): rank is number => rank !== undefined)
  return { retrieved: ranked.length, firstHit: hits.length ? Math.min(...hits) : undefined, groupRanks }
}

export interface RetrievalMetrics {
  cases: number
  /** At least one gold group within the top k. */
  hitAt: Record<number, number>
  /** Mean share of gold groups found within the top k. */
  recallAt: Record<number, number>
  /** Every gold group found within the top k. */
  completeAt: Record<number, number>
  mrr: number
  /** In-scope questions for which nothing was retrieved (lower is better). */
  emptyRate: number
  /** Out-of-scope questions for which nothing was retrieved (higher is better). */
  outOfScopeEmptyRate: number
  outOfScopeCases: number
  meanRetrieved: number
}

export const KS = [1, 3, 5, 10] as const

const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN

export function summarizeRetrieval(scored: { evalCase: KbEvalCase; score: RetrievalScore }[]): RetrievalMetrics {
  const inScope = scored.filter(s => s.evalCase.gold.length)
  const outOfScope = scored.filter(s => !s.evalCase.gold.length)
  const within = (rank: number | undefined, k: number) => rank !== undefined && rank <= k
  const at = (f: (s: (typeof scored)[number], k: number) => number) =>
    Object.fromEntries(KS.map(k => [k, mean(inScope.map(s => f(s, k)))]))
  return {
    cases: inScope.length,
    hitAt: at((s, k) => Number(within(s.score.firstHit, k))),
    recallAt: at((s, k) => s.score.groupRanks.filter(rank => within(rank, k)).length / s.score.groupRanks.length),
    completeAt: at((s, k) => Number(s.score.groupRanks.every(rank => within(rank, k)))),
    mrr: mean(inScope.map(s => (s.score.firstHit ? 1 / s.score.firstHit : 0))),
    emptyRate: mean(inScope.map(s => Number(s.score.retrieved === 0))),
    outOfScopeEmptyRate: mean(outOfScope.map(s => Number(s.score.retrieved === 0))),
    outOfScopeCases: outOfScope.length,
    meanRetrieved: mean(inScope.map(s => s.score.retrieved)),
  }
}

/** Every gold locator must name a provision that exists; returns the ones that do not. */
export function unknownGold(cases: KbEvalCase[], chunks: Pick<KbChunk, 'docId' | 'label' | 'text'>[]): string[] {
  const known = new Set(chunks.flatMap(chunkLocators))
  return [...new Set(cases.flatMap(c => c.gold.flat()))].filter(locator => !known.has(locator))
}
