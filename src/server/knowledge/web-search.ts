import { abortable, createAbortScope } from '@/core/client/lifecycle'
import { readResponseJson } from '@/core/client/response-body'
import type { KnowledgeWebResult } from '@/lib/knowledge-types'

export type WebSearch = (query: string, signal?: AbortSignal) => Promise<KnowledgeWebResult[]>

interface BochaPage {
  name?: string
  url?: string
  snippet?: string
  summary?: string
  siteName?: string
  datePublished?: string
}

interface BochaResponse {
  code?: number
  msg?: string
  data?: { webPages?: { value?: BochaPage[] } }
}

/** Bocha (博查) Web Search, Bing-compatible response shape. Null when BOCHA_API_KEY is unset. */
export function createBochaWebSearch(env: NodeJS.ProcessEnv = process.env): WebSearch | null {
  const apiKey = env.BOCHA_API_KEY?.trim()
  if (!apiKey) return null
  const base = (env.BOCHA_API_BASE_URL?.trim() || 'https://api.bochaai.com/v1').replace(/\/+$/, '')
  const count = Math.min(Math.max(Number(env.BOCHA_RESULT_COUNT) || 6, 1), 20)
  return async (query, signal) => {
    const scope = createAbortScope(signal, 15000)
    try {
      const response = await abortable(fetch(`${base}/web-search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ query, summary: true, freshness: 'noLimit', count }),
        signal: scope.signal,
        redirect: 'error',
      }), scope.signal)
      const body = await readResponseJson<BochaResponse>(response, scope.signal)
      if (!response.ok || (body.code !== undefined && body.code !== 200)) {
        throw new Error(`联网搜索返回 ${body.code ?? response.status}`)
      }
      return (body.data?.webPages?.value ?? [])
        .filter((page): page is BochaPage & { url: string } => typeof page.url === 'string' && /^https?:\/\//.test(page.url))
        .slice(0, count)
        .map(page => ({
          title: page.name?.trim() || page.url,
          url: page.url,
          snippet: (page.summary || page.snippet || '').trim().slice(0, 600) || undefined,
          site_name: page.siteName || undefined,
        }))
    } finally {
      scope.abort()
      scope.dispose()
    }
  }
}
