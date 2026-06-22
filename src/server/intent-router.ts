/**
 * Intent Router — LLM-based intent classification of user queries.
 *
 * Before the agent loop starts, we classify the user's intent to:
 * 1. Inject routing hints into the system prompt (reducing model decision burden)
 * 2. Skip unnecessary steps (e.g., no need for overview on schema-only queries)
 * 3. Pre-select the right workflow path (simple/complex/explore/ambiguous)
 *
 * This uses a single lightweight LLM call (thinking disabled, maxSteps 1,
 * temperature 0, structured zod output) for semantic understanding that
 * keyword regex cannot reliably provide. The agent model still makes final
 * tool decisions — this only biases the system prompt and prompt section
 * selection. When confidence is low (< 0.7), we fall back to "ambiguous" so
 * the agent uses smart_filter to confirm parameters with the user.
 */

import { z } from 'zod'
import { createModel, generateText, getProvider } from '@/core'
import type { DeepSeekModel } from '@/core'
import type { ModelProvider } from '@/core/model/types'

export type QueryIntent =
  | 'explore_schema'    // "有哪些表" / "xx表结构" → just show schema
  | 'simple_query'      // Single-table aggregation, direct lookup
  | 'complex_query'     // Multi-table JOIN, subquery, time comparison
  | 'write_operation'   // INSERT / UPDATE / DELETE intent
  | 'ambiguous'         // Needs clarification via smart_filter
  | 'analysis'          // Follow-up analysis on existing results

export interface IntentClassification {
  intent: QueryIntent
  confidence: number
  reasoning: string
  routingHint: string
  suggestedTables?: string[]
  skipOverview?: boolean
}

/** Structured output schema the classifier LLM must return. */
const IntentSchema = z.object({
  intent: z.enum([
    'explore_schema',
    'simple_query',
    'complex_query',
    'write_operation',
    'ambiguous',
    'analysis',
  ]),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  suggestedTables: z.array(z.string()).optional().default([]),
})

const CONFIDENCE_THRESHOLD = 0.7

const INTENT_CLASSIFIER_PROMPT = `你是一个数据库助手的意图分类器。根据用户的自然语言问题，判断其意图属于以下哪一类：

- explore_schema：探索数据库结构，如"有哪些表""表结构""字段""数据库概览"。只想了解 schema，不需要查数据。
- simple_query：单表查询/聚合，直接查数、计数、查某条记录。一次 execute_sql 即可完成。
- complex_query：多表 JOIN、子查询、环比/同比/趋势/排名/占比等复杂统计、需要规划后再生成 SQL。
- write_operation：用户明确想 INSERT/UPDATE/DELETE 数据（创建、新增、修改、删除、设为某值）。注意：仅"分析新增用户数""对比上月新增"这类是查询不是写操作，应归为 complex_query/simple_query。
- ambiguous：查询参数存在歧义需要用户确认，如"最近""这段时间"未指明范围、"按某个维度"未指明哪个维度、"哪个类型"未指明。
- analysis：基于已有查询结果做进一步解读/总结/找原因，而非发起新查询。仅当本次问题是对先前结果的追问时使用。

判别要点：
1. "新增/删除/修改"若只是统计对象（如"新增用户数"）而非动作意图，归为查询而非 write_operation。
2. 同时涉及时间对比、趋势、排名、JOIN 的归 complex_query。
3. 有明确表名和明确统计目标、无歧义参数的归 simple_query。
4. 若无法确定时间范围/维度/对象，归 ambiguous。
5. confidence 表示你对分类的把握，0~1 之间；把握不足时给较低分。
6. suggestedTables 填入用户问题中明确提到的表名（若无则空数组，不要猜测）。

请仅输出符合 JSON Schema 的 JSON 对象。`

const FEW_SHOT_EXAMPLES = `示例：
问："这个数据库有哪些表？" → {"intent":"explore_schema","confidence":0.95,"reasoning":"用户想了解数据库结构","suggestedTables":[]}
问："统计 users 表的记录数" → {"intent":"simple_query","confidence":0.9,"reasoning":"单表计数，无歧义","suggestedTables":["users"]}
问："对比本月和上月的新增用户数" → {"intent":"complex_query","confidence":0.85,"reasoning":"时间对比，需计算两个区间","suggestedTables":["users"]}
问："最近一段时间的订单趋势" → {"intent":"ambiguous","confidence":0.6,"reasoning":"时间范围不明确","suggestedTables":[]}
问："把订单状态为已支付的全部改为已完成" → {"intent":"write_operation","confidence":0.9,"reasoning":"明确 UPDATE 意图","suggestedTables":["orders"]}
问："刚才查到的数据里，为什么这个月比上个月少" → {"intent":"analysis","confidence":0.8,"reasoning":"对已有结果的追问","suggestedTables":[]}`

