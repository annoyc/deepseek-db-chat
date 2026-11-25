import type { ThinkingStyle } from '@/core/provider'
import { MAX_EXECUTION_LOG_ENTRIES } from './constants'
import type { KnowledgeMessage } from './knowledge-types'
import type { ChatMessage, ExecutionLogEntry, TokenUsage } from './types'
import { sumTokenUsage } from './usage'

export type ContextUsageLevel = 'normal' | 'warning' | 'danger'
export type ContextUsageSource = 'idle' | 'measured' | 'estimated'
export type ContextWindowSource = 'user' | 'api' | 'configured' | 'known' | 'default'

export interface ContextWindowOverride {
  tokens: number
  source: 'user' | 'api' | 'configured'
}

export interface ContextUsageBreakdown {
  systemTokens: number
  historyTokens: number
  toolOrEvidenceTokens: number
  draftTokens: number
}

export interface ContextUsageSummary {
  usedTokens: number
  maxTokens: number
  windowSource: ContextWindowSource
  /** Clamped 0..1 ratio for ring and bar visuals. */
  ratio: number
  /** Unclamped ratio used for percentage text and thresholds. */
  rawRatio: number
  percentText: string
  level: ContextUsageLevel
  source: ContextUsageSource
  includesDraftEstimate: boolean
  remainingTokens: number
  cachedTokens?: number
  cacheHitRate?: number
  turnCount: number
  breakdown: ContextUsageBreakdown
  /** Cumulative billed usage across turns in this session (distinct from current context window). */
  sessionUsage?: TokenUsage
}

const DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000
const MIN_CONTEXT_WINDOW_TOKENS = 1_024
const MAX_CONTEXT_WINDOW_TOKENS = 100_000_000
const DB_SYSTEM_BASELINE_TOKENS = 2_800
const KNOWLEDGE_SYSTEM_BASELINE_TOKENS = 550
const KNOWLEDGE_MAX_HISTORY_TURNS = 6
const KNOWLEDGE_MAX_HISTORY_CHARS = 1_500

const WARNING_RATIO = 0.6
const DANGER_RATIO = 0.85

const KNOWN_CONTEXT_WINDOWS: Array<{ match: (id: string) => boolean; tokens: number }> = [
  { match: id => id === 'deepseek-flash' || id.startsWith('deepseek-v4'), tokens: 1_000_000 },
  { match: id => id === 'deepseek-chat' || id === 'deepseek-reasoner' || id === 'deepseek-r1' || id.startsWith('deepseek-v3'), tokens: 128_000 },
  { match: id => id.startsWith('qwen-long'), tokens: 10_000_000 },
  {
    match: id =>
      id.startsWith('qwen3.5')
      || id.startsWith('qwen3.6')
      || id.startsWith('qwen3.7')
      || id.startsWith('qwen4')
      || id.startsWith('qwen3-max')
      || id.startsWith('qwen-turbo')
      || id === 'qwen-plus-latest'
      || id === 'qwen-max-latest',
    tokens: 1_000_000,
  },
  { match: id => id === 'qwen-max' || id.startsWith('qwen-max-2024') || id.startsWith('qwen-max-2025'), tokens: 32_000 },
  { match: id => id.startsWith('qwen'), tokens: 128_000 },
  { match: id => id.startsWith('glm-5.2') || id.startsWith('glm-5.4'), tokens: 1_000_000 },
  { match: id => id.startsWith('glm-5'), tokens: 200_000 },
  { match: id => id.startsWith('glm-4'), tokens: 128_000 },
  { match: id => id.startsWith('kimi-k3-256k'), tokens: 256_000 },
  { match: id => id.startsWith('kimi-k2.8') || id.startsWith('kimi-k3'), tokens: 1_000_000 },
  { match: id => id.startsWith('kimi-k2'), tokens: 256_000 },
  { match: id => id.startsWith('moonshot-v1-128k'), tokens: 128_000 },
  { match: id => id.startsWith('moonshot-v1-32k'), tokens: 32_000 },
  { match: id => id.startsWith('moonshot-v1-8k'), tokens: 8_000 },
  { match: id => id.startsWith('gemini-1.5') || id.startsWith('gemini-2') || id.startsWith('gemini-3'), tokens: 1_000_000 },
  { match: id => id.startsWith('gpt-4.1'), tokens: 1_000_000 },
  { match: id => id.startsWith('gpt-5'), tokens: 400_000 },
  { match: id => /^o[134](?:$|-)/.test(id), tokens: 200_000 },
  { match: id => id.startsWith('gpt-4o') || id.startsWith('gpt-4-turbo'), tokens: 128_000 },
  { match: id => id.startsWith('claude-'), tokens: 200_000 },
]

