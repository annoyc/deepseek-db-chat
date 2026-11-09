import { CUSTOM_PROVIDER_PREFIX, DEEPSEEK_PROVIDER, type ProviderModel, type ThinkingStyle } from '@/core/provider'

export type { ProviderModel, ThinkingStyle }

/** Per-browser overrides for a server-managed provider. */
export interface ProviderConfig {
  /** Encrypted user key; empty means "use the server key". */
  apiKey: string
  baseURL: string
}

/** An OpenAI-compatible service the user added in the browser. */
export interface CustomProvider {
  id: string
  name: string
  baseURL: string
  /** Encrypted user key. */
  apiKey: string
  models: ProviderModel[]
  thinkingStyle: ThinkingStyle
}

/** What the server reports about its own providers (mirrors ServerProviderInfo). */
export interface ServerProvider {
  id: string
  name: string
  models: ProviderModel[]
  defaultModel: string
  thinkingStyle: ThinkingStyle
  defaultBaseURL?: string
  hasEnvKey: boolean
}

/** A provider as the UI lists it, whichever side defined it. */
export interface ProviderOption {
  id: string
  name: string
  kind: 'server' | 'custom'
  models: ProviderModel[]
  defaultModel: string
  thinkingStyle: ThinkingStyle
  /** A key is available: the user's own, or the server's. */
  configured: boolean
}

export const THINKING_STYLE_LABELS: Record<ThinkingStyle, { label: string; hint: string }> = {
  none: { label: '不发送', hint: '不发送思考参数，兼容性最好' },
  enable_thinking: { label: 'enable_thinking', hint: '百炼 / 通义千问、硅基流动等：enable_thinking: true|false' },
  deepseek: { label: 'DeepSeek', hint: 'DeepSeek 原生：thinking: { type, reasoning_effort }' },
}

export interface ProviderTemplate {
  key: string
  name: string
  baseURL: string
  thinkingStyle: ThinkingStyle
  models: ProviderModel[]
}

/** Presets that only pre-fill the "add provider" form. */
export const PROVIDER_TEMPLATES: ProviderTemplate[] = [
  {
    key: 'bailian',
    name: '阿里云百炼',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    thinkingStyle: 'enable_thinking',
    models: [
      { id: 'qwen3.7-plus', name: 'Qwen 3.7 Plus' },
      { id: 'glm-5.2', name: 'GLM 5.2' },
      { id: 'kimi-k2.7-code', name: 'Kimi 2.7 Code' },
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
      { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
    ],
  },
  { key: 'siliconflow', name: '硅基流动', baseURL: 'https://api.siliconflow.cn/v1', thinkingStyle: 'enable_thinking', models: [] },
  { key: 'openrouter', name: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1', thinkingStyle: 'none', models: [] },
  { key: 'blank', name: '自定义（OpenAI 兼容）', baseURL: '', thinkingStyle: 'none', models: [] },
]

/** Shown until the server's provider list arrives. */
export const FALLBACK_SERVER_PROVIDERS: ServerProvider[] = [{
  id: DEEPSEEK_PROVIDER.id,
  name: DEEPSEEK_PROVIDER.name,
  models: DEEPSEEK_PROVIDER.models,
  defaultModel: DEEPSEEK_PROVIDER.defaultModel,
  thinkingStyle: DEEPSEEK_PROVIDER.thinkingStyle,
  defaultBaseURL: DEEPSEEK_PROVIDER.defaultBaseURL,
  hasEnvKey: false,
}]

export function createCustomProviderId(): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
    : Math.random().toString(36).slice(2, 14)
  return `${CUSTOM_PROVIDER_PREFIX}${random}`
}

export function buildProviderOptions(
  serverProviders: ServerProvider[],
  customProviders: CustomProvider[],
  configs: Record<string, ProviderConfig>,
): ProviderOption[] {
  return [
    ...serverProviders.map((p): ProviderOption => ({
      id: p.id,
      name: p.name,
      kind: 'server',
      models: p.models,
      defaultModel: p.defaultModel,
      thinkingStyle: p.thinkingStyle,
      configured: p.hasEnvKey || !!configs[p.id]?.apiKey,
    })),
    ...customProviders.map((p): ProviderOption => ({
      id: p.id,
      name: p.name,
      kind: 'custom',
      models: p.models,
      defaultModel: p.models[0]?.id ?? '',
      thinkingStyle: p.thinkingStyle,
      configured: !!p.apiKey,
    })),
  ]
}

export function modelLabel(model: ProviderModel): string {
  return model.name?.trim() || model.id
}

/** One model id per line; `id | 显示名` sets a display name. */
export function parseModelList(text: string): ProviderModel[] {
  const seen = new Set<string>()
  const models: ProviderModel[] = []
  for (const line of text.split(/\r?\n/)) {
    const [rawId, ...rest] = line.split('|')
    const id = rawId.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    const name = rest.join('|').trim()
    models.push(name ? { id, name } : { id })
  }
  return models
}

export function formatModelList(models: ProviderModel[]): string {
  return models.map(m => (m.name && m.name !== m.id ? `${m.id} | ${m.name}` : m.id)).join('\n')
}

export function validateBaseURL(value: string): string | null {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return '请输入合法的 HTTP(S) 地址'
  }
  if (!['http:', 'https:'].includes(url.protocol)) return '请输入合法的 HTTP(S) 地址'
  if (url.username || url.password || url.search || url.hash) return '地址不能包含凭据、查询参数或片段'
  return null
}

/**
 * Before custom providers existed, 百炼 was a fixed provider whose key the user
 * typed in the browser. If the server no longer offers it, turn that config into
 * a custom provider so nothing the user saved is lost.
 */
export function migrateLegacyBailian(
  configs: Record<string, ProviderConfig>,
  customProviders: CustomProvider[],
  serverProviderIds: string[],
): { configs: Record<string, ProviderConfig>; customProviders: CustomProvider[]; migratedId?: string } | null {
  const legacy = configs.bailian
  if (!legacy || serverProviderIds.includes('bailian')) return null
  const { bailian: _removed, ...rest } = configs
  if (!legacy.apiKey) return { configs: rest, customProviders }
  const template = PROVIDER_TEMPLATES.find(t => t.key === 'bailian')!
  const migrated: CustomProvider = {
    id: `${CUSTOM_PROVIDER_PREFIX}bailian`,
    name: template.name,
    baseURL: legacy.baseURL || template.baseURL,
    apiKey: legacy.apiKey,
    models: template.models,
    thinkingStyle: template.thinkingStyle,
  }
  if (customProviders.some(p => p.id === migrated.id)) return { configs: rest, customProviders }
  return { configs: rest, customProviders: [...customProviders, migrated], migratedId: migrated.id }
}
