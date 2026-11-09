import type { ProviderModel, ThinkingStyle } from '@/core/provider'
import { apiRequest } from '@/core/client/request'
import { getModelsEndpoint } from '@/core/client/endpoints'
import type { ListModelsResponse } from '@/core/model/types'
import { findProvider, getProviderList, getServerApiKey, getServerBaseURL, isCustomProviderId } from '@/core/provider'
import { decrypt } from '@/server/crypto'
import { resolveAiTarget, type AiRequestConfig } from '@/server/ai-credentials'

export interface ServerProviderInfo {
  id: string
  name: string
  models: ProviderModel[]
  defaultModel: string
  thinkingStyle: ThinkingStyle
  /** Public default endpoint, shown as a placeholder. Env overrides stay private. */
  defaultBaseURL?: string
  hasEnvKey: boolean
}

export function describeServerProviders(): ServerProviderInfo[] {
  return getProviderList().map(p => ({
    id: p.id,
    name: p.name,
    models: p.models,
    defaultModel: p.defaultModel,
    thinkingStyle: p.thinkingStyle,
    defaultBaseURL: getServerBaseURL(p) === p.defaultBaseURL ? p.defaultBaseURL : undefined,
    hasEnvKey: !!getServerApiKey(p),
  }))
}

/** Whether a server key exists, and whether an encrypted browser copy is a (legacy) server key. */
export function checkServerKey(providerId: string, encryptedApiKey?: string): { hasEnvKey: boolean; isServerKey: boolean } {
  if (isCustomProviderId(providerId)) return { hasEnvKey: false, isServerKey: false }
  const provider = findProvider(providerId)
  const key = provider ? getServerApiKey(provider) : ''
  if (!key) return { hasEnvKey: false, isServerKey: false }
  return { hasEnvKey: true, isServerKey: !!encryptedApiKey && decrypt(encryptedApiKey) === key }
}

const MAX_MODELS = 500

export async function fetchProviderModels(request: AiRequestConfig, signal?: AbortSignal): Promise<string[]> {
  const target = resolveAiTarget(request)
  const response = await apiRequest<ListModelsResponse>(getModelsEndpoint(target.baseURL), target.apiKey, {}, 15_000, 'GET', signal)
  if (!Array.isArray(response?.data)) throw new Error('该服务未返回模型列表，请手动填写模型 ID')
  const ids = response.data
    .map(item => (typeof item?.id === 'string' ? item.id.trim() : ''))
    .filter(id => id && id.length <= 200)
  return [...new Set(ids)].sort().slice(0, MAX_MODELS)
}
