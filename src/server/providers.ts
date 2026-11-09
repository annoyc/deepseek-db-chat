import type { ProviderModel, ThinkingStyle } from '@/core/provider'
import { z } from 'zod'
import { apiRequest } from '@/core/client/request'
import { ApiRequestError } from '@/core/client/errors'
import { tool } from '@/core/tool'
import { tryJsonParse } from '@/core/utils/json-parse'
import { getModelsEndpoint } from '@/core/client/endpoints'
import type { ListModelsResponse } from '@/core/model/types'
import { findProvider, getProviderList, getServerApiKey, getServerBaseURL, isCustomProviderId } from '@/core/provider'
import { decrypt } from '@/server/crypto'
import { createRequestModel, resolveAiTarget, type AiRequestConfig } from '@/server/ai-credentials'

export interface ServerProviderInfo {
  id: string
  name: string
  models: ProviderModel[]
  defaultModel: string
  thinkingStyle: ThinkingStyle
  /** Public default endpoint, shown as a placeholder. Env overrides stay private. */
  defaultBaseURL?: string
  hasEnvKey: boolean
}

export function describeServerProviders(): ServerProviderInfo[] {
  return getProviderList().map(p => ({
    id: p.id,
    name: p.name,
    models: p.models,
    defaultModel: p.defaultModel,
    thinkingStyle: p.thinkingStyle,
    defaultBaseURL: getServerBaseURL(p) === p.defaultBaseURL ? p.defaultBaseURL : undefined,
    hasEnvKey: !!getServerApiKey(p),
  }))
}

/** Whether a server key exists, and whether an encrypted browser copy is a (legacy) server key. */
export function checkServerKey(providerId: string, encryptedApiKey?: string): { hasEnvKey: boolean; isServerKey: boolean } {
  if (isCustomProviderId(providerId)) return { hasEnvKey: false, isServerKey: false }
  const provider = findProvider(providerId)
  const key = provider ? getServerApiKey(provider) : ''
  if (!key) return { hasEnvKey: false, isServerKey: false }
  return { hasEnvKey: true, isServerKey: !!encryptedApiKey && decrypt(encryptedApiKey) === key }
}

const MAX_MODELS = 500

export async function fetchProviderModels(request: AiRequestConfig, signal?: AbortSignal): Promise<string[]> {
  const target = resolveAiTarget(request)
  const response = await apiRequest<ListModelsResponse>(getModelsEndpoint(target.baseURL), target.apiKey, {}, 15_000, 'GET', signal)
  if (!Array.isArray(response?.data)) throw new Error('该服务未返回模型列表，请手动填写模型 ID')
  const ids = response.data
    .map(item => (typeof item?.id === 'string' ? item.id.trim() : ''))
    .filter(id => id && id.length <= 200)
  return [...new Set(ids)].sort().slice(0, MAX_MODELS)
}

export type ConnectionCheckKey = 'tools' | 'json' | 'thinking'

export interface ConnectionCheck {
  key: ConnectionCheckKey
  label: string
  status: 'pass' | 'fail' | 'skip'
  detail?: string
  latencyMs?: number
}

export interface ConnectionTestResult {
  ok: boolean
  model: string
  checks: ConnectionCheck[]
}

const PROBE_TOOL_NAME = 'report_status'

const probeTool = tool({
  name: PROBE_TOOL_NAME,
  description: 'Report the connection status. You must call this tool exactly once.',
  schema: z.object({ status: z.string().describe('Always the string "ok"') }),
  execute: () => 'ok',
})

const CHECK_LABELS: Record<ConnectionCheckKey, string> = {
  tools: '流式输出与工具调用',
  json: 'JSON 输出',
  thinking: '思考参数',
}

function describeError(error: unknown): string {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) return '请求超时'
  if (error instanceof ApiRequestError) {
    if (error.status === 401 || error.status === 403) return `鉴权失败（${error.status}），请检查 API Key`
    if (error.status === 404) return '接口不存在（404），请检查 Base URL 与模型 ID'
  }
  const message = error instanceof Error ? error.message : String(error)
  return message.length > 300 ? `${message.slice(0, 300)}…` : message
}

/** Errors that make every later probe pointless (bad key, bad URL, unreachable host). */
function isFatal(error: unknown): boolean {
  if (error instanceof ApiRequestError) return [401, 403, 404].includes(error.status)
  return !(error instanceof Error && error.message.startsWith('API error'))
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; latencyMs: number }> {
  const started = performance.now()
  const value = await fn()
  return { value, latencyMs: Math.round(performance.now() - started) }
}

