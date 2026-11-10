import type { AssistantMessage, ChatCompletion, ChatCompletionChunk, ChatMessage, InvokeParams, ModelOptions } from './types'
import { omitBy } from '@/core/utils'
import { getChatEndpoint } from '@/core/client/endpoints'
import { apiRequest } from '@/core/client/request'
import { withRetry } from '@/core/client/retry'
import { apiStreamRequest } from '@/core/client/stream-request'
import { buildThinkingParams, findProvider } from '@/core/provider'
import { buildToolParameters, validateToolConsistency } from '@/core/tool'
import { startObservation } from '@langfuse/tracing'
import { sanitizeModelMessages } from '@/lib/masking'
import { traceContent, traceError, traceMetadata } from '@/core/telemetry'

/**
 * Reasoning is replayed only to providers that speak DeepSeek's thinking protocol,
 * which expects it back between the tool-call steps of a turn. Other
 * OpenAI-compatible services never produced the field in a form they accept as
 * input, and a strict one may reject it, so it is removed for them.
 */
export function prepareMessages(messages: ChatMessage[], replayReasoning: boolean): ChatMessage[] {
  if (replayReasoning) return messages
  return messages.map((message) => {
    if (message.role !== 'assistant' || !('reasoning_content' in message || 'reasoning' in message)) return message
    const { reasoning_content: _content, reasoning: _alias, ...rest } = message as AssistantMessage & { reasoning?: unknown }
    return rest
  })
}

function buildRequestBody(config: ModelOptions, params: InvokeParams) {
  const { messages, response_format, tools = [] } = params
  const { toolParameters, toolChoice } = buildToolParameters(tools, config.strict)
  const thinkingStyle = config.thinkingStyle ?? findProvider(config.provider ?? 'deepseek')?.thinkingStyle ?? 'none'
  const thinkingParams = buildThinkingParams(thinkingStyle, config.thinking, config.reasoningEffort)

  const replayReasoning = thinkingStyle === 'deepseek' && config.thinking?.type !== 'disabled'

  return omitBy({
    messages: sanitizeModelMessages(prepareMessages(messages, replayReasoning)),
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
  const maxRetries = config.maxRetries ?? 3
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
  let stream: AsyncGenerator<ChatCompletionChunk> | undefined

  try {
    // Retry only until the first event arrives. Up to then nothing has been handed
    // to the caller, so a rate limit or a 5xx on connect can be replayed safely;
    // a stream that breaks midway is never restarted.
    const opened = await withRetry(async () => {
      const chunks = apiStreamRequest(url, config.apiKey!, body, timeout, params.signal, { idleTimeoutMs: config.idleTimeout, deadlineMs: config.streamDeadline })
      return { chunks, first: await chunks.next() }
    }, maxRetries, params.signal)
    stream = opened.chunks

    for (let next = opened.first; !next.done; next = await stream.next()) {
      const chunk = next.value
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
    // Closes the upstream connection when the consumer stops early.
    await stream?.return(undefined)
    generation.end()
  }
}
