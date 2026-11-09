export interface ScoredIndex {
  index: number
  score: number
  /**
   * Share of the query's IDF weight that the document matches, 0–1. Terms the corpus
   * lacks still count in the total, so a chunk matching only a common word such as
   * 个人 in a question about a blog link scores close to zero.
   */
  coverage: number
}

/**
 * Keyword hits covering less of the query than this are treated as noise. Checked against
 * the regression cases in tests/knowledge-rag.test.ts; revisit with the evaluation set.
 */
export const MIN_KEYWORD_COVERAGE = 0.2

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
   * so does `minCoverage`, which drops documents matching too little of the query.
   */
  search(queryTokens: string[], limit: number, options: { include?: (index: number) => boolean; minCoverage?: number } = {}): ScoredIndex[] {
    const { include, minCoverage = 0 } = options
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
      .map(([index, score]) => ({ index, score, coverage: totalIdf ? matched.get(index)! / totalIdf : 0 }))
      .filter(hit => hit.coverage >= minCoverage)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, limit)
  }
}
