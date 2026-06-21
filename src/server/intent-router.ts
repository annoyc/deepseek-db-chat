/**
 * Intent Router — Deterministic pre-classification of user queries.
 *
 * Before the agent loop starts, we classify the user's intent to:
 * 1. Inject routing hints into the system prompt (reducing model decision burden)
 * 2. Skip unnecessary steps (e.g., no need for overview on schema-only queries)
 * 3. Pre-select the right workflow path (simple/complex/explore/ambiguous)
 *
 * This is NOT a separate LLM call — it uses keyword/pattern heuristics for
 * zero-latency classification. The model still makes final decisions, but the
 * routing hint biases it toward the correct path.
 */

export type QueryIntent =
  | 'explore_schema'    // "有哪些表" / "xx表结构" → skip smart_filter, just show schema
  | 'simple_query'      // Single-table aggregation, direct lookup
  | 'complex_query'     // Multi-table JOIN, subquery, time comparison
  | 'write_operation'   // INSERT / UPDATE / DELETE intent
  | 'ambiguous'         // Needs clarification via smart_filter
  | 'analysis'          // Follow-up analysis on existing results

export interface IntentClassification {
  intent: QueryIntent
  confidence: number
  routingHint: string
  suggestedTables?: string[]
  skipOverview?: boolean
}

const SCHEMA_PATTERNS = [
  /有(哪些|什么)(表|数据表)/,
  /表(结构|字段|有哪些列)/,
  /(列举|列出|展示|看看).*(表|数据库)/,
  /^(show|describe|desc)\s/i,
  /结构是什么/,
  /数据库(概览|结构|全局)/,
]

const WRITE_PATTERNS = [
  /(新增|添加|插入|创建一条|创建新|新建|INSERT)/i,
  /(更新|修改|UPDATE|改为|设为)/i,
  /(删除|移除|DELETE|去掉)/i,
  /把.*改/,
  /设置.*为/,
]

const COMPLEX_SIGNALS = [
  /环比|同比|对比|变化率|增长率/,
  /(?:按|分|每)\s*(?:日|周|月|季|年)\s*统计/,
  /top\s*\d+|前\d+|排名/i,
  /趋势|走势|分布/,
  /(?:和|与|跟).*(?:对比|比较)/,
  /占比|百分比|比例/,
  /关联|连表|join/i,
  /子查询|嵌套/,
]

const AMBIGUOUS_SIGNALS = [
  /最近|近期|这段时间|上个?月|本月|今天/,
  /按.*(?:分|统计|汇总)/, // "按什么维度" is ambiguous unless specified
  /哪个|哪种|哪些(?!表)/,  // "哪个类型" needs clarification
]

const ANALYSIS_PATTERNS = [
  /^(分析|解读|说明|总结)/,
  /什么原因|为什么.*(?:高|低|多|少)/,
  /有什么(发现|规律|异常)/,
]

/**
 * Extract likely table names from a user query by matching against known patterns:
 * - Quoted names: "users表", `orders`
 * - Chinese table references: "用户表", "订单"
 */
function extractMentionedTables(query: string): string[] {
  const tables: string[] = []
  const patterns = [
    /[`"'](\w+)[`"']\s*表?/g,
    /(\w+)\s*表/g,
  ]
  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(query)) !== null) {
      if (match[1].length > 1 && !/^(哪|什|这|那|某)/.test(match[1])) {
        tables.push(match[1])
      }
    }
  }
  return [...new Set(tables)]
}

export function classifyIntent(
  userQuery: string,
  hasExecutionHistory: boolean,
): IntentClassification {
  const q = userQuery.trim()

  // 1. Schema exploration (highest confidence)
  for (const p of SCHEMA_PATTERNS) {
    if (p.test(q)) {
      return {
        intent: 'explore_schema',
        confidence: 0.95,
        routingHint: '用户想了解数据库结构。调用 get_database_overview 或 get_table_schema 即可，无需生成 SQL。',
        skipOverview: false,
      }
    }
  }

  // 2. Write operations
  for (const p of WRITE_PATTERNS) {
    if (p.test(q)) {
      return {
        intent: 'write_operation',
        confidence: 0.85,
        routingHint: '用户要执行写操作。先确认目标表结构，再生成 INSERT/UPDATE/DELETE 语句。',
        suggestedTables: extractMentionedTables(q),
      }
    }
  }

  // 3. Analysis of existing results (follows a completed query)
  if (hasExecutionHistory) {
    for (const p of ANALYSIS_PATTERNS) {
      if (p.test(q)) {
        return {
          intent: 'analysis',
          confidence: 0.8,
          routingHint: '用户想进一步分析已有结果。优先使用执行记录中的数据回答，避免不必要的新查询。',
          skipOverview: true,
        }
      }
    }
  }

  // 4. Complex query signals
  let complexScore = 0
  for (const p of COMPLEX_SIGNALS) {
    if (p.test(q)) complexScore++
  }
  if (complexScore >= 2) {
    return {
      intent: 'complex_query',
      confidence: 0.75,
      routingHint: '这是一个复杂查询，建议使用 plan_query 进行规划后再生成 SQL。',
      suggestedTables: extractMentionedTables(q),
    }
  }

  // 5. Ambiguous signals — needs smart_filter
  let ambiguousScore = 0
  for (const p of AMBIGUOUS_SIGNALS) {
    if (p.test(q)) ambiguousScore++
  }
  if (ambiguousScore >= 2 && complexScore === 0) {
    return {
      intent: 'ambiguous',
      confidence: 0.65,
      routingHint: '查询参数存在模糊性，建议在生成 SQL 前先调用 smart_filter 让用户确认参数。',
      suggestedTables: extractMentionedTables(q),
    }
  }

  // 6. Default: simple query
  return {
    intent: 'simple_query',
    confidence: 0.6,
    routingHint: '这是一个相对简单的查询。获取表结构后直接生成 SQL 即可。',
    suggestedTables: extractMentionedTables(q),
  }
}

/**
 * Generate a system prompt fragment based on intent classification.
 * This is injected at the end of the system prompt to guide the model.
 */
export function buildRoutingPrompt(classification: IntentClassification): string {
  const lines: string[] = [
    `\n【路由提示 — 基于用户意图预分析】`,
    `意图类型: ${intentLabel(classification.intent)}`,
    `建议: ${classification.routingHint}`,
  ]

  if (classification.suggestedTables && classification.suggestedTables.length > 0) {
    lines.push(`可能涉及的表: ${classification.suggestedTables.join(', ')}（需要通过 get_table_schema 确认）`)
  }

  if (classification.skipOverview) {
    lines.push('提示: 已有足够上下文，可跳过 get_database_overview 直接处理。')
  }

  return lines.join('\n')
}

function intentLabel(intent: QueryIntent): string {
  const labels: Record<QueryIntent, string> = {
    explore_schema: '结构探索',
    simple_query: '简单查询',
    complex_query: '复杂查询（建议先规划）',
    write_operation: '写操作',
    ambiguous: '参数模糊（建议用 smart_filter 确认）',
    analysis: '数据分析（基于已有结果）',
  }
  return labels[intent]
}
