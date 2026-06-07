import { tool } from '@/core'
import { z } from 'zod'
import { listTables, getTableSchema, getDatabaseOverview, explainQuery } from './database'
import { validateSql } from '@/lib/sql-guard'
import { SESSION_MAX_SQL_EXECUTIONS } from '@/core/constants'
import type { DatabaseConnection } from '@/lib/types'

export const TOOL_ERROR_PREFIX = '__TOOL_ERROR__:'

export type ResultStore = Map<string, string[]>

export function createDbTools(
  connection: DatabaseConnection,
  sqlPermission: 'readonly' | 'write' = 'readonly',
  lastConfirmedSql?: string,
  sqlExecutedCount: number = 0,
  maxSqlExecutions: number = SESSION_MAX_SQL_EXECUTIONS,
) {
  const resultStore: ResultStore = new Map()
  const schemaCache = new Map<string, string>()
  const submittedSqlSet = new Set<string>()

  function pushResult(name: string, result: string) {
    const queue = resultStore.get(name) ?? []
    queue.push(result)
    resultStore.set(name, queue)
  }

  function pushError(name: string, error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    pushResult(name, TOOL_ERROR_PREFIX + msg)
  }

  let tablesCache: string | null = null
  let overviewCache: string | null = null

  const getDatabaseOverviewTool = tool({
    name: 'get_database_overview',
    description: '获取当前数据库的全局概览，包括所有表名、近似行数、表注释、以及表之间的外键关系。建议在对话开始时首先调用此工具，快速了解数据库整体结构，然后再针对具体表调用 get_table_schema 获取详细字段信息。',
    schema: z.object({}),
    execute: async () => {
      try {
        if (overviewCache !== null) {
          pushResult('get_database_overview', overviewCache)
          return overviewCache
        }
        const result = await getDatabaseOverview(connection)
        console.log('get_database_overview', result)
        overviewCache = result
        pushResult('get_database_overview', result)
        return result
      } catch (err) {
        pushError('get_database_overview', err)
        const msg = err instanceof Error ? err.message : String(err)
        return `查询失败: ${msg}`
      }
    },
  })

  const listTablesTool = tool({
    name: 'list_tables',
    description: '列出当前数据库中的所有表名。当用户询问数据库有哪些表、或需要了解数据库结构时使用。',
    schema: z.object({}),
    execute: async () => {
      try {
        if (tablesCache !== null) {
          pushResult('list_tables', tablesCache)
          return tablesCache
        }
        const tables = await listTables(connection)
        const result = tables.join('\n')
        tablesCache = result
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
    description: '获取指定表的详细结构信息，包括字段名、类型、索引、外键关系、注释等。当需要了解表的具体字段以便编写SQL时使用。',
    schema: z.object({
      table_name: z.string().describe('要查询结构的表名'),
    }),
    execute: async ({ table_name }: { table_name: string }) => {
      try {
        // Return cached schema if already queried in this agent run
        const cached = schemaCache.get(table_name)
        if (cached) {
          pushResult('get_table_schema', cached)
          return cached
        }

        const result = await getTableSchema(connection, table_name)
        schemaCache.set(table_name, result)
        pushResult('get_table_schema', result)
        return result
      } catch (err) {
        pushError('get_table_schema', err)
        const msg = err instanceof Error ? err.message : String(err)
        return `查询失败: ${msg}`
      }
    },
  })

  const explainSqlTool = tool({
    name: 'explain_sql',
    description: '对一条 SELECT 语句执行 EXPLAIN 分析，返回执行计划。用于评估查询性能（是否全表扫描、是否使用了索引等）。在提交复杂查询前可先调用此工具评估性能。',
    schema: z.object({
      sql: z.string().describe('要分析的 SELECT SQL 语句'),
    }),
    execute: async ({ sql }: { sql: string }) => {
      try {
        // Basic validation: only SELECT statements
        if (!/^\s*(SELECT|WITH)\b/i.test(sql.trim())) {
          return 'EXPLAIN 仅支持 SELECT 语句。'
        }
        const result = await explainQuery(connection, sql)
        pushResult('explain_sql', result)
        return result
      } catch (err) {
        pushError('explain_sql', err)
        const msg = err instanceof Error ? err.message : String(err)
        return `EXPLAIN 失败: ${msg}`
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
      // Session-level execution limit check
      if (sqlExecutedCount >= maxSqlExecutions) {
        const limitMsg = JSON.stringify({
          status: 'limit_reached',
          message: `本会话已执行 ${maxSqlExecutions} 条 SQL，达到上限。请基于已有的查询结果给出最终回复，不再生成新的 SQL。`,
        })
        pushResult('execute_sql', limitMsg)
        return limitMsg
      }

      // Dedup: block duplicate SQL within the same agent run
      const normalizedSql = sql.trim().replace(/\s+/g, ' ')
      if (submittedSqlSet.has(normalizedSql)) {
        const dupMsg = JSON.stringify({
          status: 'duplicate_blocked',
          message: '此 SQL 与本轮已提交的 SQL 完全相同，已被阻止重复提交。请直接基于已有结果给出最终回复，不要再重复生成相同的 SQL。',
        })
        pushResult('execute_sql', dupMsg)
        return dupMsg
      }

      // Dedup: block SQL identical to last user-confirmed SQL (cross-round)
      if (lastConfirmedSql && normalizedSql === lastConfirmedSql.trim().replace(/\s+/g, ' ')) {
        const dupMsg = JSON.stringify({
          status: 'duplicate_blocked',
          message: '此 SQL 与上一轮用户已确认执行的 SQL 完全相同，已被阻止。你已经拿到了执行结果，请直接分析结果并给出最终回复，不要再重复提交相同的 SQL。',
        })
        pushResult('execute_sql', dupMsg)
        return dupMsg
      }

      submittedSqlSet.add(normalizedSql)

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

  return { tools: [getDatabaseOverviewTool, listTablesTool, getTableSchemaTool, explainSqlTool, executeSqlTool], resultStore }
}
