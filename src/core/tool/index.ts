import type { ConsistentTools, NonStrictTool, StrictTool, StrictToolDefinition, ToolCall, ToolChoice, ToolDefinition, ToolOutcome } from './types'
import type { HookRunner } from '@/core/generate/generate-utils'
import type { GenerateTextHooks } from '@/core/generate/types'
import type { DeepSeekModel } from '@/core/model'
import { z } from 'zod'
import { createCompactTool } from '@/core/context/compact'
import { parseAndValidate } from '@/core/utils/json-parse'
import { abortable, createAbortScope } from '@/core/client/lifecycle'

async function withRetries<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  maxRetries: number,
  timeoutMs?: number,
  signal?: AbortSignal,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted()
    const scope = createAbortScope(signal, timeoutMs)
    try {
      return await abortable(fn(scope.signal), scope.signal)
    } catch (error) {
      signal?.throwIfAborted()
      // A timed-out operation may still be finishing: never replay it automatically.
      if (scope.signal.aborted || attempt >= maxRetries) throw error
    } finally {
      scope.abort()
      scope.dispose()
    }
  }
}

const SUSPEND = Symbol.for('agent-loop.tool.suspend')

export interface ToolSuspension {
  [SUSPEND]: true
  payload: unknown
  message: string
}

/**
 * Return this from a tool's `execute` to pause the agent run until something
 * outside the loop (a user confirmation, an approval, a slow job) supplies the
 * real result. The loop finishes the step, emits a `suspend` event carrying a
 * serializable state, and stops without calling the model again.
 *
 * @param payload Data for whoever handles the suspension, e.g. what to show the user.
 * @param message Placeholder the model sees if the run is resumed without a result for this call.
 */
export function suspend(payload: unknown, message = 'Not executed: waiting for user input.'): ToolSuspension {
  return { [SUSPEND]: true, payload, message }
}

function isSuspension(value: unknown): value is ToolSuspension {
  return typeof value === 'object' && value !== null && (value as Record<symbol, unknown>)[SUSPEND] === true
}

function failure(error: string): ToolOutcome {
  return { content: JSON.stringify({ success: false, error }), error }
}

export function serializeResult(result: unknown): string {
  if (typeof result === 'string') {
    return result
  }
  if (result === null || result === undefined) {
    return String(result)
  }
  try {
    return JSON.stringify(result)
  }
  catch (err) {
    console.warn('[tool] JSON.stringify failed, falling back to String():', err)
    return String(result)
  }
}

export function tool<T extends z.ZodObject>(config: StrictToolDefinition<T>): StrictTool
export function tool<T extends z.ZodObject>(config: ToolDefinition<T, false | undefined>): NonStrictTool
export function tool(config: any) {
  const { schema, execute, compact, name, description, timeout = 60000, retries = 0 } = config
  const jsonSchema = z.toJSONSchema(schema)
  // One compactor per tool definition: its settings and cache are not shared.
  const compactor = compact ? createCompactTool(typeof compact === 'object' ? compact : undefined) : null

  const run = async (args: string, signal?: AbortSignal, runner?: HookRunner, hooks?: GenerateTextHooks, model?: DeepSeekModel): Promise<ToolOutcome> => {
    const result = await parseAndValidate(args, schema)

    if (!result.success) {
      if (result.type === 'schema_validation_error') {
        const messages = result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join(', ')
        return failure(`Invalid arguments: ${messages}`)
      }
      return failure(`Failed to parse arguments: ${result.error.message}`)
    }

    try {
      const execResult = await withRetries(
        async (toolSignal) => execute(result.data, { signal: toolSignal }),
        retries,
        timeout,
        signal,
      )
      if (isSuspension(execResult)) {
        return { ...failure(execResult.message), error: undefined, suspension: { payload: execResult.payload } }
      }
      let data = serializeResult(execResult)
      if (compactor) {
        try {
          const ct = compactor

          if (runner && hooks) {
            runner.runBeforeToolCompact(hooks, {
              toolName: name,
              toolDescription: description,
              content: data,
              threshold: ct.threshold,
            })

            if (runner.stopped) {
              return { content: JSON.stringify({ success: true, data }), data }
            }

            if (runner.skipped) {
              runner.resetSkip()
            }
            else {
              const contentBefore = data
              data = await ct.compact(data, name, description, signal, model)
              runner.runAfterToolCompact(hooks, {
                toolName: name,
                toolDescription: description,
                contentBefore,
                contentAfter: data,
                threshold: ct.threshold,
              })
            }
          }
          else {
            data = await ct.compact(data, name, description, signal, model)
          }
        }
        catch (err) {
          signal?.throwIfAborted()
          console.warn('[tool] Compact failure (non-blocking):', err)
        }
      }
      return { content: JSON.stringify({ success: true, data }), data }
    }
    catch (err) {
      signal?.throwIfAborted()
      return failure(err instanceof Error ? err.message : String(err))
    }
  }

  return {
    ...config,
    parameters: jsonSchema,
    run,
    execute: async (args: string, signal?: AbortSignal, runner?: HookRunner, hooks?: GenerateTextHooks, model?: DeepSeekModel) => (await run(args, signal, runner, hooks, model)).content,
  }
}

export type Tool = StrictTool | NonStrictTool
export type { ConsistentTools, NonStrictTool, StrictTool, ToolOutcome }

export function validateToolConsistency(tools: Tool[]): void {
  const strictCount = tools.filter(t => t.strict === true).length
  if (strictCount > 0 && strictCount < tools.length) {
    throw new Error(
      'When using strict mode, all tools must have strict: true. '
      + 'Either set strict: true on all tools, or use createModel({ strict: true }) to enable strict mode globally.',
    )
  }
}

export function buildToolParameters(tools: Tool[], modelStrict?: boolean) {
  if (tools.length === 0) {
    return {
      toolParameters: undefined,
      toolChoice: undefined,
    }
  }
  const useStrict = modelStrict || tools.some(t => t.strict === true)
  const toolParameters: ToolCall[] = []
  let toolChoice: ToolChoice | undefined
  const requiredTools: string[] = []
  for (const t of tools) {
    toolParameters.push({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        ...(useStrict ? { strict: true } : {}),
        parameters: t.parameters,
      },
    })
    if (t.required) {
      requiredTools.push(t.name)
    }
  }
  if (requiredTools.length === 1) {
    toolChoice = {
      type: 'function',
      function: { name: requiredTools[0] },
    }
  }
  else if (requiredTools.length > 1) {
    toolChoice = 'required'
  }
  return {
    toolParameters: toolParameters.length > 0 ? toolParameters : undefined,
    toolChoice,
  }
}
