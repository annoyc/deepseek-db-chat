import { createServerFn } from '@tanstack/react-start'
import { encrypt, decrypt } from '@/server/crypto'
import { z } from 'zod'

export const encryptPasswordFn = createServerFn({ method: 'POST' })
  .inputValidator((data: { password: string }) => z.object({ password: z.string().max(16_384) }).parse(data))
  .handler(
    async ({ data }): Promise<{ encrypted: string }> => {
      return { encrypted: encrypt(data.password) }
    }
  )

export const validatePasswordFn = createServerFn({ method: 'POST' })
  .inputValidator((data: { encrypted: string }) => z.object({ encrypted: z.string().max(40_000) }).parse(data))
  .handler(
    async ({ data }): Promise<{ valid: boolean }> => {
      if (!data.encrypted) return { valid: false }
      const result = decrypt(data.encrypted)
      return { valid: result !== '' || data.encrypted === '' }
    }
  )
