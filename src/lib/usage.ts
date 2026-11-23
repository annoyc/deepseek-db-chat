import type { TokenUsage } from './types'

/** Minimal shape of an OpenAI-compatible usage object from any provider. */
export interface RawModelUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  prompt_cache_hit_tokens?: number
  prompt_tokens_details?: {
    cached_tokens?: number
  }
  completion_tokens_details?: {
    reasoning_tokens?: number
  }
  cost?: number
  cost_currency?: string
}

function nonNegativeInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0
}

function nonNegativeFloat(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function normalizeCurrency(value: unknown): 'USD' | 'CNY' | undefined {
  if (typeof value !== 'string') return undefined
  const upper = value.trim().toUpperCase()
  if (upper === 'USD' || upper === 'CNY') return upper
  return undefined
}

/**
 * Convert a provider's raw `usage` payload into a clean `TokenUsage`, returning
 * `null` when the provider reported neither tokens nor cost.
 */
export function normalizeModelUsage(raw: RawModelUsage | null | undefined): TokenUsage | null {
  if (!raw || typeof raw !== 'object') return null
  const promptTokens = nonNegativeInt(raw.prompt_tokens)
  const completionTokens = nonNegativeInt(raw.completion_tokens)
  const reportedTotal = nonNegativeInt(raw.total_tokens)
  const totalTokens = reportedTotal > 0 ? reportedTotal : promptTokens + completionTokens
  const cachedTokens = nonNegativeInt(raw.prompt_cache_hit_tokens ?? raw.prompt_tokens_details?.cached_tokens)
  const reasoningTokens = nonNegativeInt(raw.completion_tokens_details?.reasoning_tokens)
  const cost = nonNegativeFloat(raw.cost)
  const costCurrency = cost !== undefined ? (normalizeCurrency(raw.cost_currency) ?? 'USD') : undefined

  if (totalTokens === 0 && cost === undefined) return null

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    ...(cachedTokens > 0 ? { cachedTokens } : {}),
    ...(reasoningTokens > 0 ? { reasoningTokens } : {}),
    ...(cost !== undefined ? { cost, costCurrency } : {}),
  }
}

/** Sum multiple usage records (e.g. across intent routing, tool steps, and SQL continuations). */
export function sumTokenUsage(items: Array<TokenUsage | null | undefined>): TokenUsage | undefined {
  let promptTokens = 0
  let completionTokens = 0
  let totalTokens = 0
  let cachedTokens = 0
  let reasoningTokens = 0
  let costSum = 0
  let hasCost = false
  let costCurrency: 'USD' | 'CNY' | undefined
  let mixedCurrency = false

  for (const item of items) {
    if (!item) continue
    promptTokens += nonNegativeInt(item.promptTokens)
    completionTokens += nonNegativeInt(item.completionTokens)
    const itemTotal = nonNegativeInt(item.totalTokens)
    totalTokens += itemTotal > 0 ? itemTotal : nonNegativeInt(item.promptTokens) + nonNegativeInt(item.completionTokens)
    cachedTokens += nonNegativeInt(item.cachedTokens)
    reasoningTokens += nonNegativeInt(item.reasoningTokens)
    if (typeof item.cost === 'number' && Number.isFinite(item.cost) && item.cost >= 0) {
      const currency = item.costCurrency ?? 'USD'
      if (!hasCost) {
        costCurrency = currency
      } else if (costCurrency !== currency) {
        mixedCurrency = true
      }
      costSum += item.cost
      hasCost = true
    }
  }

  const usableCost = hasCost && !mixedCurrency
  if (totalTokens === 0 && !usableCost) return undefined

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    ...(cachedTokens > 0 ? { cachedTokens } : {}),
    ...(reasoningTokens > 0 ? { reasoningTokens } : {}),
    ...(usableCost ? { cost: costSum, costCurrency } : {}),
  }
}

export function formatTokenCount(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return '0'
  if (tokens < 1000) return `${Math.round(tokens)}`
  if (tokens < 999_500) {
    if (tokens >= 100_000) return `${Math.round(tokens / 1000)}k`
    const tenths = Math.round(tokens / 100)
    const formatted = tenths % 10 === 0 ? `${tenths / 10}` : (tenths / 10).toFixed(1)
    return `${formatted}k`
  }
  const hundredths = Math.round(tokens / 10_000)
  return `${(hundredths / 100).toFixed(2).replace(/\.?0+$/, '')}M`
}

export function formatUsageCost(cost: number, currency: 'USD' | 'CNY' = 'USD'): string {
  const symbol = currency === 'CNY' ? '¥' : '$'
  if (cost === 0) return `${symbol}0`
  if (cost < 0.0001) return `<${symbol}0.0001`
  if (cost < 0.01) return `${symbol}${cost.toFixed(4)}`
  if (cost < 1) return `${symbol}${cost.toFixed(3)}`
  return `${symbol}${cost.toFixed(2)}`
}

/** Build a hover tooltip detailing input/cached/output/reasoning tokens and cost when available. */
export function formatUsageTooltip(usage: TokenUsage): string {
  const parts: string[] = []
  if (usage.promptTokens > 0) {
    const cached = usage.cachedTokens && usage.cachedTokens > 0
      ? `（缓存命中 ${usage.cachedTokens.toLocaleString('en-US')}）`
      : ''
    parts.push(`输入 ${usage.promptTokens.toLocaleString('en-US')}${cached}`)
  }
  if (usage.completionTokens > 0) {
    const reasoning = usage.reasoningTokens && usage.reasoningTokens > 0
      ? `（含思考 ${usage.reasoningTokens.toLocaleString('en-US')}）`
      : ''
    parts.push(`输出 ${usage.completionTokens.toLocaleString('en-US')}${reasoning}`)
  }
  if (usage.totalTokens > 0) {
    parts.push(`合计 ${usage.totalTokens.toLocaleString('en-US')} tokens`)
  }
  if (typeof usage.cost === 'number' && Number.isFinite(usage.cost)) {
    parts.push(`费用 ${formatUsageCost(usage.cost, usage.costCurrency)}`)
  }
  return parts.join(' · ')
}
