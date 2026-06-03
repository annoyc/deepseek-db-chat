import { createServerFn } from '@tanstack/react-start'
import { executeQuery } from '@/server/database'
import { decrypt } from '@/server/crypto'
import { validateSql } from '@/lib/sql-guard'
import type { DatabaseConnection, SqlResultInfo } from '@/lib/types'

interface ConfirmSqlInput {
  connection: DatabaseConnection
  sql: string
  sqlPermission?: 'readonly' | 'write'
}

export type SqlExecuteResult =
  | { success: true; data: SqlResultInfo }
  | { success: false; error: string }

export const confirmAndExecuteSql = createServerFn({ method: 'POST', strict: false })
  .inputValidator((data: ConfirmSqlInput) => data)
  .handler(
    async ({ data }): Promise<SqlExecuteResult> => {
      const validation = validateSql(data.sql, data.sqlPermission)
      if (!validation.allowed) {
        return {
          success: false,
          error: validation.reason || 'SQL 校验失败',
        }
      }

      try {
        const decryptedConnection: DatabaseConnection = {
          ...data.connection,
          password: decrypt(data.connection.password),
        }
        const result = await executeQuery(decryptedConnection, data.sql)
        return { success: true, data: result }
      } catch (err) {
        console.error('[confirm-sql] Execute error:', err)
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )