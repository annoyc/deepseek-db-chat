import { readFile } from 'node:fs/promises'
import { Bm25Index } from './bm25'
import { chunkSearchText } from './chunker'
import { decodeVectors } from './index-builder'
import { tokenize } from './tokenizer'
import type { KbChunk, KbDocumentMeta, KbEmbeddingInfo, KbIndexFile } from './types'

export interface KnowledgeBase {
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
