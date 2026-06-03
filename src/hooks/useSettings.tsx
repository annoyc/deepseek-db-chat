import { createContext, useContext, useCallback, useEffect } from 'react'
import { useLocalStorage } from './useLocalStorage'
import { DEFAULT_MODEL, AVAILABLE_MODELS } from '@/lib/constants'
import { getEncryptedEnvApiKey } from '@/server/functions/settings'

interface SettingsState {
  apiKey: string
  model: string
  setApiKey: (key: string) => void
  clearApiKey: () => void
  setModel: (model: string) => void
}

const SettingsContext = createContext<SettingsState | null>(null)

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [apiKey, setApiKey, clearApiKey] = useLocalStorage<string>('deepseek-api-key', '')
  const [model, setModel] = useLocalStorage<string>('deepseek-model', DEFAULT_MODEL)

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
    setApiKey,
    clearApiKey: () => clearApiKey(),
    setModel,
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
