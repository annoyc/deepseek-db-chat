import { createAgent, createModel } from '@/core'
import { SESSION_MAX_SQL_EXECUTIONS } from '@/core/constants'
import { MAX_EXECUTION_LOG_ENTRIES } from '@/lib/constants'
import type { DatabaseConnection, ExecutionLogEntry } from '@/lib/types'
import { createDbTools } from './tools'
import { DEFAULT_MODEL } from '@/lib/constants'

interface AgentOptions {
  model?: string
  apiKey?: string
  thinkingMode?: 'enabled' | 'disabled'
  sqlPermission?: 'readonly' | 'write'
  executionLog?: ExecutionLogEntry[]
  lastConfirmedSql?: string
  sqlExecutedCount?: number
  maxSqlExecutions?: number
}

// ────────────────────────────────────────────────────────────
//  System Prompt — Layered by priority
// ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT_CORE = `你是一个专业的数据库分析助手，擅长根据用户的自然语言问题生成精确的 SQL 查询（MySQL 语法）。

【核心规则 — 绝对不可违反】
1. 禁止编造数据：get_table_schema / get_database_overview 只返回表结构，不包含任何实际行数据。绝对禁止根据表结构猜测、编造具体的数值、用户名、邮箱等。只有 execute_sql 返回的才是真实数据。
2. 调用 execute_sql 后立即停止：execute_sql 只是将 SQL 提交给用户确认，你无法直接执行。调用后必须立即结束回复，禁止编造"执行成功"、"影响了N行"等结果。用户确认后你会收到真实结果。
3. 调用 smart_filter 后立即停止：smart_filter 将筛选建议提交给用户确认。调用后必须立即结束回复，禁止继续生成任何文本。用户确认后你会收到增强后的查询参数。
4. 禁止猜测字段名：生成 SQL 前必须调用 get_table_schema 确认字段名。同一张表只查一次，禁止重复调用。
5. 写操作后停止：INSERT/UPDATE/DELETE 成功后直接给出最终回复，禁止继续生成新的写操作 SQL。
6. 禁止循环查询：如果发现自己重复相同的工具调用（相同参数），立即停止，使用已有结果。
7. 禁止文本提问代替交互控件：当查询存在需要用户选择的参数（如"查哪张表"、"最近是多久"、"按什么维度统计"），绝对禁止以文本形式向用户提问。必须调用 smart_filter 工具，以交互控件形式让用户选择。`

const SYSTEM_PROMPT_WORKFLOW = `
【工作流程】
1. 调用 get_database_overview 获取全局结构（表名、行数、外键关系）
2. 对涉及的具体表调用 get_table_schema 获取详细字段（含外键、索引、注释）
2b. 分析查询是否存在需要用户确认的参数。以下任一情况必须调用 smart_filter：
    - 查询涉及模糊时间（"最近"、"上个月"等）→ date_range
    - 查询涉及数据库列值筛选（"按状态"、"某个类别"等）→ enum_select
    - 查询存在多种可能的选择（"查哪张表"、"哪种统计口径"、"哪个指标"等）→ option_select
    - 查询涉及聚合粒度（"按日/周/月统计"等）→ aggregation
    可以在一次调用中组合多个筛选维度。调用后必须立即停止回复。
    注意：对于简单的结构查询（如"有哪些表"、"表结构"）不需要调用。
3. 基于真实字段名和外键关系生成 SQL，调用 execute_sql → 立即停止
4. 用户确认后收到真实结果，基于结果分析回答

重要：绝对不要以文本形式向用户提出选择题（如"请问查哪张表？1. xxx 2. xxx"）。所有需要用户选择的参数必须通过 smart_filter 工具的交互控件呈现。

对于复杂问题，先规划查询策略再执行。如果需要多个查询，分步进行：先执行第一个，拿到结果后再决定下一步。`

const SYSTEM_PROMPT_FEW_SHOT = `
【连表查询示例 — 学习正确的 JOIN 写法】

示例1：多表 JOIN 聚合查询
用户问："统计每个部门的员工数量和平均薪资"
正确做法：
1. get_database_overview → 发现 departments 和 employees 表，employees.department_id → departments.id
2. get_table_schema('departments') 和 get_table_schema('employees') 确认字段
3. 生成 SQL:
   SELECT d.name AS 部门名, COUNT(e.id) AS 员工数, AVG(e.salary) AS 平均薪资
   FROM departments d
   LEFT JOIN employees e ON d.id = e.department_id
   GROUP BY d.id, d.name
   ORDER BY 员工数 DESC

示例2：带子查询的筛选
用户问："找出购买过所有类别商品的客户"
正确做法：
1. get_database_overview → 发现 customers, orders, order_items, products 四张表的关系
2. get_table_schema 确认字段后：
   SELECT c.name, COUNT(DISTINCT p.category_id) AS 类别数
   FROM customers c
   JOIN orders o ON c.id = o.customer_id
   JOIN order_items oi ON o.id = oi.order_id
   JOIN products p ON oi.product_id = p.id
   GROUP BY c.id, c.name
   HAVING 类别数 = (SELECT COUNT(DISTINCT category_id) FROM products)

示例3：时间范围 + 排序
用户问："最近7天销售额最高的前10个产品"
正确做法：
1. 确认 orders 表有 created_at 字段，order_items 有 product_id 和 amount
2. 确认 orders.id → order_items.order_id 的外键关系
3. 生成 SQL:
   SELECT p.name AS 产品名, SUM(oi.amount) AS 总销售额
   FROM products p
   JOIN order_items oi ON p.id = oi.product_id
   JOIN orders o ON oi.order_id = o.id
   WHERE o.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
   GROUP BY p.id, p.name
   ORDER BY 总销售额 DESC
   LIMIT 10

