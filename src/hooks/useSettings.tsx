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
import { getEnvApiKeyStatus, listProviderModels, listServerProviders, type FetchedProviderModel } from '@/server/functions/settings'
import { normalizeCollapseMode, type CollapseMode } from '@/lib/collapse-mode'
import type { ContextWindowOverride } from '@/lib/context-window'

export type { CollapseMode, CustomProvider, ProviderConfig, ProviderOption }

type ProviderConfigs = Record<string, ProviderConfig>

export type ReasoningEffort = 'high' | 'max'

/** The model-service fields every AI server function takes. */
export interface AiRequestFields {
  provider: string
  model: string
  apiKey?: string
  baseURL?: string
  thinkingStyle?: ThinkingStyle
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
  thinkingCollapseMode: CollapseMode
  toolCallCollapseMode: CollapseMode
  /** Explicit context window override for the active provider + model (user > api > configured). */
  activeContextWindowOverride: ContextWindowOverride | undefined
  setModelContextWindow: (providerId: string, modelId: string, tokens: number | null) => void
  recordDiscoveredContextWindows: (providerId: string, models: FetchedProviderModel[]) => void
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
  setThinkingCollapseMode: (mode: CollapseMode) => void
  setToolCallCollapseMode: (mode: CollapseMode) => void
}

const SettingsContext = createContext<SettingsState | null>(null)

const EMPTY_CONFIG: ProviderConfig = { apiKey: '', baseURL: '' }

function modelContextWindowKey(providerId: string, modelId: string): string {
  return `${providerId}:${modelId}`
}

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
  const [thinkingCollapseModeRaw, setThinkingCollapseMode] = useLocalStorage<CollapseMode>(
    'thinking-collapse-mode',
    'auto'
  )
  const [toolCallCollapseModeRaw, setToolCallCollapseMode] = useLocalStorage<CollapseMode>(
    'toolcall-collapse-mode',
    'auto'
  )
  const [modelContextWindows, setModelContextWindows, , userWindowsHydrated] = useLocalStorage<Record<string, number>>(
    'model-context-windows',
    {}
  )
  const [discoveredContextWindows, setDiscoveredContextWindows, , apiWindowsHydrated] = useLocalStorage<Record<string, number>>(
    'discovered-context-windows',
    {}
  )
  const thinkingCollapseMode = normalizeCollapseMode(thinkingCollapseModeRaw, 'auto')
  const toolCallCollapseMode = normalizeCollapseMode(toolCallCollapseModeRaw, 'auto')

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

  const setModelContextWindow = useCallback((providerId: string, modelId: string, tokens: number | null) => {
    const cleanProvider = providerId.trim()
    const cleanModel = modelId.trim()
    if (!cleanProvider || !cleanModel) return
    const key = modelContextWindowKey(cleanProvider, cleanModel)
    setModelContextWindows((prev) => {
      const current = prev && typeof prev === 'object' ? prev : {}
      if (tokens === null || !Number.isFinite(tokens) || tokens <= 0) {
        if (!(key in current)) return current
        const next = { ...current }
        delete next[key]
        return next
      }
      const rounded = Math.round(tokens)
      if (current[key] === rounded) return current
      return { ...current, [key]: rounded }
    })
  }, [setModelContextWindows])

  const recordDiscoveredContextWindows = useCallback((providerId: string, models: FetchedProviderModel[]) => {
    const cleanProvider = providerId.trim()
    if (!cleanProvider || !Array.isArray(models) || models.length === 0) return
    setDiscoveredContextWindows((prev) => {
      const current = prev && typeof prev === 'object' ? prev : {}
      let changed = false
      const next = { ...current }
      for (const item of models) {
        if (!item?.id || typeof item.contextWindow !== 'number' || !Number.isFinite(item.contextWindow) || item.contextWindow <= 0) {
          continue
        }
        const key = modelContextWindowKey(cleanProvider, item.id)
        const rounded = Math.round(item.contextWindow)
        if (next[key] !== rounded) {
          next[key] = rounded
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [setDiscoveredContextWindows])

  const activeContextWindowOverride = useMemo<ContextWindowOverride | undefined>(() => {
    const cleanModel = model.trim()
    if (!cleanModel) return undefined
    const key = modelContextWindowKey(provider, cleanModel)
    const userVal = modelContextWindows?.[key]
    if (typeof userVal === 'number' && Number.isFinite(userVal) && userVal > 0) {
      return { tokens: Math.round(userVal), source: 'user' }
    }
    const apiVal = discoveredContextWindows?.[key]
    if (typeof apiVal === 'number' && Number.isFinite(apiVal) && apiVal > 0) {
      return { tokens: Math.round(apiVal), source: 'api' }
    }
    const configuredVal = activeProvider?.models.find((m) => m.id === cleanModel)?.contextWindow
    if (typeof configuredVal === 'number' && Number.isFinite(configuredVal) && configuredVal > 0) {
      return { tokens: Math.round(configuredVal), source: 'configured' }
    }
    return undefined
  }, [provider, model, modelContextWindows, discoveredContextWindows, activeProvider])

  const allHydrated = providerHydrated && configsHydrated && customHydrated && modelHydrated && userWindowsHydrated && apiWindowsHydrated

  // Silently probe `/models` once per configured provider when the active model lacks an explicit context window.
  const probedProvidersRef = useRef(new Set<string>())
  useEffect(() => {
    if (!allHydrated || !serverLoaded || !activeProvider?.configured || !model.trim()) return
    if (activeContextWindowOverride) return
    if (probedProvidersRef.current.has(provider)) return
    probedProvidersRef.current.add(provider)

    let cancelled = false
    listProviderModels({
      data: {
        provider: aiRequest.provider,
        apiKey: aiRequest.apiKey,
        baseURL: aiRequest.baseURL,
        thinkingStyle: aiRequest.thinkingStyle,
      },
    })
      .then((list) => {
        if (!cancelled && Array.isArray(list) && list.length > 0) {
          recordDiscoveredContextWindows(provider, list)
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [allHydrated, serverLoaded, activeProvider?.configured, provider, model, activeContextWindowOverride, aiRequest, recordDiscoveredContextWindows])

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
    activeContextWindowOverride,
    setModelContextWindow,
    recordDiscoveredContextWindows,
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
