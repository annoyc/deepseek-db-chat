import type { ConsistentTools, NonStrictTool, StrictTool, StrictToolDefinition, ToolCall, ToolChoice, ToolDefinition } from './types'
import type { HookRunner } from '@/core/generate/generate-utils'
import type { GenerateTextHooks } from '@/core/generate/types'
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

  const wrappedExecute = async (args: string, signal?: AbortSignal, runner?: HookRunner, hooks?: GenerateTextHooks): Promise<string> => {
    const result = await parseAndValidate(args, schema)

    if (!result.success) {
      if (result.type === 'schema_validation_error') {
        const messages = result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join(', ')
        return JSON.stringify({ success: false, error: `Invalid arguments: ${messages}` })
      }
      return JSON.stringify({ success: false, error: `Failed to parse arguments: ${result.error.message}` })
    }

    try {
      const execResult = await withRetries(
        async (toolSignal) => execute(result.data, { signal: toolSignal }),
        retries,
        timeout,
        signal,
      )
      let data = serializeResult(execResult)
      if (compact) {
        try {
          const toolCompactConfig = typeof compact === 'object'
            ? compact
            : undefined
          const ct = createCompactTool(toolCompactConfig)

          if (runner && hooks) {
            runner.runBeforeToolCompact(hooks, {
              toolName: name,
              toolDescription: description,
              content: data,
              threshold: ct.threshold,
            })

            if (runner.stopped) {
              return JSON.stringify({ success: true, data })
            }

            if (runner.skipped) {
              runner.resetSkip()
            }
            else {
              const contentBefore = data
              data = await ct.compact(data, name, description, signal)
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
            data = await ct.compact(data, name, description, signal)
          }
        }
        catch (err) {
          signal?.throwIfAborted()
          console.warn('[tool] Compact failure (non-blocking):', err)
        }
      }
      return JSON.stringify({ success: true, data })
    }
    catch (err) {
      signal?.throwIfAborted()
      return JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return {
    ...config,
    parameters: jsonSchema,
    execute: (args: string, signal?: AbortSignal, runner?: HookRunner, hooks?: GenerateTextHooks) => wrappedExecute(args, signal, runner, hooks),
  }
}

export type Tool = StrictTool | NonStrictTool
export type { ConsistentTools, NonStrictTool, StrictTool }

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
