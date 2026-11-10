import type { AgentSuspendedState, ResumeParams } from './types'
import type { ChatMessage } from '@/core/model/types'
import { z } from 'zod'

const toolCallSchema = z.object({
  id: z.string().min(1),
  type: z.literal('function'),
  function: z.object({ name: z.string(), arguments: z.string() }),
})

// A stored state never carries configuration: system and few-shot messages are rejected.
const messageSchema = z.discriminatedUnion('role', [
  z.object({ role: z.literal('user'), content: z.string(), name: z.string().optional() }),
  z.object({
    role: z.literal('assistant'),
    content: z.string().nullable().optional(),
    reasoning_content: z.string().optional(),
    tool_calls: z.array(toolCallSchema).optional(),
  }),
  z.object({ role: z.literal('tool'), content: z.string(), tool_call_id: z.string().min(1) }),
])

const stateSchema = z.object({
  messages: z.array(messageSchema).min(1).max(1000),
  pending: z.array(z.object({
    toolCallId: z.string().min(1),
    name: z.string(),
    arguments: z.string(),
    payload: z.unknown(),
  })).min(1),
})

function isPrefixMessage(message: ChatMessage): boolean {
  return message.role === 'system' || ('name' in message && message.name === 'few-shot')
}

/** The conversation without the leading system prompt and few-shot examples. */
export function conversationOf(messages: ChatMessage[]): ChatMessage[] {
  let start = 0
  while (start < messages.length && isPrefixMessage(messages[start])) start++
  return messages.slice(start).map(message => ({ ...message }))
}

/**
 * Validate a suspended state that left the process (stored, sent to a client).
 * Throws when the shape is wrong or a pending call has no matching tool message.
 */
export function parseSuspendedState(input: unknown): AgentSuspendedState {
  const state = stateSchema.parse(input) as unknown as AgentSuspendedState
  const answered = new Set(state.messages.flatMap(message => message.role === 'tool' ? [message.tool_call_id] : []))
  const called = new Set(state.messages.flatMap(message =>
    message.role === 'assistant' ? (message.tool_calls ?? []).map(call => call.id) : []))
  for (const call of state.pending) {
    if (!answered.has(call.toolCallId) || !called.has(call.toolCallId)) {
      throw new Error(`Suspended state is inconsistent: no tool call "${call.toolCallId}"`)
    }
  }
  return state
}

/** The saved conversation with real results written over the pending placeholders. */
export function applyResume(resume: ResumeParams): ChatMessage[] {
  const pendingIds = new Set(resume.state.pending.map(call => call.toolCallId))
  const results = new Map<string, string>()
  for (const { toolCallId, content } of resume.results) {
    if (!pendingIds.has(toolCallId)) {
      throw new Error(`Cannot resume: "${toolCallId}" is not a pending tool call`)
    }
    results.set(toolCallId, content)
  }
  return resume.state.messages.map((message) => {
    if (message.role === 'tool' && results.has(message.tool_call_id)) {
      return { ...message, content: results.get(message.tool_call_id)! }
    }
    return { ...message }
  })
}
