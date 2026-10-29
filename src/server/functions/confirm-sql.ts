import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { executeQuery } from '@/server/database'
import { resolveDatabaseConnection } from '@/server/resolve-connection'
import { validateSql } from '@/lib/sql-guard'
import { resolveSqlPermission } from '@/server/sql-policy'
import { isDemoConnectionId } from '@/lib/demo-connection'
import { z } from 'zod'
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
  .inputValidator((data: ConfirmSqlInput) => z.object({
    connection: z.object({
      id: z.string().min(1).max(200), name: z.string().max(200),
      host: z.string().max(255), port: z.number().int().min(0).max(65535),
      user: z.string().max(200), password: z.string().max(16_384),
      database: z.string().min(1).max(200),
      ssl: z.object({ ca: z.string().max(65_536).optional() }).optional(),
      env: z.enum(['dev', 'test', 'staging', 'prod']).default('prod'),
      createdAt: z.string(),
    }).superRefine((connection, context) => {
      // The public demo sends only a display stub. Its real target and
      // credentials are resolved from the reserved ID on the server.
      if (!isDemoConnectionId(connection.id) && (!connection.host.trim() || connection.port === 0)) {
        context.addIssue({ code: 'custom', message: '数据库主机和端口无效' })
      }
    }),
    sql: z.string().min(1).max(200_000),
    sqlPermission: z.enum(['readonly', 'write']).optional(),
  }).parse(data))
  .handler(
    async ({ data }): Promise<SqlExecuteResult> => {
      try {
        const decryptedConnection = resolveDatabaseConnection(data.connection)
        const permission = resolveSqlPermission(decryptedConnection, data.sqlPermission)
        const validation = validateSql(data.sql, permission)
        if (!validation.allowed) {
          return {
            success: false,
            error: validation.reason || 'SQL 校验失败',
          }
        }
        const result = await executeQuery(decryptedConnection, data.sql, permission, getRequest().signal)
        return { success: true, data: result }
      } catch (err) {
        console.error('[confirm-sql] Execute error:', err)
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )
