import type { BeforeMessageCompactContext, BeforeToolCompactContext, GenerateTextHooks, HookContext, MessageCompactEvent, StepEvent, ToolCompactEvent } from './types'
import type { DeepSeekModel } from '@/core/model'
import type { ChatMessage, Usage } from '@/core/model/types'
import type { Tool } from '@/core/tool'
import { AgentError } from '@/core/errors'

export class StopLoop extends Error {
  constructor() {
    super('StopLoop')
    this.name = 'StopLoop'
  }
}

export function lastAssistantMsg(messages: ChatMessage[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') {
      return messages[i].content || ''
    }
  }
  return ''
}

export function mergeUsage(target: Usage, source: Usage): void {
  const prompt = source.prompt_tokens ?? source.input_tokens ?? 0
  const completion = source.completion_tokens ?? source.output_tokens ?? 0
  target.completion_tokens += completion
  target.prompt_tokens += prompt
  target.prompt_cache_hit_tokens = (target.prompt_cache_hit_tokens ?? 0) + (source.prompt_cache_hit_tokens ?? 0)
  target.prompt_cache_miss_tokens = (target.prompt_cache_miss_tokens ?? 0) + (source.prompt_cache_miss_tokens ?? 0)
  if (source.cached_tokens !== undefined) {
    target.cached_tokens = (target.cached_tokens ?? 0) + source.cached_tokens
  }
  if (source.cache_read_input_tokens !== undefined) {
    target.cache_read_input_tokens = (target.cache_read_input_tokens ?? 0) + source.cache_read_input_tokens
  }
  if (source.prompt_tokens_details?.cached_tokens !== undefined) {
    if (!target.prompt_tokens_details) {
      target.prompt_tokens_details = { cached_tokens: 0 }
    }
    target.prompt_tokens_details.cached_tokens = (target.prompt_tokens_details.cached_tokens ?? 0) + source.prompt_tokens_details.cached_tokens
  }
  target.total_tokens += source.total_tokens ?? (prompt + completion)
  if (source.completion_tokens_details) {
    if (!target.completion_tokens_details) {
      target.completion_tokens_details = { reasoning_tokens: 0 }
    }
    target.completion_tokens_details.reasoning_tokens += source.completion_tokens_details.reasoning_tokens ?? 0
  }
  if (typeof source.cost === 'number' && Number.isFinite(source.cost) && source.cost >= 0) {
    target.cost = (target.cost ?? 0) + source.cost
    if (source.cost_currency && !target.cost_currency) {
      target.cost_currency = source.cost_currency
    }
  }
}

function positiveInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0
}

/**
 * Update a single stream's `Usage` from an SSE `chunk.usage` payload.
 * Unlike `mergeUsage` (which sums across agent steps), providers that emit
 * cumulative snapshots on every chunk (e.g. Gemini, DashScope, gateways) must
 * overwrite rather than accumulate, while empty trailing chunks (`0`) must not
 * erase earlier non-zero counts.
 */
export function applyStreamUsage(target: Usage, source: Usage): void {
  const prompt = positiveInt(source.prompt_tokens ?? source.input_tokens)
  const completion = positiveInt(source.completion_tokens ?? source.output_tokens)
  if (prompt > 0) target.prompt_tokens = prompt
  if (completion > 0) target.completion_tokens = completion

  const total = positiveInt(source.total_tokens)
  if (total > 0) {
    target.total_tokens = total
  } else if (target.prompt_tokens > 0 || target.completion_tokens > 0) {
    target.total_tokens = target.prompt_tokens + target.completion_tokens
  }

  const cacheHit = positiveInt(source.prompt_cache_hit_tokens)
  if (cacheHit > 0) target.prompt_cache_hit_tokens = cacheHit

  const cacheMiss = positiveInt(source.prompt_cache_miss_tokens)
  if (cacheMiss > 0) target.prompt_cache_miss_tokens = cacheMiss

  const topCached = positiveInt(source.cached_tokens)
  if (topCached > 0) target.cached_tokens = topCached

  const anthropicCached = positiveInt(source.cache_read_input_tokens)
  if (anthropicCached > 0) target.cache_read_input_tokens = anthropicCached

  const detailsCached = positiveInt(source.prompt_tokens_details?.cached_tokens)
  if (detailsCached > 0) {
    target.prompt_tokens_details = { cached_tokens: detailsCached }
  }

  const reasoning = positiveInt(source.completion_tokens_details?.reasoning_tokens)
  if (reasoning > 0) {
    target.completion_tokens_details = { reasoning_tokens: reasoning }
  }

  if (typeof source.cost === 'number' && Number.isFinite(source.cost) && source.cost >= 0) {
    target.cost = source.cost
    if (source.cost_currency) {
      target.cost_currency = source.cost_currency
    }
  }
}

