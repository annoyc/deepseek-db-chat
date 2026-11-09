import type { ModelOptions } from '@/core/model/types'
import type { ThinkingStyle } from '@/core/provider'
import { createModel } from '@/core/model'
import {
  findProvider,
  getProviderList,
  getServerApiKey,
  getServerBaseURL,
  isCustomProviderId,
  parseThinkingStyle,
  PROVIDER_ID_PATTERN,
} from '@/core/provider'
import { decrypt } from '@/server/crypto'

/** The model-service fields every AI server function receives from the browser. */
export interface AiRequestConfig {
  provider?: string
  model?: string
  /** Encrypted, user-supplied key (never a raw secret). */
  apiKey?: string
  baseURL?: string
  /** Only honoured for `custom-*` providers; server providers define their own. */
  thinkingStyle?: string
  /** Display name of a `custom-*` provider; used only to tell the model where it runs. */
  providerName?: string
}

export interface AiTarget {
  provider: string
  apiKey: string
  baseURL: string
  thinkingStyle: ThinkingStyle
  supportsBeta: boolean
  /** Server default model; custom providers have none server-side. */
  defaultModel?: string
}

function normalizeEndpoint(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('模型地址必须为不含凭据、查询参数或片段的 HTTP(S) 地址')
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('模型地址必须为不含凭据、查询参数或片段的 HTTP(S) 地址')
  }
  return url.toString().replace(/\/+$/, '')
}

function isServerKey(key: string): boolean {
  return getProviderList().some(item => getServerApiKey(item) === key)
}

/**
 * Resolve where a request goes and with which key.
 *
 * - Server providers: server keys are confined to the endpoint configured on the
 *   server; a custom endpoint requires the user's own key.
 * - Custom (`custom-*`) providers: always the user's own key and endpoint, never a
 *   server key — they are defined in the browser and cannot be trusted.
 */
export function resolveAiTarget(request: AiRequestConfig): AiTarget {
  const providerId = request.provider?.trim() || 'deepseek'
  if (!PROVIDER_ID_PATTERN.test(providerId)) throw new Error('模型服务标识无效')

  const suppliedKey = request.apiKey ? decrypt(request.apiKey).trim() : ''
  if (request.apiKey && !suppliedKey) throw new Error('自定义 API Key 解密失败，请重新填写')
  const requestedBaseURL = request.baseURL?.trim()

  if (isCustomProviderId(providerId)) {
    if (!suppliedKey) throw new Error('自定义模型服务需要填写自有 API Key')
    if (isServerKey(suppliedKey)) throw new Error('服务器密钥不能用于自定义模型服务')
    if (!requestedBaseURL) throw new Error('自定义模型服务需要填写 Base URL')
    const thinkingStyle = request.thinkingStyle === undefined ? 'none' : parseThinkingStyle(request.thinkingStyle)
    if (!thinkingStyle) throw new Error('思考参数格式无效')
    return {
      provider: providerId,
      apiKey: suppliedKey,
      baseURL: normalizeEndpoint(requestedBaseURL),
      thinkingStyle,
      supportsBeta: false,
    }
  }

  const provider = findProvider(providerId)
  if (!provider) throw new Error(`模型服务 "${providerId}" 未在服务器配置，请在设置中重新选择`)
  const serverKey = getServerApiKey(provider)
  const trustedEndpoint = normalizeEndpoint(getServerBaseURL(provider))
  const matchesAnyServerKey = !!suppliedKey && isServerKey(suppliedKey)
  if (matchesAnyServerKey && suppliedKey !== serverKey) {
    throw new Error('此密钥属于另一模型服务，服务器密钥不能跨服务使用')
  }
  const baseURL = requestedBaseURL ? normalizeEndpoint(requestedBaseURL) : trustedEndpoint
  // Legacy clients persisted an encrypted copy of the server key. Such copies
  // remain server credentials and must never be exported to another endpoint.
  const usesServerKey = !suppliedKey || matchesAnyServerKey
  if (usesServerKey && baseURL !== trustedEndpoint) {
    throw new Error('使用自定义模型地址时请提供自有 API Key；服务器密钥仅用于服务器配置的模型地址')
  }
  const apiKey = suppliedKey || serverKey
  if (!apiKey) throw new Error('尚未配置模型 API Key，请填写自有密钥或联系管理员配置')
  return {
    provider: provider.id,
    apiKey,
    baseURL,
    thinkingStyle: provider.thinkingStyle,
    supportsBeta: provider.supportsBeta,
    defaultModel: provider.defaultModel,
  }
}

/** @deprecated Prefer resolveAiTarget; kept for callers that only need key + endpoint. */
export function resolveAiCredentials(
  providerId: string,
  encryptedApiKey?: string,
  requestedBaseURL?: string,
): { apiKey: string; baseURL: string } {
  const { apiKey, baseURL } = resolveAiTarget({ provider: providerId, apiKey: encryptedApiKey, baseURL: requestedBaseURL })
  return { apiKey, baseURL }
}

/** Create a model for a browser request, applying the credential rules above. */
export function createRequestModel(request: AiRequestConfig, options: Omit<Partial<ModelOptions>, 'provider' | 'apiKey' | 'baseURL' | 'thinkingStyle' | 'supportsBeta'> = {}) {
  const target = resolveAiTarget(request)
  const model = request.model?.trim() || target.defaultModel
  if (!model) throw new Error('请先为该模型服务选择模型')
  return createModel({
    ...options,
    model,
    provider: target.provider,
    apiKey: target.apiKey,
    baseURL: target.baseURL,
    thinkingStyle: target.thinkingStyle,
    supportsBeta: target.supportsBeta,
  })
}
