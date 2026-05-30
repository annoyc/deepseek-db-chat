import { createServerFn } from '@tanstack/react-start'
import { getConnectionById } from '@/server/store'
import { executeQuery } from '@/server/database'
import type { SqlResultInfo } from '@/lib/types'

interface ConfirmSqlInput {
  connectionId: string
  sql: string
}

export type SqlExecuteResult =
  | { success: true; data: SqlResultInfo }
  | { success: false; error: string }

export const confirmAndExecuteSql = createServerFn({ method: 'POST' }).handler(
  async ({ data }: { data: ConfirmSqlInput }): Promise<SqlExecuteResult> => {
    const connection = getConnectionById(data.connectionId)
    if (!connection) {
      return { success: false, error: '数据库连接不存在' }
    }

    try {
      const result = await executeQuery(connection, data.sql)
      return { success: true, data: result }
    } catch (err) {
      return { success: false, error: `SQL执行失败: ${err instanceof Error ? err.message : String(err)}` }
    }
  }
)
