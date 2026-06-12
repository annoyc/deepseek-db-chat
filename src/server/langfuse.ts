import './instrumentation'
import { startActiveObservation, propagateAttributes } from '@langfuse/tracing'
import { getRequestIP } from '@tanstack/react-start/server'
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

/**
 * Resolves the userId for tracing: uses the client IP address as a stable user identifier.
 */
export function resolveUserId(): string | undefined {
  try {
    return getRequestIP({ xForwardedFor: true }) ?? undefined
  } catch {
    return undefined
  }
}

/**
 * Wraps an async function inside a traced observation with session/user context.
 * All LLM calls within `fn` are automatically nested as child generations.
 * If Langfuse is not configured (missing env vars), runs `fn` transparently.
 * userId defaults to the client IP address if not explicitly provided.
 */
export async function withTrace<T>(options: TraceOptions, fn: () => Promise<T>): Promise<T> {
  if (!langfuseSpanProcessor) return fn()

  const userId = options.userId || resolveUserId()

  return startActiveObservation(options.name, async (span) => {
    if (options.input) span.update({ input: options.input })
    if (options.metadata) span.update({ metadata: options.metadata })

    return propagateAttributes({
      userId,
      sessionId: options.sessionId,
      tags: options.tags,
      traceName: options.name,
    }, fn)
  })
}

export async function flushTraces(): Promise<void> {
  if (langfuseSpanProcessor) {
    await langfuseSpanProcessor.forceFlush()
  }
}