const ROUTING_HINTS: Record<QueryIntent, string> = {
  explore_schema: '用户想了解数据库结构。调用 get_database_overview 或 get_table_schema 即可，无需生成 SQL。',
  simple_query: '这是一个相对简单的查询。获取表结构后直接生成 SQL 即可。',
  complex_query: '这是一个复杂查询，建议使用 plan_query 进行规划后再生成 SQL。',
  write_operation: '用户要执行写操作。先确认目标表结构，再生成 INSERT/UPDATE/DELETE 语句。',
  ambiguous: '查询参数存在模糊性，建议在生成 SQL 前先调用 smart_filter 让用户确认参数。',
  analysis: '用户想进一步分析已有结果。优先使用执行记录中的数据回答，避免不必要的新查询。',
}

const SKIP_OVERVIEW_INTENTS: ReadonlySet<QueryIntent> = new Set<QueryIntent>(['analysis'])

function fallbackClassification(reason: string): IntentClassification {
  // Conservative fallback: treat as ambiguous so the agent asks for clarification
  // rather than committing to a potentially wrong workflow.
  return {
    intent: 'ambiguous',
    confidence: 0,
    reasoning: reason,
    routingHint: ROUTING_HINTS.ambiguous,
    skipOverview: false,
    suggestedTables: [],
  }
}

/**
 * Classify the user's query intent using a lightweight LLM call.
 *
 * @param userQuery      The user's natural-language question.
 * @param hasHistory     Whether there is prior execution history (enables `analysis`).
 * @param modelConfig    Model configuration (provider/model/apiKey/baseURL) shared
 *                       with the main agent so classification uses the same account.
 */
export async function classifyIntentWithLLM(
  userQuery: string,
  hasHistory: boolean,
  modelConfig: {
    provider: ModelProvider
    model: string
    apiKey?: string
    baseURL?: string
  },
): Promise<IntentClassification> {
  const q = userQuery.trim()
  if (!q) return fallbackClassification('empty query')

  let model: DeepSeekModel
  try {
    const providerDef = getProvider(modelConfig.provider)
    model = createModel({
      provider: modelConfig.provider as any,
      model: modelConfig.model || providerDef.defaultModel,
      thinking: { type: 'disabled' },
      temperature: 0,
      apiKey: modelConfig.apiKey || process.env[providerDef.envApiKeyName],
      baseURL: modelConfig.baseURL || undefined,
    } as any)
  } catch (err) {
    console.error('[intent-router] createModel failed:', err)
    return fallbackClassification('model creation failed')
  }

  const userPrompt = `是否有已执行的查询历史：${hasHistory ? '是' : '否'}

用户问题：${q}

${FEW_SHOT_EXAMPLES}`

  try {
    const result = await generateText({
      model,
      system: INTENT_CLASSIFIER_PROMPT,
      prompt: userPrompt,
      maxSteps: 1,
      output: { schema: IntentSchema },
    })

    const parsed = result.output
    if (!parsed) {
      return fallbackClassification('classifier returned no structured output')
    }

    const intent = parsed.intent as QueryIntent
    let confidence = parsed.confidence
    let reasoning = parsed.reasoning
    const suggestedTables = parsed.suggestedTables ?? []

    // Low-confidence → ambiguous, route to smart_filter for clarification.
    if (confidence < CONFIDENCE_THRESHOLD) {
      reasoning = `[原意图 ${intent} 置信度 ${confidence} 不足，回退为 ambiguous] ${reasoning}`
      return {
        intent: 'ambiguous',
        confidence,
        reasoning,
        routingHint: ROUTING_HINTS.ambiguous,
        suggestedTables,
        skipOverview: false,
      }
    }

    return {
      intent,
      confidence,
      reasoning,
      routingHint: ROUTING_HINTS[intent],
      suggestedTables,
      skipOverview: SKIP_OVERVIEW_INTENTS.has(intent),
    }
  } catch (err) {
    console.error('[intent-router] classifyIntentWithLLM failed:', err)
    return fallbackClassification('classification call failed')
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

  if (classification.reasoning) {
    lines.push(`分类理由: ${classification.reasoning}`)
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
