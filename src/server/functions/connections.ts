import { createServerFn } from '@tanstack/react-start'
import { testConnection } from '@/server/database'
import { decrypt } from '@/server/crypto'
import type { DatabaseConnection } from '@/lib/types'

export const testConnectionFn = createServerFn({ method: 'POST' })
  .inputValidator((data: DatabaseConnection) => data)
  .handler(
    async ({ data }): Promise<{ success: boolean; error?: string }> => {
      const decryptedPassword = decrypt(data.password)
      if (decryptedPassword === '' && data.password !== '') {
        return { success: false, error: '密码解密失败，请重新输入数据库密码' }
      }
      const decryptedConn: DatabaseConnection = {
        ...data,
        password: decryptedPassword,
      }
      return testConnection(decryptedConn)
    }
  )