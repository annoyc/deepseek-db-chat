import { tool } from '@/core'
import { z } from 'zod'
import { listTables, getTableSchema, getDatabaseOverview, explainQuery, getColumnFilterData } from './database'
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
        if (!/^(SELECT|WITH)\b/i.test(sql.trim())) {
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
      intent_summary: z.string().optional().describe('用自然语言描述此SQL将做什么，例如"统计 users 表中 2026-05 新建用户数，按 create_time 过滤"。帮助用户确认SQL意图是否正确'),
      expected_shape: z.string().optional().describe('预期结果形态，如"单值(总数)"、"多行(每日统计)"、"列表(用户明细)"'),
    }),
    execute: async ({ sql, explanation, intent_summary, expected_shape }) => {
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

      // Schema 校验：检查 SQL 引用的表名是否已通过 schema 确认
      if (schemaCache.size > 0) {
        const tablePattern = /(?:FROM|JOIN|INTO|UPDATE)\s+`?(\w+)`?/gi
        let match: RegExpExecArray | null
        const unknownTables: string[] = []
        while ((match = tablePattern.exec(sql)) !== null) {
          const tableName = match[1].toLowerCase()
          if (tableName === 'dual' || tableName === 'select') continue
          const knownLower = [...schemaCache.keys()].map((k) => k.toLowerCase())
          if (!knownLower.includes(tableName)) {
            unknownTables.push(match[1])
          }
        }
        if (unknownTables.length > 0) {
          const warnMsg = JSON.stringify({
            status: 'schema_warning',
            unknown_tables: unknownTables,
            message: `SQL 引用了未经确认的表: ${unknownTables.join(', ')}。请先调用 get_table_schema 确认这些表的结构，再生成 SQL。已知表: ${[...schemaCache.keys()].join(', ')}`,
          })
          pushResult('execute_sql', warnMsg)
          return warnMsg
        }
      }

      // 工具层安全校验：拦截危险 SQL
      const validation = validateSql(sql, sqlPermission)
      if (!validation.allowed) {
        const allowedLabel = sqlPermission === 'write' ? 'SELECT/SHOW/DESCRIBE/EXPLAIN/WITH/DESC/INSERT/UPDATE/DELETE/REPLACE' : 'SELECT/SHOW/DESCRIBE/EXPLAIN/WITH/DESC'
        const errorMsg = `SQL 被安全策略拦截: ${validation.reason}。当前模式仅允许: ${allowedLabel}。`
        pushError('execute_sql', new Error(errorMsg))
        return errorMsg
      }

      const resultPayload: Record<string, unknown> = {
        status: 'pending_confirmation',
        sql,
        explanation,
        message: '已提交给用户确认。请立即停止，不要再调用任何工具。等待下一轮对话获取执行结果。',
      }
      if (intent_summary) resultPayload.intent_summary = intent_summary
      if (expected_shape) resultPayload.expected_shape = expected_shape

      const result = JSON.stringify(resultPayload)
      pushResult('execute_sql', result)
      return result
    },
  })

  const planQueryTool = tool({
    name: 'plan_query',
    description: `面对复杂查询时，必须先调用此工具制定查询计划再执行 SQL。以下任一情况必须先规划：
- 涉及 3 张及以上表的 JOIN
- 需要子查询或 CTE（WITH 子句）
- 需要多步查询（第二条 SQL 依赖第一条的结果）
- 涉及 GROUP BY + HAVING 的复杂聚合
- 涉及时间对比（环比、同比）
- 用户问题本身包含多个子问题
调用此工具会自动获取所有涉及表的完整字段结构（无需再单独调用 get_table_schema）。调用后直接按计划生成 SQL。`,
    schema: z.object({
      question: z.string().describe('用户的原始问题'),
      complexity: z.enum(['moderate', 'complex']).describe('问题复杂度: moderate（2-3步）或 complex（4步以上）'),
      involved_tables: z.array(z.string()).describe('涉及的表名列表'),
      steps: z.array(z.object({
        step: z.number().describe('步骤编号，从 1 开始'),
        description: z.string().describe('该步骤的目标描述'),
        sql_type: z.string().describe('SQL 类型，如 SELECT/JOIN/子查询/聚合/窗口函数'),
        depends_on: z.array(z.number()).optional().describe('依赖的前置步骤编号'),
        expected_columns: z.array(z.string()).optional().describe('预期返回的列名列表'),
        expected_row_type: z.enum(['single_value', 'few_rows', 'aggregated', 'detail_list']).optional().describe('预期结果类型'),
        validation_hint: z.string().optional().describe('中间结果校验提示，如"若返回0行则无需执行后续步骤"'),
      })),
      total_queries: z.number().describe('预计需要执行的 SQL 数量'),
      strategy_note: z.string().optional().describe('整体策略说明或优化思路'),
    }),
    execute: async (plan) => {
      const schemas: Record<string, string> = {}
      const missing: string[] = []
      for (const table of plan.involved_tables) {
        const cached = schemaCache.get(table)
        if (cached) {
          schemas[table] = cached
        } else {
          try {
            const schema = await getTableSchema(connection, table)
            schemaCache.set(table, schema)
            schemas[table] = schema
          } catch {
            missing.push(table)
          }
        }
      }

      const parts: string[] = [
        `查询计划已制定（${plan.steps.length} 个步骤，预计 ${plan.total_queries} 条 SQL）。`,
      ]
      if (missing.length > 0) {
        parts.push(`⚠️ 以下表不存在或无法访问: ${missing.join(', ')}。请修正计划。`)
      }

      // Include step details with validation guidance
      parts.push('\n查询步骤：')
      for (const step of plan.steps) {
        parts.push(`  步骤 ${step.step}: ${step.description} (${step.sql_type})`)
        if (step.expected_columns?.length) {
          parts.push(`    预期返回列: ${step.expected_columns.join(', ')}`)
        }
        if (step.expected_row_type) {
          const rowTypeLabels: Record<string, string> = {
            single_value: '单值结果',
            few_rows: '少量行',
            aggregated: '聚合结果',
            detail_list: '明细列表',
          }
          parts.push(`    预期结果类型: ${rowTypeLabels[step.expected_row_type] ?? step.expected_row_type}`)
        }
        if (step.validation_hint) {
          parts.push(`    ⚠️ 校验: ${step.validation_hint}`)
        }
        if (step.depends_on?.length) {
          parts.push(`    依赖: 步骤 ${step.depends_on.join(', ')}`)
        }
      }

      parts.push('\n以下是涉及表的完整字段信息，请严格基于这些字段生成 SQL：')
      for (const [table, schema] of Object.entries(schemas)) {
        parts.push(`\n--- ${table} ---\n${schema}`)
      }

      parts.push('\n【执行指引】')
      parts.push('- 每步执行后检查结果：若返回 0 行或全 NULL，考虑是否需要调整 WHERE 条件或 JOIN 方式')
      parts.push('- 多步查询中，如果前一步结果不符预期，先修正再继续，不要盲目执行后续步骤')
      parts.push('- SQL 中的表名和字段名必须与上方字段信息完全一致')

      const result = JSON.stringify({
        status: missing.length > 0 ? 'plan_warning' : 'plan_ready',
        message: parts.join('\n'),
      })
      pushResult('plan_query', result)
      return result
    },
  })

  const smartFilterTool = tool({
    name: 'smart_filter',
    description: `当用户查询存在需要确认或可调整的参数时，必须调用此工具以交互控件形式让用户选择，禁止以文本提问代替。支持四种筛选类型：
- date_range: 时间范围筛选（如"最近"、"上个月"），系统自动查询日期边界
- enum_select: 基于数据库列值的枚举筛选（如"按状态筛选"），系统自动查询去重值
- option_select: 自定义选项（如"查询哪张表"、"使用哪种统计口径"），由你直接提供选项列表
- aggregation: 聚合粒度选择（如"按日/周/月统计"）
调用后必须立即停止回复，等待用户确认后继续。`,
    schema: z.object({
      filters: z.array(z.object({
        type: z.enum(['date_range', 'enum_select', 'option_select', 'aggregation']).describe('筛选维度类型'),
        table: z.string().describe('涉及的表名（option_select 可填空字符串）'),
        column: z.string().describe('涉及的列名（option_select 可填空字符串）'),
        label: z.string().describe('中文显示标签，如"查询范围"、"订单日期"、"订单状态"'),
        options: z.array(z.string()).optional().describe('option_select 的选项列表，如["esmp_user (小程序用户)", "sys_user (系统用户)", "全部"]'),
        defaultRange: z.string().optional().describe('日期范围推荐: 7d/30d/90d/1y'),
        aggregationOptions: z.array(z.string()).optional().describe('聚合选项，如["按日","按周","按月"]'),
        defaultValue: z.string().optional().describe('推荐的初始值'),
      })),
    }),
    execute: async ({ filters }) => {
      const enrichedFilters = await Promise.all(
        filters.map(async (f) => {
          if (f.type === 'option_select') {
            return { ...f, dataType: '', options: f.options ?? [] }
          }
          try {
            const data = await getColumnFilterData(connection, f.table, f.column)
            return {
              ...f,
              dataType: '',
              enumValues: data.distinctValues ?? [],
              dateMin: data.dateMin,
              dateMax: data.dateMax,
              rowCount: data.rowCount,
            }
          } catch {
            return { ...f, dataType: '' }
          }
        }),
      )

      const result = JSON.stringify({
        status: 'pending',
        filters: enrichedFilters,
        message: '已将筛选建议提交给用户确认。请立即停止回复，等待用户确认筛选参数后继续。',
      })
      pushResult('smart_filter', result)
      return result
    },
  })

  return { tools: [getDatabaseOverviewTool, listTablesTool, getTableSchemaTool, planQueryTool, explainSqlTool, executeSqlTool, smartFilterTool], resultStore }
}
