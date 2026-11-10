import { z } from 'zod'
import { omitBy } from '@/core/utils'

/**
 * How a provider expects thinking/reasoning to be toggled in the request body.
 * Every provider speaks the OpenAI chat-completions protocol; this is the only
 * request-shape difference the app needs to know about.
 *
 * - `deepseek`: `thinking: { type, reasoning_effort }` (DeepSeek native API)
 * - `enable_thinking`: `enable_thinking: boolean` (DashScope/Qwen, SiliconFlow, ...)
 * - `none`: send no thinking parameter at all (safe default for unknown services)
 */
export const THINKING_STYLES = ['deepseek', 'enable_thinking', 'none'] as const
export type ThinkingStyle = typeof THINKING_STYLES[number]

/** Ids of browser-defined providers. Server-managed ids may never use this prefix. */
export const CUSTOM_PROVIDER_PREFIX = 'custom-'
export const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/

export interface ProviderModel {
  id: string
  name?: string
  description?: string
}

/** A provider configured on the server; its API key (if any) lives in an env var. */
export interface ProviderDefinition {
  id: string
  name: string
  defaultBaseURL: string
  defaultModel: string
  models: ProviderModel[]
  envApiKeyName: string
  envBaseURLName?: string
  /** DeepSeek's `/beta` endpoint (strict tool calls, FIM). */
  supportsBeta: boolean
  thinkingStyle: ThinkingStyle
}

