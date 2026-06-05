import { tool } from '@/core'
import { z } from 'zod'
import { listTables, getTableSchema } from './database'
import { validateSql } from '@/lib/sql-guard'
import type { DatabaseConnection } from '@/lib/types'

export const TOOL_ERROR_PREFIX = '__TOOL_ERROR__:'

export type ResultStore = Map<string, string[]>

export function createDbTools(connection: DatabaseConnection, sqlPermission: 'readonly' | 'write' = 'readonly') {
  const resultStore: ResultStore = new Map()

  function pushResult(name: string, result: string) {
    const queue = resultStore.get(name) ?? []
    queue.push(result)
    resultStore.set(name, queue)
  }

  function pushError(name: string, error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    pushResult(name, TOOL_ERROR_PREFIX + msg)
  }

  const listTablesTool = tool({
    name: 'list_tables',
    description: '列出当前数据库中的所有表名。当用户询问数据库有哪些表、或需要了解数据库结构时使用。',
    schema: z.object({}),
    execute: async () => {
      try {
        const tables = await listTables(connection)
        const result = tables.join('\n')
        pushResult('list_tables', result)
        return result
      } catch (err) {
        pushError('list_tables', err)
        const msg = err instanceof Error ? err.message : String(err)
        return `查询失败: ${msg}`
      }
    },
  })

  const getTableSchemaTool = tool({
    name: 'get_table_schema',
    description: '获取指定表的详细结构信息，包括字段名、类型、索引、注释等。当需要了解表的具体字段以便编写SQL时使用。',
    schema: z.object({
      table_name: z.string().describe('要查询结构的表名'),
    }),
    execute: async ({ table_name }: { table_name: string }) => {
      try {
        const result = await getTableSchema(connection, table_name)
        pushResult('get_table_schema', result)
        return result
      } catch (err) {
        pushError('get_table_schema', err)
        const msg = err instanceof Error ? err.message : String(err)
        return `查询失败: ${msg}`
      }
    },
  })

  const executeSqlTool = tool({
    name: 'execute_sql',
    description: '提交SQL等待用户确认执行。注意：你自身没有执行SQL的能力，调用此工具后SQL会展示给用户确认，用户确认后才会真正执行并返回结果。调用此工具后你必须立即停止回复，禁止继续生成任何文本，绝对禁止编造执行结果（如"执行成功"、"影响了N行"、具体返回数据等）。',
    schema: z.object({
      sql: z.string().describe('要执行的SQL语句'),
      explanation: z.string().describe('对该SQL的简要说明，解释查询的目的和逻辑'),
    }),
    execute: async ({ sql, explanation }) => {
      // 工具层安全校验：拦截危险 SQL
      const validation = validateSql(sql, sqlPermission)
      if (!validation.allowed) {
        const allowedLabel = sqlPermission === 'write' ? 'SELECT/SHOW/DESCRIBE/EXPLAIN/WITH/DESC/INSERT/UPDATE/DELETE/REPLACE' : 'SELECT/SHOW/DESCRIBE/EXPLAIN/WITH/DESC'
        const errorMsg = `SQL 被安全策略拦截: ${validation.reason}。当前模式仅允许: ${allowedLabel}。`
        pushError('execute_sql', new Error(errorMsg))
        return errorMsg
      }

      const result = JSON.stringify({
        status: 'pending_confirmation',
        sql,
        explanation,
        message: '已提交给用户确认。请立即停止，不要再调用任何工具。等待下一轮对话获取执行结果。',
      })
      pushResult('execute_sql', result)
      return result
    },
  })

  return { tools: [listTablesTool, getTableSchemaTool, executeSqlTool], resultStore }
}
