export interface ScoredIndex {
  index: number
  score: number
}

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

  /** Each distinct query term counts once; returns documents with a positive score, best first. */
  search(queryTokens: string[], limit: number): ScoredIndex[] {
    const scores = new Map<number, number>()
    for (const term of new Set(queryTokens)) {
      const list = this.postings.get(term)
      if (!list) continue
      const idf = this.idf(term)
      for (const { doc, tf } of list) {
        const norm = this.k1 * (1 - this.b + this.b * (this.lengths[doc] / (this.averageLength || 1)))
        scores.set(doc, (scores.get(doc) ?? 0) + idf * (tf * (this.k1 + 1)) / (tf + norm))
      }
    }
    return [...scores].map(([index, score]) => ({ index, score }))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, limit)
  }
}