/**
 * Probe the request shapes the app depends on: a streamed chat completion with
 * a tool call (the agent loop), `response_format: json_object` (intent routing,
 * structured output), and — when the provider sends one — the thinking parameter.
 */
export async function testProviderConnection(request: AiRequestConfig & { model: string }, signal?: AbortSignal): Promise<ConnectionTestResult> {
  const base = createRequestModel(request, {
    thinking: { type: 'disabled' },
    temperature: 0,
    maxTokens: 1024,
    timeout: 30_000,
    idleTimeout: 30_000,
    streamDeadline: 60_000,
    maxRetries: 0,
  })
  const model = base.config.model
  const checks: ConnectionCheck[] = []
  let fatal: string | undefined

  const run = async (key: ConnectionCheckKey, probe: () => Promise<string | null>) => {
    if (fatal) {
      checks.push({ key, label: CHECK_LABELS[key], status: 'skip', detail: '前一项请求失败，已跳过' })
      return
    }
    try {
      const { value: failure, latencyMs } = await timed(probe)
      checks.push(failure
        ? { key, label: CHECK_LABELS[key], status: 'fail', detail: failure, latencyMs }
        : { key, label: CHECK_LABELS[key], status: 'pass', latencyMs })
    } catch (error) {
      signal?.throwIfAborted()
      const detail = describeError(error)
      if (isFatal(error)) fatal = detail
      checks.push({ key, label: CHECK_LABELS[key], status: 'fail', detail })
    }
  }

  await run('tools', async () => {
    const stream = base.withConfig({ streamOptions: { include_usage: true } }).invokeStream({
      messages: [
        { role: 'system', content: 'You are a connectivity probe. Call the provided tool and nothing else.' },
        { role: 'user', content: `Call the ${PROBE_TOOL_NAME} tool with status "ok".` },
      ],
      tools: [probeTool],
      signal,
    })
    const names: string[] = []
    let chunks = 0
    for await (const chunk of stream) {
      chunks++
      for (const call of chunk.choices[0]?.delta?.tool_calls ?? []) {
        names[call.index] = (names[call.index] ?? '') + (call.function?.name ?? '')
      }
    }
    if (chunks === 0) return '流式响应为空'
    if (!names.includes(PROBE_TOOL_NAME)) return '模型没有调用工具，可能不支持 function calling；本应用的查询依赖工具调用'
    return null
  })

  await run('json', async () => {
    const requestJson = async () => {
      const response = await base.invoke({
        messages: [
          { role: 'system', content: 'Reply with a JSON object only.' },
          { role: 'user', content: 'Return {"ok": true} as JSON.' },
        ],
        response_format: { type: 'json_object' },
        signal,
      })
      return response.choices[0]?.message.content?.trim() ?? ''
    }
    // JSON mode can occasionally return empty content (documented by DeepSeek); the
    // app tolerates that, so one empty reply is retried rather than reported.
    let content = await requestJson()
    if (!content) content = await requestJson()
    if (!content) return '模型连续两次返回空内容；JSON 输出偶尔为空时应用会降级处理，若频繁出现请换用其他模型'
    // Parse exactly as the app does (with jsonrepair fallback), so the probe never fails on output the app accepts.
    const parsed = await tryJsonParse(content.replace(/^```(?:json)?\s*|\s*```$/g, ''))
    if (parsed.success && parsed.data && typeof parsed.data === 'object') return null
    const preview = content.length > 60 ? `${content.slice(0, 60)}…` : content
    return `返回内容不是 JSON 对象：「${preview}」`
  })

  if (base.config.thinkingStyle !== 'none') {
    await run('thinking', async () => {
      await base.withConfig({ thinking: { type: 'enabled' }, maxTokens: 64 }).invoke({
        messages: [{ role: 'user', content: 'Reply with "ok".' }],
        signal,
      })
      return null
    })
    const thinking = checks.find(c => c.key === 'thinking')
    if (thinking?.status === 'fail' && !fatal) {
      thinking.detail = `${thinking.detail}。服务可能不接受该思考参数，可将「思考参数」改为「不发送」`
    }
  }

  return { ok: checks.every(c => c.status === 'pass'), model, checks }
}
