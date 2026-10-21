import { maskPII } from '@/lib/masking'

/** Content capture is a separate opt-in from enabling operational telemetry. */
export function captureTraceContent(): boolean {
  return process.env.LANGFUSE_CAPTURE_CONTENT === 'true'
}

export function traceContent(value: unknown): unknown {
  if (!captureTraceContent() || value === undefined) return undefined
  try { return JSON.parse(maskPII(JSON.stringify(value))) } catch { return '[unavailable]' }
}

const METADATA_KEYS = new Set([
  'provider', 'model', 'stream', 'messageCount', 'toolCount', 'columnCount',
  'hasToolCalls', 'isContinuation', 'durationMs', 'status', 'errorType',
])

export function traceMetadata(metadata: Record<string, unknown> = {}): Record<string, unknown> {
  return Object.fromEntries(Object.entries(metadata).filter(([key, value]) =>
    METADATA_KEYS.has(key) && ['string', 'number', 'boolean'].includes(typeof value),
  ).map(([key, value]) => [key, typeof value === 'string' ? maskPII(value).slice(0, 120) : value]))
}

/** Defense in depth at the exporter, including observations created by other callers. */
export function maskTelemetryAttribute(data: unknown): unknown {
  if (captureTraceContent()) return traceContent(typeof data === 'string' ? parseAttribute(data) : data)
  const value = typeof data === 'string' ? parseAttribute(data) : data
  const safe = value && typeof value === 'object' && !Array.isArray(value)
    ? traceMetadata(value as Record<string, unknown>)
    : {}
  return typeof data === 'string' ? JSON.stringify(safe) : safe
}

function parseAttribute(data: string): unknown {
  try { return JSON.parse(data) } catch { return data }
}

export function traceError(error: unknown): string {
  // Error messages can contain SQL, connection information or provider response data.
  return error instanceof Error && ['AbortError', 'TimeoutError', 'ApiRequestError', 'AgentError'].includes(error.name)
    ? error.name
    : 'RequestError'
}
