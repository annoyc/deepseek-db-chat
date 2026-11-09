import { createContext, useContext, useEffect, useCallback, useMemo, useRef, useState } from 'react'
import { useLocalStorage } from './useLocalStorage'
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from '@/lib/constants'
import {
  buildProviderOptions,
  FALLBACK_SERVER_PROVIDERS,
  migrateLegacyBailian,
  type CustomProvider,
  type ProviderConfig,
  type ProviderOption,
  type ServerProvider,
  type ThinkingStyle,
} from '@/lib/providers'
import { SESSION_MAX_SQL_EXECUTIONS } from '@/core/constants'
import { getEnvApiKeyStatus, listServerProviders } from '@/server/functions/settings'

export type { CustomProvider, ProviderConfig, ProviderOption }

type ProviderConfigs = Record<string, ProviderConfig>

export type ReasoningEffort = 'high' | 'max'

/** The model-service fields every AI server function takes. */
export interface AiRequestFields {
  provider: string
  model: string
  apiKey?: string
  baseURL?: string
  thinkingStyle?: ThinkingStyle
  /** Name of a custom provider, so the model can be told where it runs. */
  providerName?: string
}

interface SettingsState {
  provider: string
  apiKey: string
  baseURL: string
  /** Thinking parameter style of the active provider. */
  thinkingStyle: ThinkingStyle
  /** Ready-to-send model-service fields for server functions. */
  aiRequest: AiRequestFields
  providers: ProviderOption[]
  activeProvider: ProviderOption | undefined
  serverProviders: ServerProvider[]
  customProviders: CustomProvider[]
  providerConfigs: ProviderConfigs
  model: string
  thinkingMode: 'enabled' | 'disabled'
  reasoningEffort: ReasoningEffort
  sqlPermission: 'readonly' | 'write'
  maxSqlExecutions: number
  thinkingCollapseMode: 'expanded' | 'collapsed'
  toolCallCollapseMode: 'expanded' | 'collapsed'
  setProvider: (provider: string) => void
  /** Switch to a specific provider and model at once (the model need not be the provider's default). */
  selectModel: (providerId: string, modelId: string) => void
  setProviderConfig: (providerId: string, config: Partial<ProviderConfig>) => void
  clearProviderApiKey: (providerId: string) => void
  saveCustomProvider: (provider: CustomProvider) => void
  removeCustomProvider: (providerId: string) => void
  setModel: (model: string) => void
  setThinkingMode: (mode: 'enabled' | 'disabled') => void
  setReasoningEffort: (effort: ReasoningEffort) => void
  setSqlPermission: (mode: 'readonly' | 'write') => void
  setMaxSqlExecutions: (max: number) => void
  setThinkingCollapseMode: (mode: 'expanded' | 'collapsed') => void
  setToolCallCollapseMode: (mode: 'expanded' | 'collapsed') => void
}

const SettingsContext = createContext<SettingsState | null>(null)

