import { omitBy } from '@/core/utils'

export interface ProviderDefinition {
  id: string
  name: string
  defaultBaseURL: string
  defaultModel: string
  envApiKeyName: string
  envBaseURLName: string
  supportsBeta: boolean
  /**
   * Build provider-specific thinking/reasoning parameters for the request body.
   * Returns a flat object whose entries are spread into the top-level request.
   */
  buildThinkingParams(
    thinking: { type: 'enabled' | 'disabled' } | undefined,
    reasoningEffort?: string,
  ): Record<string, unknown>
}

const deepseek: ProviderDefinition = {
  id: 'deepseek',
  name: 'DeepSeek',
  defaultBaseURL: 'https://api.deepseek.com',
  defaultModel: 'deepseek-v4-flash',
  envApiKeyName: 'DEEPSEEK_API_KEY',
  envBaseURLName: 'DEEPSEEK_API_BASE_URL',
  supportsBeta: true,
  buildThinkingParams(thinking, reasoningEffort) {
    if (!thinking) return {}
    return {
      thinking: omitBy({
        type: thinking.type,
        reasoning_effort: reasoningEffort,
      }, v => v === undefined),
    }
  },
}

const bailian: ProviderDefinition = {
  id: 'bailian',
  name: '阿里云百炼',
  defaultBaseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  defaultModel: 'kimi-k2.7-code',
  envApiKeyName: 'BAILIAN_API_KEY',
  envBaseURLName: 'BAILIAN_API_BASE_URL',
  supportsBeta: false,
  buildThinkingParams(thinking) {
    const enabled = thinking?.type !== 'disabled'
    return { enable_thinking: enabled }
  },
}

const providers: Record<string, ProviderDefinition> = {
  deepseek,
  bailian,
}

export function getProvider(id: string): ProviderDefinition {
  const provider = providers[id]
  if (!provider) {
    throw new Error(`Unknown provider: "${id}". Available: ${Object.keys(providers).join(', ')}`)
  }
  return provider
}

export function getProviderList(): ProviderDefinition[] {
  return Object.values(providers)
}
