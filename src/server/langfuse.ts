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
