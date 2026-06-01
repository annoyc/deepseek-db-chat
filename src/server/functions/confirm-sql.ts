import { createServerFn } from '@tanstack/react-start'
import { executeQuery } from '@/server/database'
import type { DatabaseConnection, SqlResultInfo } from '@/lib/types'

interface ConfirmSqlInput {
  connection: DatabaseConnection
  sql: string
}

export type SqlExecuteResult =
  | { success: true; data: SqlResultInfo }
  | { success: false; error: string }

export const confirmAndExecuteSql = createServerFn({ method: 'POST', strict: false })
  .inputValidator((data: ConfirmSqlInput) => data)
  .handler(
    async ({ data }): Promise<SqlExecuteResult> => {
      try {
        const result = await executeQuery(data.connection, data.sql)
        return { success: true, data: result }
      } catch (err) {
        return { success: false, error: `SQL执行失败: ${err instanceof Error ? err.message : String(err)}` }
      }
    }
  )