const EMPTY_CONFIG: ProviderConfig = { apiKey: '', baseURL: '' }

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [provider, setProviderRaw, , providerHydrated] = useLocalStorage<string>('ai-provider', DEFAULT_PROVIDER)
  const [providerConfigs, setProviderConfigs, , configsHydrated] = useLocalStorage<ProviderConfigs>('provider-configs', {})
  const [customProviders, setCustomProviders, , customHydrated] = useLocalStorage<CustomProvider[]>('custom-providers', [])
  const [model, setModel, , modelHydrated] = useLocalStorage<string>('selected-model', DEFAULT_MODEL)
  const [thinkingMode, setThinkingMode] = useLocalStorage<'enabled' | 'disabled'>(
    'thinking-mode',
    'enabled'
  )
  const [reasoningEffort, setReasoningEffort] = useLocalStorage<ReasoningEffort>(
    'reasoning-effort',
    'high'
  )
  const [sqlPermission, setSqlPermission] = useLocalStorage<'readonly' | 'write'>('sql-permission', 'readonly')
  const [maxSqlExecutions, setMaxSqlExecutions] = useLocalStorage<number>('max-sql-executions', SESSION_MAX_SQL_EXECUTIONS)
  const [thinkingCollapseMode, setThinkingCollapseMode] = useLocalStorage<'expanded' | 'collapsed'>(
    'thinking-collapse-mode',
    'collapsed'
  )
  const [toolCallCollapseMode, setToolCallCollapseMode] = useLocalStorage<'expanded' | 'collapsed'>(
    'toolcall-collapse-mode',
    'collapsed'
  )

  const [serverProviders, setServerProviders] = useState<ServerProvider[]>(FALLBACK_SERVER_PROVIDERS)
  const [serverLoaded, setServerLoaded] = useState(false)
  useEffect(() => {
    let cancelled = false
    listServerProviders()
      .then((list) => { if (!cancelled && list.length) setServerProviders(list) })
      .catch((err) => console.warn('[useSettings] Failed to load server providers:', err))
      .finally(() => { if (!cancelled) setServerLoaded(true) })
    return () => { cancelled = true }
  }, [])

  const safeCustomProviders = useMemo(() => (Array.isArray(customProviders) ? customProviders : []), [customProviders])
  const providers = useMemo(
    () => buildProviderOptions(serverProviders, safeCustomProviders, providerConfigs),
    [serverProviders, safeCustomProviders, providerConfigs],
  )
  const activeProvider = providers.find((p) => p.id === provider)
  const activeCustom = safeCustomProviders.find((p) => p.id === provider)
  const activeConfig = activeCustom ?? providerConfigs[provider] ?? EMPTY_CONFIG
  const apiKey = activeConfig.apiKey
  const baseURL = activeConfig.baseURL
  const thinkingStyle: ThinkingStyle = activeProvider?.thinkingStyle ?? 'none'

  const aiRequest = useMemo<AiRequestFields>(() => ({
    provider,
    model,
    apiKey: apiKey || undefined,
    baseURL: baseURL || undefined,
    // Server providers' style is decided on the server; only custom ones send it.
    thinkingStyle: activeCustom ? activeCustom.thinkingStyle : undefined,
    providerName: activeCustom ? activeCustom.name : undefined,
  }), [provider, model, apiKey, baseURL, activeCustom])

  const setProvider = useCallback((newProvider: string) => {
    setProviderRaw(newProvider)
    const option = providers.find((p) => p.id === newProvider)
    setModel(option?.defaultModel ?? '')
  }, [providers, setProviderRaw, setModel])

  const selectModel = useCallback((providerId: string, modelId: string) => {
    setProviderRaw(providerId)
    setModel(modelId)
  }, [setProviderRaw, setModel])

  const setProviderConfig = useCallback((providerId: string, partial: Partial<ProviderConfig>) => {
    setProviderConfigs((prev) => {
      const existing = prev[providerId] ?? EMPTY_CONFIG
      return { ...prev, [providerId]: { ...existing, ...partial } }
    })
  }, [setProviderConfigs])

  const clearProviderApiKey = useCallback((providerId: string) => {
    setProviderConfigs((prev) => {
      const existing = prev[providerId] ?? EMPTY_CONFIG
      return { ...prev, [providerId]: { ...existing, apiKey: '' } }
    })
  }, [setProviderConfigs])

  const saveCustomProvider = useCallback((next: CustomProvider) => {
    setCustomProviders((prev) => {
      const list = Array.isArray(prev) ? prev : []
      const index = list.findIndex((p) => p.id === next.id)
      if (index === -1) return [...list, next]
      const copy = [...list]
      copy[index] = next
      return copy
    })
  }, [setCustomProviders])

  const removeCustomProvider = useCallback((providerId: string) => {
    setCustomProviders((prev) => (Array.isArray(prev) ? prev : []).filter((p) => p.id !== providerId))
  }, [setCustomProviders])

  const allHydrated = providerHydrated && configsHydrated && customHydrated && modelHydrated

  // One-time migration of the formerly built-in 百炼 provider.
  useEffect(() => {
    if (!allHydrated || !serverLoaded) return
    const result = migrateLegacyBailian(providerConfigs, safeCustomProviders, serverProviders.map((p) => p.id))
    if (!result) return
    setProviderConfigs(result.configs)
    if (result.customProviders !== safeCustomProviders) setCustomProviders(result.customProviders)
    if (provider === 'bailian' && result.migratedId) setProviderRaw(result.migratedId)
  }, [allHydrated, serverLoaded, providerConfigs, safeCustomProviders, serverProviders, provider, setProviderConfigs, setCustomProviders, setProviderRaw])

  // Keep the selection valid when providers or their model lists change.
  useEffect(() => {
    if (!allHydrated || !serverLoaded) return
    if (provider === 'bailian' && providerConfigs.bailian && !providers.some((p) => p.id === 'bailian')) return // migration pending
    const option = providers.find((p) => p.id === provider)
    if (!option) {
      const fallback = providers[0]
      if (fallback) {
        setProviderRaw(fallback.id)
        setModel(fallback.defaultModel)
      }
      return
    }
    if (option.models.length > 0 && !option.models.some((m) => m.id === model)) {
      setModel(option.defaultModel)
    }
  }, [allHydrated, serverLoaded, provider, providers, providerConfigs, model, setProviderRaw, setModel])

  useEffect(() => {
    if (thinkingMode !== 'enabled' && thinkingMode !== 'disabled') {
      setThinkingMode('enabled')
    }
  }, [thinkingMode, setThinkingMode])

  useEffect(() => {
    if (typeof maxSqlExecutions !== 'number' || maxSqlExecutions < 1) {
      setMaxSqlExecutions(1)
    } else if (maxSqlExecutions > 100) {
      setMaxSqlExecutions(100)
    }
  }, [maxSqlExecutions, setMaxSqlExecutions])

  // Remove legacy copies of server keys without returning any secret to the browser.
  // User-supplied keys are preserved; IndexedDB hydration can complete after mount.
  const checkedKeys = useRef(new Set<string>())
  useEffect(() => {
    for (const [providerId, config] of Object.entries(providerConfigs)) {
      const apiKey = config?.apiKey
      if (!apiKey) continue
      const checkId = `${providerId}:${apiKey}`
      if (checkedKeys.current.has(checkId)) continue
      checkedKeys.current.add(checkId)
      getEnvApiKeyStatus({ data: { provider: providerId, apiKey } }).then(({ isServerKey }) => {
        if (isServerKey) {
          setProviderConfigs((prev) => {
            if (prev[providerId]?.apiKey !== apiKey) return prev
            return { ...prev, [providerId]: { ...prev[providerId], apiKey: '' } }
          })
        }
      }).catch((err) => console.warn('[useSettings] Failed to check legacy API key:', err))
    }
  }, [providerConfigs, setProviderConfigs])

  const value: SettingsState = {
    provider,
    apiKey,
    baseURL,
    thinkingStyle,
    aiRequest,
    providers,
    activeProvider,
    serverProviders,
    customProviders: safeCustomProviders,
    providerConfigs,
    model,
    thinkingMode,
    reasoningEffort,
    sqlPermission,
    maxSqlExecutions,
    thinkingCollapseMode,
    toolCallCollapseMode,
    setProvider,
    selectModel,
    setProviderConfig,
    clearProviderApiKey,
    saveCustomProvider,
    removeCustomProvider,
    setModel,
    setThinkingMode,
    setReasoningEffort,
    setSqlPermission,
    setMaxSqlExecutions,
    setThinkingCollapseMode,
    setToolCallCollapseMode,
  }

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings(): SettingsState {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider')
  return ctx
}
