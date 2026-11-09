import { embedTexts } from '@/core/model/embed'
import { getProviderList } from '@/core/provider'
import { resolveAiCredentials } from '@/server/ai-credentials'
import type { KbEmbeddingInfo } from './types'

export type Embedder = (texts: string[], signal?: AbortSignal) => Promise<Float32Array[]>

/** Model used by `pnpm kb:ingest --embed`; at query time the index's own record wins. */
export function ingestEmbeddingInfo(env: NodeJS.ProcessEnv = process.env): KbEmbeddingInfo {
  const provider = env.KB_EMBEDDING_PROVIDER?.trim() || 'bailian'
  if (!getProviderList().some(item => item.id === provider)) throw new Error(`Unknown KB_EMBEDDING_PROVIDER: ${provider}`)
  const dimensions = Number(env.KB_EMBEDDING_DIMENSIONS || 512)
  if (!Number.isInteger(dimensions) || dimensions <= 0) throw new Error('KB_EMBEDDING_DIMENSIONS must be a positive integer')
  return { provider, model: env.KB_EMBEDDING_MODEL?.trim() || 'text-embedding-v4', dimensions }
}

/**
 * Embeddings always use the server's own key and endpoint for the provider, never a
 * visitor's key: the index and the query must come from the same model. Returns null
 * when the server has no key, in which case retrieval falls back to BM25 only.
 */
export function createServerEmbedder(info: KbEmbeddingInfo, env: NodeJS.ProcessEnv = process.env): Embedder | null {
  let credentials: { apiKey: string; baseURL: string }
  try {
    credentials = resolveAiCredentials(info.provider)
  } catch {
    return null
  }
  const batchSize = Number(env.KB_EMBEDDING_BATCH_SIZE) || 10
  return (texts, signal) => embedTexts({ ...credentials, model: info.model, dimensions: info.dimensions, batchSize }, texts, signal)
}
