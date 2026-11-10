import type { z } from 'zod'
import type { AgentCompactConfig } from '@/core/context/compact'
import type { AgentError } from '@/core/errors'
import type { DeepSeekModel } from '@/core/model'
import type { ChatMessage, ModelOptions, Usage } from '@/core/model/types'
import type { ConsistentTools, Tool } from '@/core/tool'
import type { ChatCompletionTool } from '@/core/tool/types'

export interface StepEvent {
  step: number
  type: 'tool' | 'text' | 'format'
  usage: Usage
  toolCalls?: ChatCompletionTool[]
  text?: string
  reasoningContent?: string
}

export interface BeforeStepContext {
  step: number
  config: ModelOptions
  messages: ChatMessage[]
  tools: Tool[]
}

export interface BeforeStepResult {
  messages?: ChatMessage[]
  tools?: Tool[]
  config?: Partial<ModelOptions>
}

export interface HookContext {
  stop: () => void
  skip: () => void
}

export interface BeforeMessageCompactContext {
  promptTokens: number
  messages: ChatMessage[]
  threshold: number
}

export interface MessageCompactEvent {
  messagesBefore: ChatMessage[]
  messagesAfter: ChatMessage[]
  promptTokens: number
  threshold: number
}

export interface BeforeToolCompactContext {
  toolName: string
  toolDescription: string
  content: string
  threshold: number
}

export interface ToolCompactEvent {
  toolName: string
  toolDescription: string
  contentBefore: string
  contentAfter: string
  threshold: number
}

export interface GenerateTextHooks {
  beforeStep?: (context: BeforeStepContext, hookCtx: HookContext) => BeforeStepResult | void
  afterStep?: (step: StepEvent, hookCtx: HookContext) => void
  onError?: (error: AgentError, hookCtx: HookContext) => void | AgentError | Promise<AgentError | void>
  beforeMessageCompact?: (context: BeforeMessageCompactContext, hookCtx: HookContext) => void
  afterMessageCompact?: (event: MessageCompactEvent, hookCtx: HookContext) => void
  beforeToolCompact?: (context: BeforeToolCompactContext, hookCtx: HookContext) => void
  afterToolCompact?: (event: ToolCompactEvent, hookCtx: HookContext) => void
}

export interface GenerateTextParams<T extends z.ZodTypeAny> {
  model: DeepSeekModel
  tools?: ConsistentTools
  system?: string
  messages?: ChatMessage[]
  fewShot?: ChatMessage[]
  maxSteps?: number
  prompt?: string
  output?: {
    schema: T
  }
  hooks?: GenerateTextHooks
  signal?: AbortSignal
  compact?: boolean | AgentCompactConfig
  /** Continue a run that a tool suspended. Replaces `messages`; `system` and `fewShot` are rebuilt from the params. */
  resume?: ResumeParams
}

/** A tool call that returned `suspend(...)` and is waiting for an outside answer. */
export interface PendingToolCall {
  toolCallId: string
  name: string
  /** Raw JSON arguments the model produced. */
  arguments: string
  /** Whatever the tool passed to `suspend()`. */
  payload: unknown
}

/**
 * Everything needed to continue a suspended run, as plain JSON.
 * `messages` is the conversation without the system prompt and few-shot prefix,
 * so the state can be stored outside the process without carrying configuration.
 */
export interface AgentSuspendedState {
  messages: ChatMessage[]
  pending: PendingToolCall[]
}

export interface ResumeParams {
  state: AgentSuspendedState
  /** Real results for pending calls. Calls without one keep their "not executed" placeholder. */
  results: Array<{ toolCallId: string, content: string }>
}

export interface GenerateTextResult<TOutput = undefined> {
  text: string
  output: TOutput
  usage: Usage
  /** Set when the run stopped because a tool suspended it. */
  suspended?: AgentSuspendedState
  /** Why the model stopped on its final answer; `'length'` means the text was cut off by the output limit. */
  finishReason?: string | null
}

export interface TextDeltaStreamEvent {
  type: 'text-delta'
  textDelta: string
}

export interface ReasoningDeltaStreamEvent {
  type: 'reasoning-delta'
  reasoningDelta: string
}

export interface ToolCallStreamEvent {
  type: 'tool-call'
  step: number
  toolCalls: ChatCompletionTool[]
}

export interface ToolResultStreamEvent {
  type: 'tool-result'
  step: number
  toolCallId: string
  name: string
  /** Exactly what the model receives as the tool message. */
  content: string
  /** Serialized tool output, when the call succeeded. */
  data?: string
  /** Failure reason, when the call failed or was blocked. */
  error?: string
  /** The call suspended the run; `payload` is what the tool passed to `suspend()`. */
  suspended?: boolean
  payload?: unknown
}

/** Emitted once, after the step's tool results, when at least one tool suspended the run. */
export interface SuspendStreamEvent {
  type: 'suspend'
  step: number
  state: AgentSuspendedState
}

export interface StepStreamEvent {
  type: 'step'
  step: number
}

export interface FinishStreamEvent {
  type: 'finish'
  text?: string
  usage?: Usage
  suspended?: AgentSuspendedState
  finishReason?: string | null
}

export type StreamEvent
  = | TextDeltaStreamEvent
    | ReasoningDeltaStreamEvent
    | ToolCallStreamEvent
    | ToolResultStreamEvent
    | SuspendStreamEvent
    | StepStreamEvent
    | FinishStreamEvent

export interface StepResult {
  text: string
  toolCalls: ChatCompletionTool[]
  finishReason: string | null
  usage: Usage
  assistantMessage: ChatMessage
  reasoningContent?: string
}

export type StepInvoker = (
  model: DeepSeekModel,
  params: {
    messages: ChatMessage[]
    tools: Tool[]
    signal?: AbortSignal
  },
) => AsyncGenerator<StreamEvent, StepResult>

export interface StepRef {
  value: number
}

export type GenerateStreamParams<T extends z.ZodTypeAny> = GenerateTextParams<T>
