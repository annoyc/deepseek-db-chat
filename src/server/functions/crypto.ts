import { createServerFn } from '@tanstack/react-start'
import { encrypt } from '@/server/crypto'

export const encryptPasswordFn = createServerFn({ method: 'POST' })
  .inputValidator((data: { password: string }) => data)
  .handler(
    async ({ data }): Promise<{ encrypted: string }> => {
      return { encrypted: encrypt(data.password) }
    }
  )