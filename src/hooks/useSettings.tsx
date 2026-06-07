import { createContext, useContext, useEffect } from 'react'
import { useLocalStorage } from './useLocalStorage'
import { DEFAULT_MODEL, AVAILABLE_MODELS } from '@/lib/constants'
import { SESSION_MAX_SQL_EXECUTIONS } from '@/core/constants'
import { getEncryptedEnvApiKey } from '@/server/functions/settings'
import { db } from '@/lib/db'

interface SettingsState {
  apiKey: string
  model: string
  thinkingMode: 'enabled' | 'disabled'
  sqlPermission: 'readonly' | 'write'
  maxSqlExecutions: number
  thinkingCollapseMode: 'expanded' | 'collapsed'
  toolCallCollapseMode: 'expanded' | 'collapsed'
  setApiKey: (key: string) => void
  clearApiKey: () => void
  setModel: (model: string) => void
  setThinkingMode: (mode: 'enabled' | 'disabled') => void
  setSqlPermission: (mode: 'readonly' | 'write') => void
  setMaxSqlExecutions: (max: number) => void
  setThinkingCollapseMode: (mode: 'expanded' | 'collapsed') => void
  setToolCallCollapseMode: (mode: 'expanded' | 'collapsed') => void
}

const SettingsContext = createContext<SettingsState | null>(null)

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [apiKey, setApiKey, clearApiKey] = useLocalStorage<string>('deepseek-api-key', '')
  const [model, setModel] = useLocalStorage<string>('deepseek-model', DEFAULT_MODEL)
  const [thinkingMode, setThinkingMode] = useLocalStorage<'enabled' | 'disabled'>(
    'deepseek-thinking-mode',
    'enabled'
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

  // 确保默认值为 'enabled'（思考模式）
  useEffect(() => {
    if (thinkingMode !== 'enabled' && thinkingMode !== 'disabled') {
      setThinkingMode('enabled')
    }
  }, [thinkingMode, setThinkingMode])

  // 确保 maxSqlExecutions 在合理范围内
  useEffect(() => {
    if (typeof maxSqlExecutions !== 'number' || maxSqlExecutions < 1) {
      setMaxSqlExecutions(1)
    } else if (maxSqlExecutions > 100) {
      setMaxSqlExecutions(100)
    }
  }, [maxSqlExecutions, setMaxSqlExecutions])

  // 当 IndexedDB 没有 key 时，自动从 env 获取并加密保存
  useEffect(() => {
    if (apiKey) return
    getEncryptedEnvApiKey().then(({ encrypted }) => {
      if (encrypted) {
        setApiKey(encrypted)
      }
    }).catch(() => {})
  }, [apiKey, setApiKey])

  const value: SettingsState = {
    apiKey,
    model,
    thinkingMode,
    sqlPermission,
    maxSqlExecutions,
    thinkingCollapseMode,
    toolCallCollapseMode,
    setApiKey,
    clearApiKey: () => clearApiKey(),
    setModel,
    setThinkingMode,
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
