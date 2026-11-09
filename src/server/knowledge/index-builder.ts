import { chunkDocument, chunkSearchText, contentHash, type ChunkOptions } from './chunker'
import type { Embedder } from './embedding'
import type { KbDocument, KbEmbeddingInfo, KbIndexFile } from './types'

export function encodeVectors(vectors: Float32Array[]): string {
  const flat = new Float32Array(vectors.reduce((sum, v) => sum + v.length, 0))
  let offset = 0
  for (const vector of vectors) { flat.set(vector, offset); offset += vector.length }
  // Little-endian, as written by every platform Node runs on in practice.
  return Buffer.from(flat.buffer, flat.byteOffset, flat.byteLength).toString('base64')
}

export function decodeVectors(base64: string, count: number, dimensions: number): Float32Array {
  const bytes = Buffer.from(base64, 'base64')
  if (bytes.byteLength !== count * dimensions * 4) {
    throw new Error(`Index vectors hold ${bytes.byteLength} bytes, expected ${count} x ${dimensions} floats`)
  }
  // Copy into an aligned buffer; Buffer slices from the pool may be misaligned for Float32Array.
  return new Float32Array(new Uint8Array(bytes).buffer)
}

export interface BuildIndexOptions {
  /** When set, every chunk gets a vector from this model. */
  embedding?: { info: KbEmbeddingInfo; embed: Embedder }
  /** Vectors of unchanged chunks are reused from here if it was built with the same model. */
  previous?: KbIndexFile
  onProgress?: (message: string) => void
  /** Chunking parameters; the default is what the app ships with. */
  chunkOptions?: ChunkOptions
}

export async function buildIndex(documents: KbDocument[], options: BuildIndexOptions = {}): Promise<KbIndexFile> {
  const sorted = [...documents].sort((a, b) => a.meta.id.localeCompare(b.meta.id))
  const ids = new Set<string>()
  for (const doc of sorted) {
    if (ids.has(doc.meta.id)) throw new Error(`Duplicate document id: ${doc.meta.id}`)
    ids.add(doc.meta.id)
  }
  const chunksByDoc = sorted.map(doc => chunkDocument(doc, options.chunkOptions))
  const chunks = chunksByDoc.flat()
  const docs = sorted.map((doc, i) => ({
    ...doc.meta,
    hash: contentHash(JSON.stringify(doc.meta) + '\n' + chunksByDoc[i].map(c => c.hash).join(',')),
  }))
  const index: KbIndexFile = {
    version: 1,
    corpusHash: contentHash(docs.map(d => d.hash).join(',')),
    documents: docs,
    chunks,
  }
  if (!options.embedding) return index

  const { info, embed } = options.embedding
  const reusable = new Map<string, Float32Array>()
  const previous = options.previous
  if (previous?.embedding && previous.embedding.provider === info.provider
    && previous.embedding.model === info.model && previous.embedding.dimensions === info.dimensions) {
    const flat = decodeVectors(previous.embedding.vectors, previous.chunks.length, info.dimensions)
    previous.chunks.forEach((chunk, i) => reusable.set(chunk.hash, flat.slice(i * info.dimensions, (i + 1) * info.dimensions)))
  }
  const metaById = new Map(sorted.map(doc => [doc.meta.id, doc.meta]))
  const missing = chunks.filter(chunk => !reusable.has(chunk.hash))
  options.onProgress?.(`复用 ${chunks.length - missing.length} 个向量，需要新生成 ${missing.length} 个`)
  const fresh = missing.length
    ? await embed(missing.map(chunk => chunkSearchText(metaById.get(chunk.docId)!, chunk)))
    : []
  missing.forEach((chunk, i) => reusable.set(chunk.hash, fresh[i]))
  const vectors = chunks.map(chunk => reusable.get(chunk.hash)!)
  if (vectors.some(v => v.length !== info.dimensions)) throw new Error('Embedding size does not match the configured dimensions')
  return { ...index, embedding: { ...info, vectors: encodeVectors(vectors) } }
}
