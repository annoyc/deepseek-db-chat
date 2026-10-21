import type { ChatCompletion, ChatCompletionChunk, InvokeParams, ModelOptions } from './types'
import { omitBy } from '@/core/utils'
import { getChatEndpoint } from '@/core/client/endpoints'
import { apiRequest } from '@/core/client/request'
import { withRetry } from '@/core/client/retry'
import { apiStreamRequest } from '@/core/client/stream-request'
import { getProvider } from '@/core/provider'
import { buildToolParameters, validateToolConsistency } from '@/core/tool'
import { startObservation } from '@langfuse/tracing'
import { sanitizeModelMessages } from '@/lib/masking'
import { traceContent, traceError, traceMetadata } from '@/core/telemetry'

function buildRequestBody(config: ModelOptions, params: InvokeParams) {
  const { messages, response_format, tools = [] } = params
  const { toolParameters, toolChoice } = buildToolParameters(tools, config.strict)
  const provider = getProvider(config.provider ?? 'deepseek')
  const thinkingParams = provider.buildThinkingParams(config.thinking, config.reasoningEffort)

  return omitBy({
    messages: sanitizeModelMessages(messages),
    model: config.model,
    ...thinkingParams,
    max_tokens: config.maxTokens,
    temperature: config.temperature,
    top_p: config.topP,
    stop: params.stop,
    logprobs: params.logprobs,
    top_logprobs: params.topLogprobs,
    tools: toolParameters,
    tool_choice: toolChoice,
    response_format,
  }, v => v === undefined)
}

export async function invoke(config: ModelOptions, params: InvokeParams): Promise<ChatCompletion> {
  const tools = params.tools ?? []
  if (!config.strict) {
    validateToolConsistency(tools)
  }
  const body = buildRequestBody(config, params)
  const url = getChatEndpoint(config.baseURL!)
  const maxRetries = config.maxRetries ?? 3
  const timeout = config.timeout ?? 60000

  const generation = startObservation(
    'llm-call',
    {
      model: config.model!,
      input: traceContent(body.messages),
      metadata: traceMetadata({ provider: config.provider, messageCount: params.messages.length, toolCount: tools.length }),
    },
    { asType: 'generation' },
  )

  try {
    const result = await withRetry(
      () => apiRequest<ChatCompletion>(url, config.apiKey!, body, timeout, 'POST', params.signal),
      maxRetries,
      params.signal,
    )
    generation.update({
      output: traceContent(result.choices[0]?.message),
      usageDetails: result.usage ? {
        input: result.usage.prompt_tokens,
        output: result.usage.completion_tokens,
        total: result.usage.total_tokens,
      } : undefined,
    })
    return result
  } catch (error) {
    generation.update({
      output: undefined,
      level: 'ERROR',
      statusMessage: traceError(error),
    })
    throw error
  } finally {
    generation.end()
  }
}

export async function* invokeStream(config: ModelOptions, params: InvokeParams): AsyncGenerator<ChatCompletionChunk> {
  const tools = params.tools ?? []
  if (!config.strict) {
    validateToolConsistency(tools)
  }
  const body = { ...buildRequestBody(config, params), stream_options: config.streamOptions }
  const url = getChatEndpoint(config.baseURL!)
  const timeout = config.timeout ?? 60000

  const generation = startObservation(
    'llm-call-stream',
    {
      model: config.model!,
      input: traceContent(body.messages),
      metadata: traceMetadata({ provider: config.provider, stream: true, messageCount: params.messages.length, toolCount: tools.length }),
    },
    { asType: 'generation' },
  )

  let output = ''
  let lastUsage: ChatCompletionChunk['usage'] | undefined

  try {
    for await (const chunk of apiStreamRequest(url, config.apiKey!, body, timeout, params.signal, { idleTimeoutMs: config.idleTimeout, deadlineMs: config.streamDeadline })) {
      if (chunk.usage) lastUsage = chunk.usage
      const delta = chunk.choices[0]?.delta
      if (delta?.content) output += delta.content
      yield chunk
    }
    generation.update({
      output: traceContent(output),
      usageDetails: lastUsage ? {
        input: lastUsage.prompt_tokens,
        output: lastUsage.completion_tokens,
        total: lastUsage.total_tokens,
      } : undefined,
    })
  } catch (error) {
    generation.update({
      output: undefined,
      level: 'ERROR',
      statusMessage: traceError(error),
    })
    throw error
  } finally {
    generation.end()
  }
}