/**
 * Resolve the context window size (in tokens) for a model.
 * Priority: user override > `/models` API metadata > static provider config > known models > 128k default.
 */
export function resolveModelContextWindow(
  modelId?: string,
  override?: number | ContextWindowOverride,
): { tokens: number; source: ContextWindowSource } {
  if (typeof override === 'number') {
    if (Number.isFinite(override) && override > 0) {
      return { tokens: Math.round(override), source: 'configured' }
    }
  } else if (override && typeof override.tokens === 'number' && Number.isFinite(override.tokens) && override.tokens > 0) {
    return { tokens: Math.round(override.tokens), source: override.source }
  }

  const raw = (modelId ?? '').trim().toLowerCase()
  const normalized = raw.includes('/') ? raw.slice(raw.lastIndexOf('/') + 1) : raw
  if (normalized) {
    for (const rule of KNOWN_CONTEXT_WINDOWS) {
      if (rule.match(normalized)) {
        return { tokens: rule.tokens, source: 'known' }
      }
    }
  }

  return { tokens: DEFAULT_CONTEXT_WINDOW_TOKENS, source: 'default' }
}

/** Parse a user-entered context window like `128k`, `1M`, or `200,000`. Returns null if invalid. */
export function parseContextWindowInput(raw: string): number | null {
  const cleaned = raw.trim().replace(/[,\s_]+/g, '')
  if (!cleaned) return null
  const match = cleaned.match(/^(\d+(?:\.\d+)?)([km])?$/i)
  if (!match) return null
  const num = Number(match[1])
  if (!Number.isFinite(num) || num <= 0) return null
  const unit = match[2]?.toLowerCase()
  const multiplier = unit === 'm' ? 1_000_000 : unit === 'k' ? 1_000 : 1
  const tokens = Math.round(num * multiplier)
  if (tokens < MIN_CONTEXT_WINDOW_TOKENS || tokens > MAX_CONTEXT_WINDOW_TOKENS) return null
  return tokens
}

/** Lightweight mixed CJK/ASCII token estimator for draft inputs and unmeasured fallbacks. */
export function estimateTextTokens(text: string): number {
  if (!text || !text.trim()) return 0
  let cjk = 0
  let ascii = 0
  let other = 0

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (
      (code >= 0x4e00 && code <= 0x9fff)
      || (code >= 0x3400 && code <= 0x4dbf)
      || (code >= 0xf900 && code <= 0xfaff)
      || (code >= 0x3000 && code <= 0x303f)
      || (code >= 0xff00 && code <= 0xffef)
    ) {
      cjk++
    } else if (code <= 0x7f) {
      ascii++
    } else {
      other++
    }
  }

  return Math.max(1, Math.ceil(cjk * 0.7 + ascii * 0.28 + other * 0.5))
}

/** Format context occupancy percentage concisely, preserving sub-percent clarity on 1M+ windows. */
export function formatContextPercent(ratio: number, usedTokens: number): string {
  if (!Number.isFinite(ratio) || usedTokens <= 0 || ratio <= 0) return '0%'
  const pct = ratio * 100
  if (pct < 0.1) return '<0.1%'
  if (pct < 10) return `${pct.toFixed(1)}%`
  return `${Math.round(pct)}%`
}

function getUsageLevel(rawRatio: number): ContextUsageLevel {
  if (rawRatio >= DANGER_RATIO) return 'danger'
  if (rawRatio >= WARNING_RATIO) return 'warning'
  return 'normal'
}

/** Reconcile measured total tokens with locally estimated history and tool/evidence weights. */
function reconcileMeasuredBreakdown(
  measuredTotal: number,
  rawHistory: number,
  rawTools: number,
  defaultSystemTokens: number,
): { systemTokens: number; historyTokens: number; toolOrEvidenceTokens: number } {
  if (measuredTotal <= 0) {
    return { systemTokens: 0, historyTokens: 0, toolOrEvidenceTokens: 0 }
  }
  const rawContent = rawHistory + rawTools
  if (measuredTotal > rawContent) {
    return {
      systemTokens: measuredTotal - rawContent,
      historyTokens: rawHistory,
      toolOrEvidenceTokens: rawTools,
    }
  }
  const systemTokens = Math.min(Math.round(measuredTotal * 0.15), defaultSystemTokens)
  const remaining = Math.max(0, measuredTotal - systemTokens)
  if (rawContent === 0) {
    return { systemTokens, historyTokens: remaining, toolOrEvidenceTokens: 0 }
  }
  const historyTokens = Math.round((rawHistory / rawContent) * remaining)
  const toolOrEvidenceTokens = Math.max(0, remaining - historyTokens)
  return { systemTokens, historyTokens, toolOrEvidenceTokens }
}

