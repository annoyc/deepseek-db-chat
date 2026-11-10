import type z from 'zod'
import type { GenerateTextParams, GenerateTextResult, PendingToolCall, StepInvoker, StepRef, StreamEvent } from './types'
import type { ChatMessage, Usage } from '@/core/model/types'
import type { Tool } from '@/core/tool'
import type { ChatCompletionTool, ToolOutcome } from '@/core/tool/types'
import { AGENT_LOOP_MAX_STEPS } from '@/core/constants'
import { createCompactMessage } from '@/core/context/compact'
import { AgentError, classifyError } from '@/core/errors'
import { generateStructuredOutput } from './generate-structured-output'
import { buildMessage, emptyUsage, HookRunner, lastAssistantMsg, mergeUsage, StopLoop } from './generate-utils'
import { applyResume, conversationOf } from './suspend'

function normalizeArgs(args: string): string {
  try {
    const parsed = JSON.parse(args)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return JSON.stringify(Object.keys(parsed).sort().reduce((acc: Record<string, unknown>, key) => {
        acc[key] = parsed[key]
        return acc
      }, {}))
    }
  } catch (err) { console.warn('[generate] Failed to sanitize tool args:', err) }
  return args
}

function makeToolCallKey(toolCall: ChatCompletionTool): string {
  return `${toolCall.function?.name ?? ''}::${normalizeArgs(toolCall.function?.arguments ?? '{}')}`
}

async function executeToolCalls(
  toolCalls: ChatCompletionTool[],
  tools: Tool[],
  signal?: AbortSignal,
  runner?: HookRunner,
  hooks?: GenerateTextParams<any>['hooks'],
): Promise<Array<{ toolCall: ChatCompletionTool, outcome: ToolOutcome }>> {
  // Results keep the order of the calls, whichever finishes first.
  return Promise.all(
    toolCalls.map(async (toolCall) => {
      const name = toolCall.function?.name
      const tool = tools.find(t => t.name === name)
      let outcome: ToolOutcome
      if (!tool) {
        const error = `Tool "${name}" not found`
        outcome = { content: `Tool execution error: ${error}`, error }
      }
      else if (tool.run) {
        outcome = await tool.run(toolCall.function.arguments, signal, runner, hooks)
      }
      else {
        outcome = { content: await tool.execute(toolCall.function.arguments, signal, runner, hooks) }
      }
      return { toolCall, outcome }
    }),
  )
}