export function buildMessage(prompt?: string, system?: string, messages?: ChatMessage[], fewShot?: ChatMessage[]): ChatMessage[] {
  if (!prompt && !system && !messages) {
    throw new Error('prompt is required')
  }
  const message: ChatMessage[] = []
  if (system) {
    message.push({ role: 'system', content: system })
  }
  if (fewShot) {
    message.push(...fewShot.map((msg) => {
      return { ...msg, name: 'few-shot' }
    }))
  }
  if (messages) {
    message.push(...messages)
  }
  if (prompt) {
    message.push({ role: 'user', content: prompt })
  }
  return message
}

export function emptyUsage(): Usage {
  return {
    completion_tokens: 0,
    prompt_tokens: 0,
    total_tokens: 0,
  }
}

export class HookRunner {
  private shouldStop = false
  private shouldSkip = false
  private parentHookCtx?: HookContext
  public readonly hookCtx: HookContext

  constructor(parentHookCtx?: HookContext) {
    this.parentHookCtx = parentHookCtx
    this.hookCtx = {
      stop: () => {
        this.shouldStop = true
        this.parentHookCtx?.stop()
      },
      skip: () => {
        this.shouldSkip = true
      },
    }
  }

  get stopped() {
    return this.shouldStop
  }

  get skipped() {
    return this.shouldSkip
  }

  resetSkip() {
    this.shouldSkip = false
  }

  runBeforeStep(
    hooks: GenerateTextHooks | undefined,
    step: number,
    currentMessages: ChatMessage[],
    currentTools: Tool[],
    model: DeepSeekModel,
  ): DeepSeekModel {
    if (!hooks?.beforeStep) {
      return model
    }
    const hookResult = hooks.beforeStep({
      step,
      config: model.config,
      messages: [...currentMessages],
      tools: currentTools,
    }, this.hookCtx)
    if (hookResult?.messages) {
      currentMessages.length = 0
      currentMessages.push(...hookResult.messages)
    }
    if (hookResult?.tools !== undefined) {
      currentTools.length = 0
      currentTools.push(...hookResult.tools)
    }
    if (hookResult?.config) {
      return model.withConfig(hookResult.config)
    }
    return model
  }

  runAfterStep(hooks: GenerateTextHooks | undefined, stepEvent: StepEvent): void {
    hooks?.afterStep?.(stepEvent, this.hookCtx)
  }

  async runOnError(hooks: GenerateTextHooks | undefined, error: AgentError): Promise<AgentError | undefined> {
    if (!hooks?.onError) {
      return error
    }
    const result = await hooks.onError(error, this.hookCtx)
    if (result instanceof AgentError) {
      return result
    }
    return undefined
  }

  runBeforeMessageCompact(hooks: GenerateTextHooks | undefined, context: BeforeMessageCompactContext): void {
    hooks?.beforeMessageCompact?.(context, this.hookCtx)
  }

  runAfterMessageCompact(hooks: GenerateTextHooks | undefined, event: MessageCompactEvent): void {
    hooks?.afterMessageCompact?.(event, this.hookCtx)
  }

  runBeforeToolCompact(hooks: GenerateTextHooks | undefined, context: BeforeToolCompactContext): void {
    hooks?.beforeToolCompact?.(context, this.hookCtx)
  }

  runAfterToolCompact(hooks: GenerateTextHooks | undefined, event: ToolCompactEvent): void {
    hooks?.afterToolCompact?.(event, this.hookCtx)
  }
}
