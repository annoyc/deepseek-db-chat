import { parseSuspendedState } from '@/core'
import type { AgentSuspendedState, ResumeParams, StreamEvent } from '@/core'
import type { AnalysisReport, StreamChunk, SuggestedFilter } from '@/lib/types'

export interface ChatResumeInput {
  state: unknown
  toolCallId: string
  result: string
}

/** Tools whose outcome reaches the user through a dedicated event instead of the tool-call row. */
const HIDDEN_RESULT_TOOLS = new Set(['execute_sql', 'smart_filter', 'report_analysis'])

/** A client-held state is untrusted: validate it, and fall back to a fresh turn if it is unusable. */
export function parseResume(input: ChatResumeInput | undefined): ResumeParams | undefined {
  if (!input || typeof input.result !== 'string') return undefined
  try {
    const state = parseSuspendedState(input.state)
    if (!state.pending.some(call => call.toolCallId === input.toolCallId)) return undefined
    return { state, results: [{ toolCallId: input.toolCallId, content: input.result }] }
  } catch {
    return undefined
  }
}

function parseArgs(raw: string | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch (err) {
    console.warn('[chat] Failed to parse tool call args:', err instanceof Error ? err.name : 'UnknownError')
    return {}
  }
}

/**
 * Translate agent events into the chat protocol. Every tool call is closed by
 * the `tool-result` that carries its id, so parallel calls of the same tool
 * cannot be mixed up, and a suspended run surfaces as a confirmation request.
 */
export function createChatEventMapper() {
  const argsById = new Map<string, Record<string, unknown>>()

  function onSuspend(state: AgentSuspendedState): StreamChunk[] {
    // One confirmation at a time; SQL confirmation takes precedence, as before.
    const call = state.pending.find(c => c.name === 'execute_sql') ?? state.pending.find(c => c.name === 'smart_filter')
    const payload = (call?.payload ?? {}) as Record<string, unknown>
    if (call?.name === 'execute_sql') {
      return [
        { type: 'agent-suspended', state, toolCallId: call.toolCallId },
        {
          type: 'sql-confirm',
          sql: String(payload.sql ?? ''),
          explanation: String(payload.explanation ?? ''),
          intent_summary: payload.intent_summary as string | undefined,
          expected_shape: payload.expected_shape as string | undefined,
        },
      ]
    }
    const filters = Array.isArray(payload.filters) ? payload.filters as SuggestedFilter[] : []
    if (call?.name === 'smart_filter' && filters.length > 0) {
      return [
        { type: 'agent-suspended', state, toolCallId: call.toolCallId },
        { type: 'smart-filter-confirm', suggestedFilters: filters },
      ]
    }
    return [{ type: 'error', message: '筛选参数生成失败，请重试或换一种描述。' }]
  }

  return function map(event: StreamEvent): StreamChunk[] {
    switch (event.type) {
      case 'reasoning-delta':
        return [{ type: 'thinking', content: event.reasoningDelta }]
      case 'text-delta':
        return [{ type: 'text', content: event.textDelta }]
      case 'tool-call':
        return event.toolCalls.map((tc) => {
          const args = parseArgs(tc.function.arguments)
          argsById.set(tc.id, args)
          return { type: 'tool-call-start', name: tc.function.name, args }
        })
      case 'tool-result': {
        const chunks: StreamChunk[] = []
        const { name } = event
        if (name === 'report_analysis' && !event.error) {
          const args = argsById.get(event.toolCallId) ?? {}
          chunks.push({
            type: 'analysis-report',
            report: { summary: args.summary, metrics: args.metrics, chartSuggestion: args.chartSuggestion, nextQueries: args.nextQueries } as AnalysisReport,
          })
        }
        // A SQL statement awaiting confirmation stays open until the user decides.
        if (event.suspended && name === 'execute_sql') return chunks
        chunks.push(event.error
          ? { type: 'tool-call-end', name, result: '', error: event.error }
          : { type: 'tool-call-end', name, result: HIDDEN_RESULT_TOOLS.has(name) ? '' : event.data ?? '' })
        return chunks
      }
      case 'suspend':
        return onSuspend(event.state)
      case 'finish':
        // Tell the user instead of presenting a cut-off answer as complete.
        return event.finishReason === 'length'
          ? [{ type: 'error', message: '回复达到模型输出长度上限，内容可能不完整。可以让我继续，或缩小问题范围。' }]
          : []
      default:
        return []
    }
  }
}
