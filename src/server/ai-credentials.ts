import { getProvider, getProviderList } from '@/core/provider'
import { decrypt } from '@/server/crypto'

function normalizeEndpoint(value: string): string {
  const url = new URL(value)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('模型地址必须为不含凭据、查询参数或片段的 HTTP(S) 地址')
  }
  return url.toString().replace(/\/+$/, '')
}

/** Server credentials are confined to the provider endpoint configured on the server. */
export function resolveAiCredentials(
  providerId: string,
  encryptedApiKey?: string,
  requestedBaseURL?: string,
): { apiKey: string; baseURL: string } {
  const provider = getProvider(providerId)
  const serverKey = process.env[provider.envApiKeyName]?.trim() || ''
  const trustedEndpoint = normalizeEndpoint(process.env[provider.envBaseURLName] || provider.defaultBaseURL)
  const suppliedKey = encryptedApiKey ? decrypt(encryptedApiKey).trim() : ''
  if (encryptedApiKey && !suppliedKey) throw new Error('自定义 API Key 解密失败，请重新填写')
  const matchesAnyServerKey = !!suppliedKey && getProviderList().some(item => process.env[item.envApiKeyName]?.trim() === suppliedKey)
  if (matchesAnyServerKey && suppliedKey !== serverKey) {
    throw new Error('此密钥属于另一模型服务，服务器密钥不能跨服务使用')
  }
  const baseURL = requestedBaseURL?.trim() ? normalizeEndpoint(requestedBaseURL.trim()) : trustedEndpoint
  // Legacy clients persisted an encrypted copy of the server key. Such copies
  // remain server credentials and must never be exported to another endpoint.
  const usesServerKey = !suppliedKey || matchesAnyServerKey
  if (usesServerKey && baseURL !== trustedEndpoint) {
    throw new Error('使用自定义模型地址时请提供自有 API Key；服务器密钥仅用于服务器配置的模型地址')
  }
  const apiKey = suppliedKey || serverKey
  if (!apiKey) throw new Error('尚未配置模型 API Key，请填写自有密钥或联系管理员配置')
  return { apiKey, baseURL }
}
