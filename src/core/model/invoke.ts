import type { ChatCompletion, ChatCompletionChunk, InvokeParams, ModelOptions } from './types'
import { omitBy } from '@/core/utils'
import { getChatEndpoint } from '@/core/client/endpoints'
import { apiRequest } from '@/core/client/request'
import { withRetry } from '@/core/client/retry'
import { apiStreamRequest } from '@/core/client/stream-request'
import { getProvider } from '@/core/provider'
import { buildToolParameters, validateToolConsistency } from '@/core/tool'
import { startObservation } from '@langfuse/tracing'

function buildRequestBody(config: ModelOptions, params: InvokeParams) {
  const { messages, response_format, tools = [] } = params
  const { toolParameters, toolChoice } = buildToolParameters(tools, config.strict)
  const provider = getProvider(config.provider ?? 'deepseek')
  const thinkingParams = provider.buildThinkingParams(config.thinking, config.reasoningEffort)

  return omitBy({
    messages,
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
      input: params.messages,
      metadata: { provider: config.provider, tools: body.tools },
    },
    { asType: 'generation' },
  )

  try {
    const result = await withRetry(
      () => apiRequest<ChatCompletion>(url, config.apiKey!, body, timeout, 'POST', params.signal),
      maxRetries,
    )
    generation.update({
      output: result.choices[0]?.message,
      usageDetails: result.usage ? {
        input: result.usage.prompt_tokens,
        output: result.usage.completion_tokens,
        total: result.usage.total_tokens,
      } : undefined,
    }).end()
    return result
  } catch (error) {
    generation.update({
      output: { error: String(error) },
      level: 'ERROR',
      statusMessage: String(error),
    }).end()
    throw error
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
      input: params.messages,
      metadata: { provider: config.provider, stream: true, tools: body.tools },
    },
    { asType: 'generation' },
  )

  let output = ''
  let lastUsage: ChatCompletionChunk['usage'] | undefined

  try {
    for await (const chunk of apiStreamRequest(url, config.apiKey!, body, timeout, params.signal)) {
      if (chunk.usage) lastUsage = chunk.usage
      const delta = chunk.choices[0]?.delta
      if (delta?.content) output += delta.content
      yield chunk
    }
    generation.update({
      output,
      usageDetails: lastUsage ? {
        input: lastUsage.prompt_tokens,
        output: lastUsage.completion_tokens,
        total: lastUsage.total_tokens,
      } : undefined,
    }).end()
  } catch (error) {
    generation.update({
      output: { error: String(error) },
      level: 'ERROR',
      statusMessage: String(error),
    }).end()
    throw error
  }
}