export async function* agentLoop<T extends z.ZodTypeAny>(
  params: GenerateTextParams<T>,
  stepInvoker: StepInvoker,
): AsyncGenerator<StreamEvent, GenerateTextResult<unknown>> {
  const { model, tools, system, messages, fewShot, maxSteps = AGENT_LOOP_MAX_STEPS, prompt, output, hooks, signal, compact, resume } = params
  // A resumed run continues the saved conversation; system and few-shot come from the params again.
  const currentMessages: ChatMessage[] = buildMessage(prompt, system, resume ? applyResume(resume) : messages, fewShot)
  const currentTools: Tool[] = tools ? [...tools] : []
  const totalUsage: Usage = emptyUsage()
  const runner = new HookRunner()
  const stepRef: StepRef = { value: 0 }
  const compactMessage = compact
    ? createCompactMessage(typeof compact === 'object' ? compact : undefined)
    : null

  let currentModel = model
  let lastPromptTokens = 0
  const seenToolCallKeys = new Set<string>()
  let consecutiveDuplicateSteps = 0

  while (stepRef.value < maxSteps) {
    signal?.throwIfAborted()
    stepRef.value++
    yield { type: 'step', step: stepRef.value }

    if (compactMessage && compactMessage.shouldCompact(lastPromptTokens)) {
      runner.runBeforeMessageCompact(hooks, {
        promptTokens: lastPromptTokens,
        messages: [...currentMessages],
        threshold: compactMessage.threshold,
      })

      if (runner.stopped) {
        return { text: lastAssistantMsg(currentMessages), output: undefined, usage: totalUsage }
      }

      if (runner.skipped) {
        runner.resetSkip()
      }
      else {
        const messagesBefore = [...currentMessages]
        const compacted = await compactMessage.compact(currentMessages, signal)
        currentMessages.length = 0
        currentMessages.push(...compacted)
        runner.runAfterMessageCompact(hooks, {
          messagesBefore,
          messagesAfter: [...currentMessages],
          promptTokens: lastPromptTokens,
          threshold: compactMessage.threshold,
        })
        if (runner.stopped) {
          return { text: lastAssistantMsg(currentMessages), output: undefined, usage: totalUsage }
        }
      }
    }

    currentModel = runner.runBeforeStep(hooks, stepRef.value, currentMessages, currentTools, currentModel)

    if (runner.stopped) {
      return { text: lastAssistantMsg(currentMessages), output: undefined, usage: totalUsage }
    }

    try {
      const stepGen = stepInvoker(currentModel, {
        messages: currentMessages,
        tools: currentTools,
        signal,
      })

      let stepResult
      try {
        while (true) {
          const iterResult = await stepGen.next()
          if (iterResult.done) {
            stepResult = iterResult.value
            break
          }
          yield iterResult.value
        }
      } finally {
        await stepGen.return(undefined as never)
      }

      mergeUsage(totalUsage, stepResult.usage)
      lastPromptTokens = stepResult.usage.prompt_tokens

      currentMessages.push(stepResult.assistantMessage)

      if (stepResult.toolCalls.length > 0 && currentTools.length > 0) {
        yield { type: 'tool-call', step: stepRef.value, toolCalls: stepResult.toolCalls }

        // --- Tool call deduplication: detect and break infinite loops ---
        const currentStepKeys = stepResult.toolCalls.map(tc => makeToolCallKey(tc))
        const allDuplicate = currentStepKeys.every(key => seenToolCallKeys.has(key))

        if (allDuplicate) {
          consecutiveDuplicateSteps++
        } else {
          consecutiveDuplicateSteps = 0
        }

        currentStepKeys.forEach(key => seenToolCallKeys.add(key))

        if (consecutiveDuplicateSteps >= 2) {
          // Model is stuck repeating the same tool calls — force stop
          for (const toolCall of stepResult.toolCalls) {
            const error = `重复调用被阻止: ${toolCall.function?.name} 已使用相同参数执行过。你已经拥有所需信息，请直接基于已有结果给出最终回复，不要再重复调用相同的工具。`
            const content = JSON.stringify({ success: false, error })
            currentMessages.push({ role: 'tool', content, tool_call_id: toolCall.id })
            yield { type: 'tool-result', step: stepRef.value, toolCallId: toolCall.id, name: toolCall.function?.name ?? '', content, error }
          }
          return { text: lastAssistantMsg(currentMessages), output: undefined, usage: totalUsage }
        }

        const toolResults = await executeToolCalls(stepResult.toolCalls, currentTools, signal, runner, hooks)
        const pending: PendingToolCall[] = []
        for (const { toolCall, outcome } of toolResults) {
          const name = toolCall.function?.name ?? ''
          currentMessages.push({ role: 'tool', content: outcome.content, tool_call_id: toolCall.id })
          yield {
            type: 'tool-result',
            step: stepRef.value,
            toolCallId: toolCall.id,
            name,
            content: outcome.content,
            ...(outcome.data !== undefined ? { data: outcome.data } : {}),
            ...(outcome.error !== undefined ? { error: outcome.error } : {}),
            ...(outcome.suspension ? { suspended: true, payload: outcome.suspension.payload } : {}),
          }
          if (outcome.suspension) {
            pending.push({ toolCallId: toolCall.id, name, arguments: toolCall.function?.arguments ?? '', payload: outcome.suspension.payload })
          }
        }

        runner.runAfterStep(hooks, {
          step: stepRef.value,
          type: 'tool',
          toolCalls: stepResult.toolCalls,
          text: stepResult.text || undefined,
          reasoningContent: stepResult.reasoningContent,
          usage: stepResult.usage,
        })
        if (runner.stopped) {
          return { text: lastAssistantMsg(currentMessages), output: undefined, usage: totalUsage }
        }
        if (pending.length > 0) {
          // Stop without another model call; the caller resumes with the real results.
          const suspended = { messages: conversationOf(currentMessages), pending }
          yield { type: 'suspend', step: stepRef.value, state: suspended }
          return { text: lastAssistantMsg(currentMessages), output: undefined, usage: totalUsage, suspended }
        }
        continue
      }

      if (output) {
        const structuredData = await generateStructuredOutput({
          model: currentModel,
          conversationMessages: currentMessages,
          schema: output.schema,
          stepRef,
          hooks,
          tools: currentTools,
          hookCtx: runner.hookCtx,
          signal,
        })
        if (runner.stopped) {
          return { text: lastAssistantMsg(currentMessages), output: undefined, usage: totalUsage }
        }
        return {
          text: lastAssistantMsg(currentMessages),
          output: structuredData,
          usage: totalUsage,
        }
      }

      runner.runAfterStep(hooks, {
        step: stepRef.value,
        type: 'text',
        text: stepResult.text,
        reasoningContent: stepResult.reasoningContent,
        usage: stepResult.usage,
      })
      if (runner.stopped) {
        return { text: lastAssistantMsg(currentMessages), output: undefined, usage: totalUsage }
      }

      return { text: stepResult.text, output: undefined, usage: totalUsage }
    }
    catch (error) {
      signal?.throwIfAborted()
      if (error instanceof StopLoop) {
        return { text: lastAssistantMsg(currentMessages), output: undefined, usage: totalUsage }
      }
      const agentError = classifyError(error, stepRef.value)
      const result = await runner.runOnError(hooks, agentError)
      if (runner.stopped) {
        return { text: lastAssistantMsg(currentMessages), output: undefined, usage: totalUsage }
      }
      if (result) {
        throw result
      }
    }
  }

  const maxStepsError = new AgentError({
    message: `Max steps (${maxSteps}) reached without getting a final response`,
    type: 'max_steps',
    step: stepRef.value,
    retryable: false,
  })

  const result = await runner.runOnError(hooks, maxStepsError)
  if (runner.stopped) {
    return { text: lastAssistantMsg(currentMessages), output: undefined, usage: totalUsage }
  }
  throw result
}