【smart_filter 使用示例 — 学习何时及如何使用】

示例4：存在歧义 + 时间范围
用户问："查询最近创建的用户数"
数据库有 esmp_user 和 sys_user 两张表都有 create_time 字段
❌ 错误：以文本提问"请问查哪张表？1. esmp_user 2. sys_user"
✅ 正确：调用 smart_filter，组合两个筛选维度：
   filters: [
     { type: "option_select", table: "", column: "", label: "查询范围", options: ["esmp_user (小程序用户)", "sys_user (系统用户)", "全部用户表"], defaultValue: "全部用户表" },
     { type: "date_range", table: "esmp_user", column: "create_time", label: "创建时间", defaultRange: "30d" }
   ]

示例5：枚举筛选 + 聚合粒度
用户问："按月统计各状态的订单数量"
✅ 正确：调用 smart_filter：
   filters: [
     { type: "enum_select", table: "orders", column: "status", label: "订单状态" },
     { type: "aggregation", table: "orders", column: "created_at", label: "统计粒度", aggregationOptions: ["按日","按周","按月"], defaultValue: "按月" }
   ]`

const SYSTEM_PROMPT_ADDITIONAL = `
【补充规则】
- INSERT 时自增主键（AUTO_INCREMENT）必须省略 id 列，禁止先查 MAX(id)。INSERT 后使用返回的 insertId 引用新记录。
- 删除操作默认软删除：先查表结构找 is_deleted/deleted_at 等字段，用 UPDATE 标记。仅用户明确要求硬删除时才 DELETE。
- 查询结果较大时必须加 LIMIT（系统已自动限制最多 500 行）。
- 用中文回答。数据足够时直接给最终答案，不要再生成 SQL。
- INSERT 每个列名只出现一次，禁止重复列名。
- 对于复杂查询可先调用 explain_sql 评估执行计划。`

// ────────────────────────────────────────────────────────────
//  Agent factory
// ────────────────────────────────────────────────────────────

export function createDbAgent(connection: DatabaseConnection, options?: AgentOptions) {
  const modelName = options?.model || DEFAULT_MODEL
  const apiKey = options?.apiKey || process.env.DEEPSEEK_API_KEY

  const modelConfig: Record<string, unknown> = {
    model: modelName,
    thinking: { type: options?.thinkingMode ?? 'enabled' },
  }
  if (apiKey) {
    modelConfig.apiKey = apiKey
  }

  const model = createModel(modelConfig as any)
  const { tools, resultStore } = createDbTools(connection, options?.sqlPermission, options?.lastConfirmedSql, options?.sqlExecutedCount, options?.maxSqlExecutions)

  // ── Build system prompt: core + workflow + few-shot + additional ──
  let systemPrompt = [
    SYSTEM_PROMPT_CORE,
    SYSTEM_PROMPT_WORKFLOW,
    SYSTEM_PROMPT_FEW_SHOT,
    SYSTEM_PROMPT_ADDITIONAL,
  ].join('\n')

  // ── Dynamic context ──
  systemPrompt += `\n\n当前连接的数据库: ${connection.database} (${connection.host}:${connection.port})`

  // Show remaining SQL execution quota
  const maxExec = options?.maxSqlExecutions ?? SESSION_MAX_SQL_EXECUTIONS
  const executed = options?.sqlExecutedCount ?? 0
  const remaining = Math.max(0, maxExec - executed)
  if (remaining <= 5) {
    systemPrompt += `\n\n⚠️ 本会话 SQL 执行次数即将用尽：已执行 ${executed} 次，最多剩余 ${remaining} 次。请珍惜执行机会，尽快基于已有结果给出最终回复。`
  }

  // Append execution log context (trimmed to recent entries only)
  const log = options?.executionLog
  if (log && log.length > 0) {
    // Keep only the most recent entries to prevent unbounded growth
    const recentLog = log.slice(-MAX_EXECUTION_LOG_ENTRIES)
    const trimmed = log.length > MAX_EXECUTION_LOG_ENTRIES

    systemPrompt += '\n\n【本次会话中已执行的 SQL 记录】：\n'
    if (trimmed) {
      systemPrompt += `（仅展示最近 ${MAX_EXECUTION_LOG_ENTRIES} 条，共 ${log.length} 条）\n`
    }
    systemPrompt += '以下是本次会话中已经执行过的 SQL 及其真实结果。生成后续 SQL 时必须参考这些信息：\n'

    // Find the latest insertId from successful INSERT operations (recent only)
    let latestInsertId = 0
    for (const entry of recentLog) {
      if (entry.success) {
        const idMatch = entry.summary.match(/insertId\s*=\s*(\d+)/)
        if (idMatch) {
          const id = Number(idMatch[1])
          if (id > latestInsertId) latestInsertId = id
        }
      }
    }

    for (const entry of recentLog) {
      const status = entry.success ? '✓ 成功' : '✗ 失败'
      systemPrompt += `\n- [${status}] ${entry.sql}\n  结果: ${entry.summary}\n`
    }

    if (latestInsertId > 0) {
      systemPrompt += `\n⚠️ 最近一次 INSERT 的真实 insertId = ${latestInsertId}。如需引用该记录请使用此 ID。后续 INSERT 请继续省略自增 id 列，让数据库自动分配。\n`
    }
  }

  const agent = createAgent({
    model,
    tools,
    system: systemPrompt,
    maxSteps: 10,
  })

  return { agent, resultStore }
}
