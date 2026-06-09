import { createServerFn } from '@tanstack/react-start'
import { getProvider } from '@/core'
import { encrypt } from '@/server/crypto'

export const getEnvApiKeyStatus = createServerFn({ method: 'POST' })
  .inputValidator((data: { provider?: string }) => data)
  .handler(
    async ({ data }): Promise<{ hasEnvKey: boolean; maskedKey: string }> => {
      const providerDef = getProvider(data.provider ?? 'deepseek')
      const key = process.env[providerDef.envApiKeyName] || ''
      if (!key) {
        return { hasEnvKey: false, maskedKey: '' }
      }
      const masked = key.length > 8
        ? key.slice(0, 5) + '...' + key.slice(-4)
        : key.slice(0, 3) + '...'
      return { hasEnvKey: true, maskedKey: masked }
    }
  )

export const getEncryptedEnvApiKey = createServerFn({ method: 'POST' })
  .inputValidator((data: { provider?: string }) => data)
  .handler(
    async ({ data }): Promise<{ encrypted: string | null }> => {
      const providerDef = getProvider(data.provider ?? 'deepseek')
      const key = process.env[providerDef.envApiKeyName]
      if (!key) {
        return { encrypted: null }
      }
      return { encrypted: encrypt(key) }
    }
  )
