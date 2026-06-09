import type { ChatCompletion, ChatCompletionChunk, InvokeParams, ModelOptions } from './types'
import { omitBy } from '@/core/utils'
import { getChatEndpoint } from '@/core/client/endpoints'
import { apiRequest } from '@/core/client/request'
import { withRetry } from '@/core/client/retry'
import { apiStreamRequest } from '@/core/client/stream-request'
import { getProvider } from '@/core/provider'
import { buildToolParameters, validateToolConsistency } from '@/core/tool'

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
  return withRetry(
    () => apiRequest<ChatCompletion>(url, config.apiKey!, body, timeout, 'POST', params.signal),
    maxRetries,
  )
}

export async function* invokeStream(config: ModelOptions, params: InvokeParams): AsyncGenerator<ChatCompletionChunk> {
  const tools = params.tools ?? []
  if (!config.strict) {
    validateToolConsistency(tools)
  }
  const body = { ...buildRequestBody(config, params), stream_options: config.streamOptions }
  const url = getChatEndpoint(config.baseURL!)
  const timeout = config.timeout ?? 60000
  yield* apiStreamRequest(url, config.apiKey!, body, timeout, params.signal)
}
