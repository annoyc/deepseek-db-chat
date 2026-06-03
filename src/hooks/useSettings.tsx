import { createContext, useContext, useCallback, useEffect } from 'react'
import { useLocalStorage } from './useLocalStorage'
import { DEFAULT_MODEL, AVAILABLE_MODELS } from '@/lib/constants'
import { getEncryptedEnvApiKey } from '@/server/functions/settings'

interface SettingsState {
  apiKey: string
  model: string
  thinkingMode: 'enabled' | 'disabled'
  setApiKey: (key: string) => void
  clearApiKey: () => void
  setModel: (model: string) => void
  setThinkingMode: (mode: 'enabled' | 'disabled') => void
}

const SettingsContext = createContext<SettingsState | null>(null)

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [apiKey, setApiKey, clearApiKey] = useLocalStorage<string>('deepseek-api-key', '')
  const [model, setModel] = useLocalStorage<string>('deepseek-model', DEFAULT_MODEL)
  const [thinkingMode, setThinkingMode] = useLocalStorage<'enabled' | 'disabled'>(
    'deepseek-thinking-mode',
    'enabled'
  )

  // 确保默认值为 'enabled'（思考模式）
  useEffect(() => {
    if (thinkingMode !== 'enabled' && thinkingMode !== 'disabled') {
      setThinkingMode('enabled')
    }
  }, [thinkingMode, setThinkingMode])

  // 当 localStorage 没有 key 时，自动从 env 获取并加密保存
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
    setApiKey,
    clearApiKey: () => clearApiKey(),
    setModel,
    setThinkingMode,
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
