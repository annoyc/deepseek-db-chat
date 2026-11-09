import type { KnowledgeBase } from './knowledge-base'
import { tokenizeQuery } from '@/lib/retrieval/tokenizer'
import type { KbChunk, KbDocumentMeta } from './types'

export const RRF_K = 60

export interface RetrievalHit {
  chunk: KbChunk
  doc: KbDocumentMeta
  source: 'builtin' | 'upload'
  /** Reciprocal-rank-fusion score over every query and retriever. */
  score: number
  /** Best rank (1-based) the chunk reached in any keyword / vector list. */
  bm25Rank?: number
  denseRank?: number
  denseSimilarity?: number
}

export interface RetrieveOptions {
  topK: number
  /** Candidates taken from each ranked list before fusion. */
  candidates?: number
  /** One vector per query, in the same order; omitted for keyword-only retrieval. */
  queryVectors?: Float32Array[]
  /** Vector hits below this cosine similarity are dropped. */
  minSimilarity?: number
  /** Further ranked lists of chunk ids to fuse, e.g. the browser's ranking of uploaded chunks. */
  extraRankings?: string[][]
  /** Documents left out entirely, e.g. default documents the user removed. */
  excludeDocIds?: ReadonlySet<string>
}

/** Reciprocal rank fusion: sum of 1 / (k + rank) across ranked lists of ids. */
export function fuseRankings(rankings: string[][], k = RRF_K): Map<string, number> {
  const scores = new Map<string, number>()
  for (const ranking of rankings) {
    ranking.forEach((id, i) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1)))
  }
  return scores
}

function denseSearch(kb: KnowledgeBase, query: Float32Array, limit: number, minSimilarity: number, include: (index: number) => boolean) {
  const { vectors, embedding } = kb
  if (!vectors || !embedding || query.length !== embedding.dimensions) return []
  const dims = embedding.dimensions
  const scored: { index: number; similarity: number }[] = []
  for (let i = 0; i < kb.chunks.length; i++) {
    if (!include(i)) continue
    let dot = 0
    const offset = i * dims
    for (let d = 0; d < dims; d++) dot += vectors[offset + d] * query[d]
    if (dot >= minSimilarity) scored.push({ index: i, similarity: dot })
  }
  return scored.sort((a, b) => b.similarity - a.similarity || a.index - b.index).slice(0, limit)
}

/**
 * Hybrid retrieval: each query (the rewritten question and its sub-questions) is run
 * through BM25 and, when available, brute-force cosine search, in every knowledge base
 * (the built-in corpus and the user's uploaded candidates); all ranked lists are merged
 * with RRF, which needs no score calibration between retrievers or sources.
 */
export function retrieve(sources: KnowledgeBase | KnowledgeBase[], queries: string[], options: RetrieveOptions): RetrievalHit[] {
  const bases = Array.isArray(sources) ? sources : [sources]
  const candidates = options.candidates ?? 30
  const rankings: string[][] = [...(options.extraRankings ?? [])]
  const bm25Rank = new Map<string, number>()
  const denseRank = new Map<string, number>()
  const similarity = new Map<string, number>()
  const located = new Map<string, { chunk: KbChunk; kb: KnowledgeBase }>()
  for (const kb of bases) {
    for (const chunk of kb.chunks) located.set(chunk.id, { chunk, kb })
    const excluded = options.excludeDocIds
    const include = (index: number) => !excluded?.has(kb.chunks[index].docId)
    queries.forEach((query, q) => {
      const keyword = kb.bm25.search(tokenizeQuery(query), candidates, include)
      rankings.push(keyword.map(({ index }, rank) => {
        const id = kb.chunks[index].id
        bm25Rank.set(id, Math.min(bm25Rank.get(id) ?? Infinity, rank + 1))
        return id
      }))
      const vector = options.queryVectors?.[q]
      if (!vector) return
      const dense = denseSearch(kb, vector, candidates, options.minSimilarity ?? 0, include)
      rankings.push(dense.map(({ index, similarity: value }, rank) => {
        const id = kb.chunks[index].id
        denseRank.set(id, Math.min(denseRank.get(id) ?? Infinity, rank + 1))
        similarity.set(id, Math.max(similarity.get(id) ?? -Infinity, value))
        return id
      }))
    })
  }
  return [...fuseRankings(rankings)]
    .filter(([id]) => located.has(id))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, options.topK)
    .map(([id, score]) => {
      const { chunk, kb } = located.get(id)!
      return {
        chunk,
        doc: kb.documents.get(chunk.docId)!,
        source: kb.source ?? 'builtin',
        score,
        bm25Rank: bm25Rank.get(id),
        denseRank: denseRank.get(id),
        denseSimilarity: similarity.get(id),
      }
    })
}
