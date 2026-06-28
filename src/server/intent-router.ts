/**
 * Intent Router — LLM-based intent classification of user queries.
 *
 * Outputs multi-dimensional confidence scores so downstream code can make
 * enforcement decisions without relying on prompt engineering.
 */

import { z } from 'zod'
import { createModel, generateText, getProvider } from '@/core'
import type { DeepSeekModel } from '@/core'
import type { ModelProvider } from '@/core/model/types'

export type QueryIntent =
  | 'explore_schema'
  | 'simple_query'
  | 'complex_query'
  | 'write_operation'
  | 'analysis'

export interface IntentClassification {
  intent: QueryIntent
  confidence: number
  needsFilter: number
  needsPlanning: boolean
  reasoning: string
  routingHint: string
  suggestedTables?: string[]
  skipOverview?: boolean
}

const IntentSchema = z.object({
  intent: z.enum([
    'explore_schema',
    'simple_query',
    'complex_query',
    'write_operation',
    'analysis',
  ]),
  confidence: z.number().min(0).max(1),
  needsFilter: z.number().min(0).max(1),
  needsPlanning: z.boolean(),
  reasoning: z.string(),
  suggestedTables: z.array(z.string()).optional().default([]),
})

const INTENT_CLASSIFIER_PROMPT = `你是一个数据库查询意图分类器。输出多维度评估：

intent（查询类型）:
- explore_schema: 只想了解数据库/表结构
- simple_query: 单表或简单查询
- complex_query: 多表 JOIN、子查询、时间对比等
- write_operation: INSERT/UPDATE/DELETE
- analysis: 对已有查询结果的追问分析

needsFilter（0~1，需要用户确认参数的程度）:
- 0: 所有参数已明确（如"今天新增用户数""最近7天每天订单量"）
- 0.3~0.5: 大部分明确但有一两个可调参数
- 0.6~0.8: 关键参数缺失（如有"趋势/统计/分析"但无时间范围或聚合粒度）
- 0.9~1.0: 非常模糊（如"订单数据分析""看看情况"）

needsPlanning: 是否需要先规划再查询（复杂 JOIN、多步查询）

判断 needsFilter 的关键规则：
- 涉及趋势/变化/统计 但没说时间范围 → 高 needsFilter
- 涉及时间序列 但没说聚合粒度（按日/周/月）→ 中高 needsFilter
- 筛选对象不明确（多张表可选、多个维度可选）→ 高 needsFilter
- "统计 users 表记录数" → needsFilter=0（无需时间、无需筛选）
- "最近7天每天的订单量" → needsFilter=0（时间+粒度都明确）

请仅输出 JSON。`

const FEW_SHOT_EXAMPLES = `示例：
问："有哪些表" → {"intent":"explore_schema","confidence":0.95,"needsFilter":0,"needsPlanning":false,"reasoning":"结构查询","suggestedTables":[]}
问："users表有多少条记录" → {"intent":"simple_query","confidence":0.9,"needsFilter":0,"needsPlanning":false,"reasoning":"单表计数，参数完整","suggestedTables":["users"]}
问："最近7天每天的订单量" → {"intent":"simple_query","confidence":0.9,"needsFilter":0,"needsPlanning":false,"reasoning":"时间和粒度都明确","suggestedTables":["orders"]}
问："首页访问趋势" → {"intent":"simple_query","confidence":0.7,"needsFilter":0.8,"needsPlanning":false,"reasoning":"缺少时间范围和聚合粒度","suggestedTables":[]}
问："用户增长情况" → {"intent":"simple_query","confidence":0.6,"needsFilter":0.85,"needsPlanning":false,"reasoning":"缺少时间范围、聚合粒度","suggestedTables":[]}
问："对比本月和上月订单" → {"intent":"complex_query","confidence":0.85,"needsFilter":0.1,"needsPlanning":true,"reasoning":"时间对比，区间已明确","suggestedTables":["orders"]}
问："订单数据分析" → {"intent":"simple_query","confidence":0.4,"needsFilter":0.95,"needsPlanning":false,"reasoning":"极度模糊，什么指标、什么时间、什么维度都不明确","suggestedTables":[]}
问："页面访问量统计" → {"intent":"simple_query","confidence":0.6,"needsFilter":0.8,"needsPlanning":false,"reasoning":"缺少时间范围和分组维度","suggestedTables":[]}
问："把状态改为已完成" → {"intent":"write_operation","confidence":0.9,"needsFilter":0.3,"needsPlanning":false,"reasoning":"写操作，但筛选条件可能不完整","suggestedTables":[]}
问："刚才那个数据为什么少了" → {"intent":"analysis","confidence":0.8,"needsFilter":0,"needsPlanning":false,"reasoning":"对已有结果追问","suggestedTables":[]}`

const ROUTING_HINTS: Record<QueryIntent, string> = {
  explore_schema: '调用 get_database_overview 或 get_table_schema 了解结构即可。',
  simple_query: '获取表结构后生成 SQL。',
  complex_query: '建议使用 plan_query 规划后再生成 SQL。',
  write_operation: '确认目标表结构后生成写操作语句。',
  analysis: '基于已有结果回答，避免不必要的新查询。',
}

const SKIP_OVERVIEW_INTENTS: ReadonlySet<QueryIntent> = new Set<QueryIntent>(['analysis'])

/** Threshold: needsFilter above this value triggers the hard gate. */
export const FILTER_CONFIDENCE_THRESHOLD = 0.5

function fallbackClassification(reason: string): IntentClassification {
  return {
    intent: 'simple_query',
    confidence: 0,
    needsFilter: 0.9,
    needsPlanning: false,
    reasoning: reason,
    routingHint: ROUTING_HINTS.simple_query,
    skipOverview: false,
    suggestedTables: [],
  }
}

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

  const userPrompt = `有查询历史：${hasHistory ? '是' : '否'}\n问题：${q}\n\n${FEW_SHOT_EXAMPLES}`

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

    return {
      intent: parsed.intent as QueryIntent,
      confidence: parsed.confidence,
      needsFilter: parsed.needsFilter,
      needsPlanning: parsed.needsPlanning,
      reasoning: parsed.reasoning,
      routingHint: ROUTING_HINTS[parsed.intent as QueryIntent],
      suggestedTables: parsed.suggestedTables ?? [],
      skipOverview: SKIP_OVERVIEW_INTENTS.has(parsed.intent as QueryIntent),
    }
  } catch (err) {
    console.error('[intent-router] classifyIntentWithLLM failed:', err)
    return fallbackClassification('classification call failed')
  }
}

export function buildRoutingPrompt(classification: IntentClassification): string {
  const lines: string[] = [
    `\n【路由】${classification.routingHint}`,
  ]

  if (classification.suggestedTables && classification.suggestedTables.length > 0) {
    lines.push(`可能涉及: ${classification.suggestedTables.join(', ')}`)
  }

  if (classification.skipOverview) {
    lines.push('可跳过 get_database_overview。')
  }

  return lines.join('\n')
}