function finalizeSummary(params: {
  maxTokens: number
  windowSource: ContextWindowSource
  source: ContextUsageSource
  includesDraftEstimate: boolean
  turnCount: number
  breakdown: ContextUsageBreakdown
  cachedTokens?: number
  promptTokensForCache?: number
  sessionUsage?: TokenUsage
}): ContextUsageSummary {
  const { maxTokens, windowSource, source, includesDraftEstimate, turnCount, breakdown } = params
  const usedTokens = Math.max(
    0,
    breakdown.systemTokens + breakdown.historyTokens + breakdown.toolOrEvidenceTokens + breakdown.draftTokens,
  )
  const rawRatio = maxTokens > 0 ? usedTokens / maxTokens : 0
  const ratio = Math.min(1, Math.max(0, rawRatio))
  const remainingTokens = Math.max(0, maxTokens - usedTokens)
  const cachedTokens = params.cachedTokens && params.cachedTokens > 0 ? params.cachedTokens : undefined
  const cacheHitRate = cachedTokens && params.promptTokensForCache && params.promptTokensForCache > 0
    ? Math.min(1, cachedTokens / params.promptTokensForCache)
    : undefined

  return {
    usedTokens,
    maxTokens,
    windowSource,
    ratio,
    rawRatio,
    percentText: formatContextPercent(rawRatio, usedTokens),
    level: getUsageLevel(rawRatio),
    source,
    includesDraftEstimate,
    remainingTokens,
    ...(cachedTokens !== undefined ? { cachedTokens } : {}),
    ...(cacheHitRate !== undefined ? { cacheHitRate } : {}),
    turnCount,
    breakdown,
    ...(params.sessionUsage ? { sessionUsage: params.sessionUsage } : {}),
  }
}

function estimateChatSliceTokens(messages: ChatMessage[]): { historyTokens: number; toolTokens: number } {
  let historyTokens = 0
  let toolTokens = 0

  for (const msg of messages) {
    if (msg.role === 'user') {
      historyTokens += estimateTextTokens(msg.content)
      continue
    }
    historyTokens += estimateTextTokens(msg.content)
    const visibleCalls = (msg.toolCalls ?? []).filter(
      tc => tc.name !== 'execute_sql' && tc.name !== 'smart_filter',
    )
    for (const tc of visibleCalls) {
      let argsText = ''
      try {
        argsText = JSON.stringify(tc.args ?? {})
      } catch {
        argsText = ''
      }
      toolTokens += estimateTextTokens(tc.name) + estimateTextTokens(argsText) + estimateTextTokens(tc.result || tc.error || '')
    }
  }

  return { historyTokens, toolTokens }
}

function estimateExecutionLogTokens(executionLog?: ExecutionLogEntry[]): number {
  if (!executionLog?.length) return 0
  const recent = executionLog.slice(-MAX_EXECUTION_LOG_ENTRIES)
  let total = 0
  for (const entry of recent) {
    total += estimateTextTokens(entry.sql) + estimateTextTokens(entry.summary)
  }
  return total
}

function computeChatSessionUsage(messages: ChatMessage[]): TokenUsage | undefined {
  const turnBuckets: ChatMessage[][] = []
  let current: ChatMessage[] = []

  for (const msg of messages) {
    if (msg.role === 'user' && current.length > 0) {
      turnBuckets.push(current)
      current = []
    }
    current.push(msg)
  }
  if (current.length > 0) {
    turnBuckets.push(current)
  }

  const perTurnUsages: Array<TokenUsage | undefined> = []
  for (const bucket of turnBuckets) {
    const assistants = bucket.filter(m => m.role === 'assistant')
    if (assistants.length === 0) continue
    let turnAnswerUsage: TokenUsage | undefined
    for (let i = assistants.length - 1; i >= 0; i--) {
      if (assistants[i].answerUsage) {
        turnAnswerUsage = assistants[i].answerUsage
        break
      }
    }
    if (turnAnswerUsage) {
      perTurnUsages.push(turnAnswerUsage)
    } else {
      perTurnUsages.push(sumTokenUsage(assistants.map(m => m.usage)))
    }
  }

  return sumTokenUsage(perTurnUsages)
}

