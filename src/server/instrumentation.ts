import process from 'node:process'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { LangfuseSpanProcessor } from '@langfuse/otel'
import { maskTelemetryAttribute } from '@/core/telemetry'

const isEnabled = Boolean(
  process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY,
)

export const langfuseSpanProcessor = isEnabled
  ? new LangfuseSpanProcessor({ mask: ({ data }) => maskTelemetryAttribute(data) })
  : undefined

if (langfuseSpanProcessor) {
  const sdk = new NodeSDK({
    spanProcessors: [langfuseSpanProcessor],
  })
  sdk.start()
}
