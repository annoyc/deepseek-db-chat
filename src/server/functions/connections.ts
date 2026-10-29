import { createServerFn } from '@tanstack/react-start'
import { testConnection, closePool } from '@/server/database'
import { resolveDatabaseConnection } from '@/server/resolve-connection'
import { getPublicDemoConnection } from '@/server/demo-database'
import { isDemoConnectionId } from '@/lib/demo-connection'
import type { DatabaseConnection } from '@/lib/types'

export const testConnectionFn = createServerFn({ method: 'POST' })
  .inputValidator((data: DatabaseConnection) => data)
  .handler(
    async ({ data }): Promise<{ success: boolean; error?: string }> => {
      try {
        return await testConnection(resolveDatabaseConnection(data))
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : '数据库连接参数无效' }
      }
    }
  )

export const closePoolFn = createServerFn({ method: 'POST' })
  .inputValidator((data: { connectionId: string }) => data)
  .handler(async ({ data }) => {
    if (isDemoConnectionId(data.connectionId)) return
    await closePool(data.connectionId)
  })

export const getDemoConnectionFn = createServerFn({ method: 'GET' })
  .handler((): Omit<DatabaseConnection, 'password'> | null => getPublicDemoConnection())