export interface ComputeChatContextUsageParams {
  messages: ChatMessage[]
  executionLog?: ExecutionLogEntry[]
  draftText: string
  modelId?: string
  contextWindowOverride?: number | ContextWindowOverride
  /** @deprecated Prefer contextWindowOverride. */
  configuredContextWindow?: number
  thinkingStyle?: ThinkingStyle
  thinkingMode?: 'enabled' | 'disabled'
  isStreaming?: boolean
}

/** Compute context window occupancy and breakdown for the database chat workbench. */
export function computeChatContextUsage(params: ComputeChatContextUsageParams): ContextUsageSummary {
  const {
    messages,
    executionLog,
    draftText,
    modelId,
    contextWindowOverride,
    configuredContextWindow,
    thinkingStyle,
    thinkingMode,
    isStreaming,
  } = params
  const { tokens: maxTokens, source: windowSource } = resolveModelContextWindow(
    modelId,
    contextWindowOverride ?? configuredContextWindow,
  )
  const draftTokens = estimateTextTokens(draftText)
  const turnCount = messages.filter(m => m.role === 'user').length
  const sessionUsage = computeChatSessionUsage(messages)

  if (messages.length === 0) {
    return finalizeSummary({
      maxTokens,
      windowSource,
      source: draftTokens > 0 ? 'estimated' : 'idle',
      includesDraftEstimate: draftTokens > 0,
      turnCount: 0,
      breakdown: { systemTokens: 0, historyTokens: 0, toolOrEvidenceTokens: 0, draftTokens },
    })
  }

  let measuredIdx = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant' && messages[i].contextUsage) {
      measuredIdx = i
      break
    }
  }

  const logTokens = estimateExecutionLogTokens(executionLog)

  if (measuredIdx !== -1) {
    const measured = messages[measuredIdx].contextUsage!
    const lastMsg = messages[messages.length - 1]
    const inSameTurn = Boolean(isStreaming || lastMsg?.agentState)
    const normalizedId = (modelId ?? '').trim().toLowerCase()
    const replaysReasoning = thinkingStyle === 'deepseek' || (thinkingStyle === undefined && normalizedId.includes('deepseek'))
    const keepReasoning = inSameTurn && replaysReasoning && thinkingMode !== 'disabled'
    const effectiveCompletion = keepReasoning
      ? measured.completionTokens
      : Math.max(0, measured.completionTokens - (measured.reasoningTokens ?? 0))
    const measuredTotal = measured.promptTokens + effectiveCompletion

    const upToMeasured = estimateChatSliceTokens(messages.slice(0, measuredIdx + 1))
    const baseBreakdown = reconcileMeasuredBreakdown(
      measuredTotal,
      upToMeasured.historyTokens,
      upToMeasured.toolTokens + logTokens,
      DB_SYSTEM_BASELINE_TOKENS,
    )
    const afterMeasured = estimateChatSliceTokens(messages.slice(measuredIdx + 1))

    return finalizeSummary({
      maxTokens,
      windowSource,
      source: 'measured',
      includesDraftEstimate: draftTokens > 0 || afterMeasured.historyTokens > 0 || afterMeasured.toolTokens > 0,
      turnCount,
      breakdown: {
        systemTokens: baseBreakdown.systemTokens,
        historyTokens: baseBreakdown.historyTokens + afterMeasured.historyTokens,
        toolOrEvidenceTokens: baseBreakdown.toolOrEvidenceTokens + afterMeasured.toolTokens,
        draftTokens,
      },
      cachedTokens: measured.cachedTokens,
      promptTokensForCache: measured.promptTokens,
      sessionUsage,
    })
  }

  const estimated = estimateChatSliceTokens(messages)
  return finalizeSummary({
    maxTokens,
    windowSource,
    source: 'estimated',
    includesDraftEstimate: draftTokens > 0,
    turnCount,
    breakdown: {
      systemTokens: DB_SYSTEM_BASELINE_TOKENS,
      historyTokens: estimated.historyTokens,
      toolOrEvidenceTokens: estimated.toolTokens + logTokens,
      draftTokens,
    },
    sessionUsage,
  })
}

function estimateKnowledgeHistoryTokens(messages: KnowledgeMessage[]): number {
  const nonEmpty = messages.filter(m => m.content.trim())
  const recent = nonEmpty.slice(-KNOWLEDGE_MAX_HISTORY_TURNS)
  let total = 0
  for (const msg of recent) {
    total += estimateTextTokens(msg.content.slice(0, KNOWLEDGE_MAX_HISTORY_CHARS))
  }
  return total
}

