import { createServerFn } from '@tanstack/react-start'

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
