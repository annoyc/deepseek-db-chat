import { createServerFn } from '@tanstack/react-start'
import { getProvider } from '@/core/provider'
import { decrypt } from '@/server/crypto'
import { z } from 'zod'

export const getEnvApiKeyStatus = createServerFn({ method: 'POST' })
  .inputValidator((data: { provider?: string; apiKey?: string }) => z.object({
    provider: z.enum(['deepseek', 'bailian']).optional(),
    apiKey: z.string().max(40_000).optional(),
  }).parse(data))
  .handler(
    async ({ data }): Promise<{ hasEnvKey: boolean; isServerKey: boolean }> => {
      const providerDef = getProvider(data.provider ?? 'deepseek')
      const key = process.env[providerDef.envApiKeyName] || ''
      if (!key) {
        return { hasEnvKey: false, isServerKey: false }
      }
      return { hasEnvKey: true, isServerKey: !!data.apiKey && decrypt(data.apiKey) === key }
    }
  )