function estimateKnowledgeEvidenceTokens(message?: KnowledgeMessage): number {
  const evidence = message?.evidence
  if (!evidence) return 0
  let total = 0
  for (const citation of evidence.citations ?? []) {
    total += estimateTextTokens(citation.docTitle) + estimateTextTokens(citation.locator) + estimateTextTokens(citation.text)
  }
  for (const web of evidence.webResults ?? []) {
    total += estimateTextTokens(web.title) + estimateTextTokens(web.snippet ?? '') + estimateTextTokens(web.url)
  }
  return total
}

export interface ComputeKnowledgeContextUsageParams {
  messages: KnowledgeMessage[]
  draftText: string
  modelId?: string
  contextWindowOverride?: number | ContextWindowOverride
  /** @deprecated Prefer contextWindowOverride. */
  configuredContextWindow?: number
  isStreaming?: boolean
}

/** Compute context window occupancy and breakdown for the knowledge Q&A workbench. */
export function computeKnowledgeContextUsage(params: ComputeKnowledgeContextUsageParams): ContextUsageSummary {
  const { messages, draftText, modelId, contextWindowOverride, configuredContextWindow, isStreaming } = params
  const { tokens: maxTokens, source: windowSource } = resolveModelContextWindow(
    modelId,
    contextWindowOverride ?? configuredContextWindow,
  )
  const draftTokens = estimateTextTokens(draftText)
  const turnCount = messages.filter(m => m.role === 'user').length
  const sessionUsage = sumTokenUsage(messages.filter(m => m.role === 'assistant').map(m => m.contextUsage))

  if (messages.length === 0) {
    return finalizeSummary({
      maxTokens,
      windowSource,
      source: draftTokens > 0 ? 'estimated' : 'idle',
      includesDraftEstimate: draftTokens > 0,
      turnCount: 0,
      breakdown: { systemTokens: 0, historyTokens: 0, toolOrEvidenceTokens: 0, draftTokens },
    })
  }

  let measuredIdx = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant' && messages[i].contextUsage) {
      measuredIdx = i
      break
    }
  }

  if (measuredIdx !== -1) {
    const measured = messages[measuredIdx].contextUsage!
    const effectiveCompletion = isStreaming
      ? measured.completionTokens
      : Math.max(0, measured.completionTokens - (measured.reasoningTokens ?? 0))
    const measuredTotal = measured.promptTokens + effectiveCompletion
    const rawHistory = estimateKnowledgeHistoryTokens(messages.slice(0, measuredIdx))
      + estimateTextTokens(messages[measuredIdx].content)
    const rawEvidence = estimateKnowledgeEvidenceTokens(messages[measuredIdx])
    const baseBreakdown = reconcileMeasuredBreakdown(
      measuredTotal,
      rawHistory,
      rawEvidence,
      KNOWLEDGE_SYSTEM_BASELINE_TOKENS,
    )

    let trailingTokens = 0
    for (const msg of messages.slice(measuredIdx + 1)) {
      trailingTokens += estimateTextTokens(msg.content.slice(0, KNOWLEDGE_MAX_HISTORY_CHARS))
    }

    return finalizeSummary({
      maxTokens,
      windowSource,
      source: 'measured',
      includesDraftEstimate: draftTokens > 0 || trailingTokens > 0,
      turnCount,
      breakdown: {
        systemTokens: baseBreakdown.systemTokens,
        historyTokens: baseBreakdown.historyTokens + trailingTokens,
        toolOrEvidenceTokens: baseBreakdown.toolOrEvidenceTokens,
        draftTokens,
      },
      cachedTokens: measured.cachedTokens,
      promptTokensForCache: measured.promptTokens,
      sessionUsage,
    })
  }

  const historyTokens = estimateKnowledgeHistoryTokens(messages)
  const latestAssistant = [...messages].reverse().find(m => m.role === 'assistant')
  const evidenceTokens = estimateKnowledgeEvidenceTokens(latestAssistant)

  return finalizeSummary({
    maxTokens,
    windowSource,
    source: 'estimated',
    includesDraftEstimate: draftTokens > 0,
    turnCount,
    breakdown: {
      systemTokens: KNOWLEDGE_SYSTEM_BASELINE_TOKENS,
      historyTokens,
      toolOrEvidenceTokens: evidenceTokens,
      draftTokens,
    },
    sessionUsage,
  })
}
