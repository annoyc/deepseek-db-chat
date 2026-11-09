import { readFile } from 'node:fs/promises'
import { Bm25Index } from '@/lib/retrieval/bm25'
import { chunkSearchText } from './chunker'
import { decodeVectors } from './index-builder'
import { tokenize } from '@/lib/retrieval/tokenizer'
import { embeddingKey } from '@/lib/knowledge-documents'
import type { KnowledgeUserChunkCandidate } from '@/lib/knowledge-types'
import type { KbChunk, KbDocumentMeta, KbEmbeddingInfo, KbIndexFile } from './types'

export interface KnowledgeBase {
  /** Defaults to builtin. */
  source?: 'builtin' | 'upload'
  corpusHash: string
  documents: Map<string, KbDocumentMeta>
  chunks: KbChunk[]
  bm25: Bm25Index
  /** Unit-length vectors, `dimensions` floats per chunk, when the index was embedded. */
  vectors?: Float32Array
  embedding?: KbEmbeddingInfo
}

export function createKnowledgeBase(index: KbIndexFile): KnowledgeBase {
  if (index.version !== 1) throw new Error(`Unsupported knowledge index version: ${String(index.version)}`)
  const documents = new Map(index.documents.map(({ hash: _hash, ...meta }) => [meta.id, meta as KbDocumentMeta]))
  for (const chunk of index.chunks) {
    if (!documents.has(chunk.docId)) throw new Error(`Chunk ${chunk.id} references unknown document ${chunk.docId}`)
  }
  const bm25 = new Bm25Index(index.chunks.map(chunk => tokenize(chunkSearchText(documents.get(chunk.docId)!, chunk))))
  const base: KnowledgeBase = { corpusHash: index.corpusHash, documents, chunks: index.chunks, bm25 }
  if (!index.embedding) return base
  const { vectors, ...embedding } = index.embedding
  return { ...base, embedding, vectors: decodeVectors(vectors, index.chunks.length, embedding.dimensions) }
}

/**
 * A throwaway knowledge base over the uploaded chunks the browser pre-selected for one
 * question. Their vectors are used only if they come from the built-in index's model.
 */
export function createUploadKnowledgeBase(candidates: KnowledgeUserChunkCandidate[], embedding?: KbEmbeddingInfo): KnowledgeBase {
  const documents = new Map<string, KbDocumentMeta>()
  for (const candidate of candidates) documents.set(candidate.docId, { id: candidate.docId, title: candidate.docTitle })
  const chunks: KbChunk[] = candidates.map(c => ({ id: c.id, docId: c.docId, headings: c.headings, label: c.label, text: c.text, hash: '' }))
  const bm25 = new Bm25Index(chunks.map(chunk => tokenize(chunkSearchText(documents.get(chunk.docId)!, chunk))))
  const base: KnowledgeBase = { source: 'upload', corpusHash: '', documents, chunks, bm25 }
  if (!embedding) return base
  const key = embeddingKey(embedding)
  const usable = candidates.filter(c => c.vector && c.embeddingKey === key)
  if (!usable.length) return base
  // Chunks without a matching vector keep a zero vector and are never found by vector search.
  const vectors = new Float32Array(candidates.length * embedding.dimensions)
  candidates.forEach((candidate, i) => {
    if (!candidate.vector || candidate.embeddingKey !== key) return
    try {
      vectors.set(decodeVectors(candidate.vector, 1, embedding.dimensions), i * embedding.dimensions)
    } catch { /* malformed vector: keyword search only for this chunk */ }
  })
  return { ...base, embedding, vectors }
}

let cached: Promise<KnowledgeBase> | undefined

/**
 * The sample index is bundled with the server. KB_INDEX_PATH points at an index file
 * on the server instead, e.g. a private corpus mounted into the container.
 */
export function loadKnowledgeBase(): Promise<KnowledgeBase> {
  cached ??= (async () => {
    const path = process.env.KB_INDEX_PATH?.trim()
    const index = path
      ? JSON.parse(await readFile(path, 'utf8')) as KbIndexFile
      : (await import('../../../knowledge/kb-index.json')).default as unknown as KbIndexFile
    return createKnowledgeBase(index)
  })()
  // A failed load (e.g. a missing file) is retried on the next request rather than cached.
  cached.catch(() => { cached = undefined })
  return cached
}
