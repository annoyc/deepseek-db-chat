import { createServerFn } from '@tanstack/react-start'
import { executeQuery } from '@/server/database'
import { decrypt } from '@/server/crypto'
import type { DatabaseConnection, SqlResultInfo } from '@/lib/types'

interface ConfirmSqlInput {
  connection: DatabaseConnection
  sql: string
}

export type SqlExecuteResult =
  | { success: true; data: SqlResultInfo }
  | { success: false; error: string }

const ALLOWED_SQL_KEYWORDS = new Set([
  'SELECT',
  'SHOW',
  'DESCRIBE',
  'EXPLAIN',
  'WITH',
  'DESC',
])

function isAllowedSql(sql: string): boolean {
  const trimmed = sql.trimStart()
  const firstWord = /^[A-Za-z_]+/.exec(trimmed)
  if (!firstWord) return false
  return ALLOWED_SQL_KEYWORDS.has(firstWord[0].toUpperCase())
}

export const confirmAndExecuteSql = createServerFn({ method: 'POST', strict: false })
  .inputValidator((data: ConfirmSqlInput) => data)
  .handler(
    async ({ data }): Promise<SqlExecuteResult> => {
      if (!isAllowedSql(data.sql)) {
        return {
          success: false,
          error: '仅允许执行查询类 SQL 语句（SELECT/SHOW/DESCRIBE/EXPLAIN），不允许修改数据或结构',
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