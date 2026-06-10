import { createContext, useContext, useEffect, useCallback, useRef } from 'react'
import { useLocalStorage } from './useLocalStorage'
import { DEFAULT_MODEL, DEFAULT_PROVIDER, PROVIDERS, getDefaultModelForProvider } from '@/lib/constants'
import type { ModelProvider } from '@/lib/constants'
import { SESSION_MAX_SQL_EXECUTIONS } from '@/core/constants'
import { getEncryptedEnvApiKey } from '@/server/functions/settings'
import { db } from '@/lib/db'

export interface ProviderConfig {
  apiKey: string
  baseURL: string
}

type ProviderConfigs = Record<string, ProviderConfig>

export type ReasoningEffort = 'high' | 'max'

interface SettingsState {
  provider: ModelProvider
  apiKey: string
  baseURL: string
  providerConfigs: ProviderConfigs
  model: string
  thinkingMode: 'enabled' | 'disabled'
  reasoningEffort: ReasoningEffort
  sqlPermission: 'readonly' | 'write'
  maxSqlExecutions: number
  thinkingCollapseMode: 'expanded' | 'collapsed'
  toolCallCollapseMode: 'expanded' | 'collapsed'
  setProvider: (provider: ModelProvider) => void
  setProviderConfig: (providerId: string, config: Partial<ProviderConfig>) => void
  clearProviderApiKey: (providerId: string) => void
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
  const [provider, setProviderRaw] = useLocalStorage<ModelProvider>('ai-provider', DEFAULT_PROVIDER as ModelProvider)
  const [providerConfigs, setProviderConfigs] = useLocalStorage<ProviderConfigs>('provider-configs', {})
  const [model, setModel] = useLocalStorage<string>('selected-model', DEFAULT_MODEL)
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


  const activeConfig = providerConfigs[provider] ?? EMPTY_CONFIG
  const apiKey = activeConfig.apiKey
  const baseURL = activeConfig.baseURL

  const setProvider = useCallback((newProvider: ModelProvider) => {
    setProviderRaw(newProvider)
    setModel(getDefaultModelForProvider(newProvider))
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

  // Auto-fetch env keys once on mount (not on every providerConfigs change)
  const envFetched = useRef(false)
  useEffect(() => {
    if (envFetched.current) return
    envFetched.current = true

    for (const p of PROVIDERS) {
      getEncryptedEnvApiKey({ data: { provider: p.id } }).then(({ encrypted }) => {
        if (encrypted) {
          setProviderConfigs((prev) => {
            if (prev[p.id]?.apiKey) return prev
            const existing = prev[p.id] ?? EMPTY_CONFIG
            return { ...prev, [p.id]: { ...existing, apiKey: encrypted } }
          })
        }
      }).catch(() => {})
    }
  }, [setProviderConfigs])

  const value: SettingsState = {
    provider,
    apiKey,
    baseURL,
    providerConfigs,
    model,
    thinkingMode,
    reasoningEffort,
    sqlPermission,
    maxSqlExecutions,
    thinkingCollapseMode,
    toolCallCollapseMode,
    setProvider,
    setProviderConfig,
    clearProviderApiKey,
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
