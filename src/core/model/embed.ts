import { getEmbeddingsEndpoint } from '@/core/client/endpoints'
import { apiRequest } from '@/core/client/request'
import { withRetry } from '@/core/client/retry'
import { omitBy } from '@/core/utils'

export interface EmbeddingConfig {
  baseURL: string
  apiKey: string
  model: string
  /** Requested output size, for models that support it (e.g. DashScope text-embedding-v4). */
  dimensions?: number
  /** Inputs per request; DashScope's OpenAI-compatible endpoint accepts at most 10. */
  batchSize?: number
  /** Batches in flight at once. */
  concurrency?: number
  timeout?: number
  maxRetries?: number
}

interface EmbeddingResponse {
  data?: { index: number; embedding: number[] }[]
}

export function normalizeVector(values: ArrayLike<number>): Float32Array {
  const vector = Float32Array.from(values)
  let norm = 0
  for (const value of vector) norm += value * value
  norm = Math.sqrt(norm)
  if (!Number.isFinite(norm) || norm === 0) throw new Error('Embedding vector is empty or invalid')
  for (let i = 0; i < vector.length; i++) vector[i] /= norm
  return vector
}

/** OpenAI-compatible `/embeddings`; returns unit-length vectors in input order. */
export async function embedTexts(config: EmbeddingConfig, texts: string[], signal?: AbortSignal): Promise<Float32Array[]> {
  const url = getEmbeddingsEndpoint(config.baseURL)
  const batchSize = Math.max(1, config.batchSize ?? 10)
  const batches: string[][] = []
  for (let start = 0; start < texts.length; start += batchSize) batches.push(texts.slice(start, start + batchSize))
  const results: Float32Array[][] = new Array(batches.length)
  const embedBatch = async (batch: string[]): Promise<Float32Array[]> => {
    const body = omitBy({
      model: config.model,
      input: batch,
      dimensions: config.dimensions,
      encoding_format: 'float',
    }, v => v === undefined)
    const response = await withRetry(
      () => apiRequest<EmbeddingResponse>(url, config.apiKey, body, config.timeout ?? 30000, 'POST', signal),
      config.maxRetries ?? 2,
      signal,
    )
    const items = [...(response.data ?? [])].sort((a, b) => a.index - b.index)
    if (items.length !== batch.length) {
      throw new Error(`Embedding API returned ${items.length} vectors for ${batch.length} inputs`)
    }
    return items.map((item) => {
      if (config.dimensions && item.embedding.length !== config.dimensions) {
        throw new Error(`Embedding size ${item.embedding.length} does not match configured ${config.dimensions}`)
      }
      return normalizeVector(item.embedding)
    })
  }
  let next = 0
  const worker = async () => {
    while (next < batches.length) {
      const index = next++
      results[index] = await embedBatch(batches[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, config.concurrency ?? 4), batches.length) }, worker))
  const vectors = results.flat()
  return vectors
}
