export interface ScoredIndex {
  index: number
  score: number
  /**
   * Share of the query's IDF weight that the document matches, 0–1. Terms the corpus
   * lacks still count in the total, so a chunk matching only a common word such as
   * 个人 in a question about a blog link scores close to zero.
   */
  coverage: number
  /** Sum of the IDF of the distinct query terms the document matches. */
  matchedIdf: number
}

export interface RelevanceGate {
  /** Keep a hit that covers at least this share of the query's IDF weight... */
  minCoverage: number
  /** ...or whose matched terms carry at least this much IDF in total. */
  minMatchedIdf: number
}

/**
 * A keyword hit is kept if it covers enough of the question, or matches enough specific
 * terms. Noise typically matches one common word (个人, 电价: matched IDF ≤ 5.4), while
 * colloquial questions with low coverage still match two or more specific terms
 * (≥ 6.3). Calibrated on evals/knowledge; IDF scales with corpus size (≈ 6.5 max at
 * 325 chunks), so recalibrate when the corpus changes substantially.
 */
export const KEYWORD_RELEVANCE: RelevanceGate = { minCoverage: 0.2, minMatchedIdf: 6 }
export const NO_RELEVANCE_GATE: RelevanceGate = { minCoverage: 0, minMatchedIdf: 0 }

/** Okapi BM25 over pre-tokenized documents; built in memory when the knowledge base loads. */
export class Bm25Index {
  private readonly postings = new Map<string, { doc: number; tf: number }[]>()
  private readonly lengths: Float64Array
  private readonly averageLength: number

  constructor(documents: string[][], private readonly k1 = 1.2, private readonly b = 0.75) {
    this.lengths = new Float64Array(documents.length)
    documents.forEach((tokens, doc) => {
      this.lengths[doc] = tokens.length
      const counts = new Map<string, number>()
      for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1)
      for (const [term, tf] of counts) {
        const list = this.postings.get(term)
        if (list) list.push({ doc, tf })
        else this.postings.set(term, [{ doc, tf }])
      }
    })
    const total = this.lengths.reduce((sum, value) => sum + value, 0)
    this.averageLength = documents.length ? total / documents.length : 0
  }

  get size(): number {
    return this.lengths.length
  }

  idf(term: string): number {
    const df = this.postings.get(term)?.length ?? 0
    return Math.log(1 + (this.size - df + 0.5) / (df + 0.5))
  }

  /**
   * Each distinct query term counts once; returns documents with a positive score, best first.
   * `include` filters documents before the limit applies, so excluded ones never take a slot;
   * so does `gate`, which drops documents matching too little of the query.
   */
  search(
    queryTokens: string[],
    limit: number,
    options: { include?: (index: number) => boolean; gate?: RelevanceGate } = {},
  ): ScoredIndex[] {
    const { include, gate = NO_RELEVANCE_GATE } = options
    const scores = new Map<number, number>()
    const matched = new Map<number, number>()
    let totalIdf = 0
    for (const term of new Set(queryTokens)) {
      const idf = this.idf(term)
      totalIdf += idf
      const list = this.postings.get(term)
      if (!list) continue
      for (const { doc, tf } of list) {
        if (include && !include(doc)) continue
        const norm = this.k1 * (1 - this.b + this.b * (this.lengths[doc] / (this.averageLength || 1)))
        scores.set(doc, (scores.get(doc) ?? 0) + idf * (tf * (this.k1 + 1)) / (tf + norm))
        matched.set(doc, (matched.get(doc) ?? 0) + idf)
      }
    }
    return [...scores]
      .map(([index, score]) => {
        const matchedIdf = matched.get(index)!
        return { index, score, coverage: totalIdf ? matchedIdf / totalIdf : 0, matchedIdf }
      })
      .filter(hit => hit.coverage >= gate.minCoverage || hit.matchedIdf >= gate.minMatchedIdf)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, limit)
  }
}
