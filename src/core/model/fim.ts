import type { ModelOptions } from './types'
import type { FIMParams, FIMResponse } from '@/core/fim/types'
import { omitBy } from '@/core/utils'
import { getFimEndpoint } from '@/core/client/endpoints'
import { apiRequest } from '@/core/client/request'
import { withRetry } from '@/core/client/retry'

function buildRequestBody(config: ModelOptions, params: Omit<FIMParams, 'model'>) {
  return omitBy({
    model: config.model,
    prompt: params.prompt,
    echo: params.echo,
    max_tokens: params.maxTokens,
    suffix: params.suffix,
  }, v => v === undefined)
}

export async function fim(config: ModelOptions, params: Omit<FIMParams, 'model'>): Promise<FIMResponse> {
  const body = buildRequestBody(config, params)
  const url = getFimEndpoint(config.baseURL!)
  const maxRetries = config.maxRetries ?? 3
  const timeout = config.timeout ?? 60000
  return withRetry(
    () => apiRequest(url, config.apiKey!, body, timeout),
    maxRetries,
  )
}
