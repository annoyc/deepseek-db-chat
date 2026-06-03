import { createServerFn } from '@tanstack/react-start'
import { encrypt, decrypt } from '@/server/crypto'

export const encryptPasswordFn = createServerFn({ method: 'POST' })
  .inputValidator((data: { password: string }) => data)
  .handler(
    async ({ data }): Promise<{ encrypted: string }> => {
      return { encrypted: encrypt(data.password) }
    }
  )

export const validatePasswordFn = createServerFn({ method: 'POST' })
  .inputValidator((data: { encrypted: string }) => data)
  .handler(
    async ({ data }): Promise<{ valid: boolean }> => {
      if (!data.encrypted) return { valid: false }
      const result = decrypt(data.encrypted)
      return { valid: result !== '' || data.encrypted === '' }
    }
  )

export const decryptApiKeyFn = createServerFn({ method: 'POST' })
  .inputValidator((data: { encrypted: string }) => data)
  .handler(
    async ({ data }): Promise<{ decrypted: string }> => {
      if (!data.encrypted) return { decrypted: '' }
      return { decrypted: decrypt(data.encrypted) }
    }
  )