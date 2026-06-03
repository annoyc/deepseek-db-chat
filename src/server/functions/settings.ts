import { createServerFn } from '@tanstack/react-start'
import { encrypt } from '@/server/crypto'

export const getEnvApiKeyStatus = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ hasEnvKey: boolean; maskedKey: string }> => {
    const key = process.env.DEEPSEEK_API_KEY || ''
    if (!key) {
      return { hasEnvKey: false, maskedKey: '' }
    }
    const masked = key.length > 8
      ? key.slice(0, 5) + '...' + key.slice(-4)
      : key.slice(0, 3) + '...'
    return { hasEnvKey: true, maskedKey: masked }
  }
)

export const getEncryptedEnvApiKey = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ encrypted: string | null }> => {
    const key = process.env.DEEPSEEK_API_KEY
    if (!key) {
      return { encrypted: null }
    }
    return { encrypted: encrypt(key) }
  }
)