export const DEEPSEEK_PROVIDER: ProviderDefinition = {
  id: 'deepseek',
  name: 'DeepSeek',
  defaultBaseURL: 'https://api.deepseek.com',
  defaultModel: 'deepseek-flash',
  // `deepseek-flash` always serves the newest Flash snapshot (V4.1 Flash); the
  // retired `deepseek-v4-flash` alias is still accepted by the API but routed there.
  models: [
    { id: 'deepseek-flash', name: 'DeepSeek V4.1 Flash', description: '快速响应' },
    { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', description: '深度推理' },
  ],
  envApiKeyName: 'DEEPSEEK_API_KEY',
  envBaseURLName: 'DEEPSEEK_API_BASE_URL',
  supportsBeta: true,
  thinkingStyle: 'deepseek',
}

/** Kept only so deployments that set BAILIAN_API_KEY keep working unchanged. */
const LEGACY_BAILIAN_PROVIDER: ProviderDefinition = {
  id: 'bailian',
  name: '阿里云百炼',
  defaultBaseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  defaultModel: 'qwen3.7-plus',
  models: [
    { id: 'qwen3.7-plus', name: 'Qwen 3.7 Plus', description: '通用对话' },
    { id: 'glm-5.2', name: 'GLM 5.2', description: '智谱大模型' },
    { id: 'kimi-k2.7-code', name: 'Kimi 2.7 Code', description: 'Moonshot' },
    { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro (百炼)', description: '深度推理' },
    { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash (百炼)', description: '快速响应' },
  ],
  envApiKeyName: 'BAILIAN_API_KEY',
  envBaseURLName: 'BAILIAN_API_BASE_URL',
  supportsBeta: false,
  thinkingStyle: 'enable_thinking',
}

const modelSchema = z.union([
  z.string().trim().min(1).max(200).transform(id => ({ id })),
  z.object({
    id: z.string().trim().min(1).max(200),
    name: z.string().trim().max(100).optional(),
    description: z.string().trim().max(100).optional(),
  }),
])

const serverProviderSchema = z.object({
  id: z.string().regex(PROVIDER_ID_PATTERN)
    .refine(id => !id.startsWith(CUSTOM_PROVIDER_PREFIX), `id 不能以 "${CUSTOM_PROVIDER_PREFIX}" 开头`)
    .refine(id => id !== DEEPSEEK_PROVIDER.id, 'id "deepseek" 为内置 provider'),
  name: z.string().trim().min(1).max(50),
  baseURL: z.url({ protocol: /^https?$/ }),
  apiKeyEnv: z.string().regex(/^[A-Z_][A-Z0-9_]*$/),
  models: z.array(modelSchema).min(1).max(100),
  defaultModel: z.string().trim().min(1).optional(),
  thinkingStyle: z.enum(THINKING_STYLES).default('none'),
})

let cachedRaw: string | undefined
let cachedExtra: ProviderDefinition[] = []

/**
 * Parse `AI_PROVIDERS`: a JSON array of extra server-managed providers, e.g.
 * `[{"id":"qwen","name":"通义千问","baseURL":"https://...","apiKeyEnv":"QWEN_API_KEY","models":["qwen3.7-plus"],"thinkingStyle":"enable_thinking"}]`.
 * Invalid entries are skipped with a warning so a typo never takes the app down.
 */
function parseExtraProviders(raw: string | undefined): ProviderDefinition[] {
  if (!raw?.trim()) return []
  let entries: unknown
  try {
    entries = JSON.parse(raw)
  } catch {
    console.warn('[provider] AI_PROVIDERS 不是合法 JSON，已忽略')
    return []
  }
  if (!Array.isArray(entries)) {
    console.warn('[provider] AI_PROVIDERS 必须是 JSON 数组，已忽略')
    return []
  }
  const result: ProviderDefinition[] = []
  for (const [index, entry] of entries.entries()) {
    const parsed = serverProviderSchema.safeParse(entry)
    if (!parsed.success) {
      console.warn(`[provider] AI_PROVIDERS[${index}] 配置无效，已忽略：${parsed.error.issues.map(i => i.message).join('; ')}`)
      continue
    }
    const p = parsed.data
    if (result.some(r => r.id === p.id)) {
      console.warn(`[provider] AI_PROVIDERS 中 id "${p.id}" 重复，已忽略`)
      continue
    }
    result.push({
      id: p.id,
      name: p.name,
      defaultBaseURL: p.baseURL,
      defaultModel: p.defaultModel ?? p.models[0].id,
      models: p.models,
      envApiKeyName: p.apiKeyEnv,
      supportsBeta: false,
      thinkingStyle: p.thinkingStyle,
    })
  }
  return result
}

function env(name: string | undefined): string | undefined {
  if (!name || typeof process === 'undefined') return undefined
  return process.env[name]?.trim() || undefined
}

/** Server-managed providers. Read from the environment on every call (cheap; cached by raw value). */
function serverProviders(): ProviderDefinition[] {
  const raw = env('AI_PROVIDERS')
  if (raw !== cachedRaw) {
    cachedRaw = raw
    cachedExtra = parseExtraProviders(raw)
  }
  const list = [DEEPSEEK_PROVIDER]
  if (env(LEGACY_BAILIAN_PROVIDER.envApiKeyName) && !cachedExtra.some(p => p.id === LEGACY_BAILIAN_PROVIDER.id)) {
    list.push(LEGACY_BAILIAN_PROVIDER)
  }
  return [...list, ...cachedExtra]
}

export function isCustomProviderId(id: string): boolean {
  return id.startsWith(CUSTOM_PROVIDER_PREFIX)
}

export function findProvider(id: string): ProviderDefinition | undefined {
  return serverProviders().find(p => p.id === id)
}

export function getProvider(id: string): ProviderDefinition {
  const provider = findProvider(id)
  if (!provider) {
    throw new Error(`Unknown provider: "${id}". Available: ${serverProviders().map(p => p.id).join(', ')}`)
  }
  return provider
}

export function getProviderList(): ProviderDefinition[] {
  return serverProviders()
}

export function getServerApiKey(provider: ProviderDefinition): string {
  return env(provider.envApiKeyName) ?? ''
}

export function getServerBaseURL(provider: ProviderDefinition): string {
  return env(provider.envBaseURLName) ?? provider.defaultBaseURL
}

/** Build the provider-specific thinking parameters spread into the top-level request body. */
export function buildThinkingParams(
  style: ThinkingStyle,
  thinking: { type: 'enabled' | 'disabled' } | undefined,
  reasoningEffort?: string,
): Record<string, unknown> {
  switch (style) {
    case 'deepseek':
      if (!thinking) return {}
      return {
        thinking: omitBy({
          type: thinking.type,
          reasoning_effort: thinking.type === 'disabled' ? undefined : reasoningEffort,
        }, v => v === undefined),
      }
    case 'enable_thinking':
      return { enable_thinking: thinking?.type !== 'disabled' }
    case 'none':
      return {}
  }
}

export function parseThinkingStyle(value: unknown): ThinkingStyle | undefined {
  return (THINKING_STYLES as readonly unknown[]).includes(value) ? value as ThinkingStyle : undefined
}
