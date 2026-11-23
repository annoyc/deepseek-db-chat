import './instrumentation'
import { startActiveObservation, propagateAttributes } from '@langfuse/tracing'
import { traceContent, traceError, traceMetadata } from '@/core/telemetry'
import { langfuseSpanProcessor } from './instrumentation'

export { langfuseSpanProcessor }

export interface TraceOptions {
  name: string
  input?: unknown
  userId?: string
  sessionId?: string
  metadata?: Record<string, unknown>
  tags?: string[]
}

/** Anonymous by default; authenticated callers may explicitly supply an opaque userId. */
export function resolveUserId(): string | undefined {
  return undefined
}

/**
 * Wraps an async function inside a traced observation with session/user context.
 * All LLM calls within `fn` are automatically nested as child generations.
 * If Langfuse is not configured (missing env vars), runs `fn` transparently.
 * Raw request IPs are never used as user identifiers.
 */
export async function withTrace<T>(options: TraceOptions, fn: () => Promise<T>): Promise<T> {
  if (!langfuseSpanProcessor) return fn()

  const userId = options.userId || resolveUserId()

  let failed = false
  let failure: unknown
  const result = await startActiveObservation(options.name, async (span) => {
    if (options.input) span.update({ input: traceContent(options.input) })
    if (options.metadata) span.update({ metadata: traceMetadata(options.metadata) })

    try {
      return await propagateAttributes({
        userId,
        sessionId: options.sessionId,
        tags: options.tags,
        traceName: options.name,
      }, fn)
    } catch (error) {
      failed = true
      failure = error
      // End the observation normally, then rethrow outside the SDK callback so
      // SDK exception attributes cannot copy SQL/provider response text.
      span.update({ level: 'ERROR', statusMessage: traceError(error) })
      return undefined
    }
  })
  if (failed) throw failure
  return result as T
}

export async function flushTraces(): Promise<void> {
  if (langfuseSpanProcessor) {
    await langfuseSpanProcessor.forceFlush()
  }
}

export interface FeedbackScoreInput {
  traceId: string
  rating: 'up' | 'down' | null
  source?: 'chat' | 'knowledge'
}

/**
 * Syncs an explicit thumbs-up / thumbs-down rating to Langfuse's public Scores API.
 * Uses a deterministic score ID so toggling up <-> down updates the same score
 * instead of creating duplicates, and clearing removes it. No-ops when Langfuse
 * credentials are absent.
 */
export async function submitLangfuseFeedback(
  input: FeedbackScoreInput,
  fetchImpl: typeof fetch = fetch,
): Promise<{ synced: boolean }> {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY?.trim()
  const secretKey = process.env.LANGFUSE_SECRET_KEY?.trim()
  if (!publicKey || !secretKey || !input.traceId) return { synced: false }

  const baseUrl = (process.env.LANGFUSE_BASE_URL || process.env.LANGFUSE_HOST || 'https://cloud.langfuse.com')
    .trim()
    .replace(/\/$/, '')
  const authHeader = `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString('base64')}`
  const scoreId = `user-feedback:${input.traceId}`

  try {
    if (input.rating === null) {
      const response = await fetchImpl(`${baseUrl}/api/public/scores/${encodeURIComponent(scoreId)}`, {
        method: 'DELETE',
        headers: { Authorization: authHeader },
        signal: AbortSignal.timeout(8000),
      })
      return { synced: response.ok || response.status === 404 }
    }

    const response = await fetchImpl(`${baseUrl}/api/public/scores`, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: scoreId,
        traceId: input.traceId,
        name: 'user_feedback',
        value: input.rating === 'up' ? 1 : 0,
        dataType: 'BOOLEAN',
        metadata: input.source ? { source: input.source } : undefined,
      }),
      signal: AbortSignal.timeout(8000),
    })
    return { synced: response.ok }
  } catch {
    console.warn('[langfuse] Feedback score sync failed')
    return { synced: false }
  }
}
