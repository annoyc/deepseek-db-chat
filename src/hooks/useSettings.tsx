import { createContext, useContext, useCallback } from 'react'
import { useLocalStorage } from './useLocalStorage'
import { DEFAULT_MODEL, AVAILABLE_MODELS } from '@/lib/constants'

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
