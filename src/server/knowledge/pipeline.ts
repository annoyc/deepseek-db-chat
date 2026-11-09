import type {
  KnowledgeAnswerMode,
  KnowledgeCitation,
  KnowledgeHistoryTurn,
  KnowledgeStreamChunk,
  KnowledgeToolStatus,
  KnowledgeUserChunkCandidate,
  KnowledgeWebResult,
} from '@/lib/knowledge-types'
import { maskPII } from '@/lib/masking'
import { checkCitations } from './citations'
import type { Embedder } from './embedding'
import { createUploadKnowledgeBase, type KnowledgeBase } from './knowledge-base'
import { buildAnswerMessages } from './prompt'
import { analyzeQuery, retrievalQueries, type KnowledgeChatModel, type QueryAnalysis } from './query-analysis'
import { retrieve, type RetrievalHit } from './retriever'
import { beijingDate, documentStatus } from './validity'
import type { WebSearch } from './web-search'

export interface KnowledgePipelineInput {
  message: string
  history: KnowledgeHistoryTurn[]
  useWebSearch: boolean
  /** false: answer strictly from retrieved provisions; true: general knowledge may supplement them. */
  useBaseModel: boolean
  answerMode: KnowledgeAnswerMode
  /** Uploaded-document chunks the browser pre-selected, best first. */
  userChunks?: KnowledgeUserChunkCandidate[]
}

export interface KnowledgePipelineDeps {
  knowledgeBase: () => Promise<KnowledgeBase>
  chatModel: (options: { purpose: 'analysis' | 'answer'; thinking: boolean }) => KnowledgeChatModel
  /** Must embed with the model recorded in the index; null/undefined means keyword-only retrieval. */
  embedder?: Embedder | null
  webSearch?: WebSearch | null
  minSimilarity?: number
  now?: () => Date
}

const TOP_K: Record<KnowledgeAnswerMode, number> = { concise: 4, standard: 6, deep: 10 }

export const NO_EVIDENCE_ANSWER = '知识库中未找到与该问题相关的规则条款。可以换一种说法，或开启“通用知识”后重试。'

type ToolChunk = Extract<KnowledgeStreamChunk, { type: 'tool' }>

function tool(id: string, title: string, status: KnowledgeToolStatus, extra: Partial<ToolChunk> = {}): ToolChunk {
  return { type: 'tool', id, name: id, title, status, ...extra }
}

function elapsed(start: number): number {
  return Math.round(performance.now() - start)
}

export const UPLOAD_STATUS_LABEL = '我上传的文档（未核验时效）'

function toCitation(hit: RetrievalHit, ref: number, today: string): KnowledgeCitation {
  const { status, label } = hit.source === 'upload'
    ? { status: 'unverified' as const, label: UPLOAD_STATUS_LABEL }
    : documentStatus(hit.doc, today)
  return {
    ref: String(ref),
    chunkId: hit.chunk.id,
    docTitle: hit.doc.title,
    docNo: hit.doc.docNo,
    locator: hit.chunk.label,
    headings: hit.chunk.headings,
    text: hit.chunk.text,
    status,
    statusLabel: label,
    sourceUrl: hit.doc.sourceUrl,
    retrievers: [...(hit.bm25Rank ? ['keyword' as const] : []), ...(hit.denseRank ? ['vector' as const] : [])],
    source: hit.source,
  }
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted) || (error instanceof Error && error.name === 'AbortError')
}

/**
 * In-process RAG: guardrail → query rewrite → hybrid retrieval → optional web search
 * → cited answer → citation check. Emits the same stream protocol the external
 * knowledge service used, so the client renders each stage as a tool-chain step.
 */
export async function* runKnowledgePipeline(
  input: KnowledgePipelineInput,
  deps: KnowledgePipelineDeps,
  signal?: AbortSignal,
): AsyncGenerator<KnowledgeStreamChunk> {
  const today = beijingDate(deps.now?.() ?? new Date())

  // 1. Guardrail: everything sent to model, embedding and search APIs is masked first.
  let start = performance.now()
  yield tool('guardrail', '安全检查与脱敏', 'running')
  const question = maskPII(input.message)
  const history = input.history.map(turn => ({ role: turn.role, content: maskPII(turn.content) }))
  const maskedCount = [input.message, ...input.history.map(t => t.content)]
    .filter((text, i) => text !== (i === 0 ? question : history[i - 1].content)).length
  yield tool('guardrail', '安全检查与脱敏', 'done', {
    output: maskedCount ? `已对 ${maskedCount} 条消息中的敏感信息脱敏` : '未发现需要脱敏的敏感信息',
    durationMs: elapsed(start),
  })

  // 2. Rewrite follow-ups into standalone questions and expand terms (skipped for a
  //    first concise question, where the extra model call costs more than it adds).
  let analysis: QueryAnalysis | undefined
  if (history.length > 0 || input.answerMode !== 'concise') {
    start = performance.now()
    yield tool('query_rewrite', '问题改写与拆解', 'running', { detail: question })
    try {
      analysis = await analyzeQuery(deps.chatModel({ purpose: 'analysis', thinking: false }), question, history, signal)
      const rewritten = analysis.standalone !== question ? `改写为：${analysis.standalone}` : '问题已完整，无需改写'
      yield tool('query_rewrite', '问题改写与拆解', 'done', {
        output: [rewritten, analysis.subQuestions.length ? `拆解出 ${analysis.subQuestions.length} 个子问题` : '']
          .filter(Boolean).join('；'),
        detail: analysis.keywords.length ? `检索术语：${analysis.keywords.join('、')}` : question,
        durationMs: elapsed(start),
      })
      if (analysis.subQuestions.length) yield { type: 'evidence', subQuestions: analysis.subQuestions }
    } catch (error) {
      if (isAbort(error, signal)) throw error
      yield tool('query_rewrite', '问题改写与拆解', 'done', { output: '改写不可用，按原问题检索', durationMs: elapsed(start) })
    }
  }

  // 3. Hybrid retrieval over the knowledge base.
  start = performance.now()
  const queries = retrievalQueries(question, analysis)
  yield tool('kb_retrieve', '知识库检索', 'running', { detail: queries.join('\n') })
  const kb = await deps.knowledgeBase()
  let queryVectors: Float32Array[] | undefined
  let vectorNote = ''
  if (kb.embedding && deps.embedder) {
    try {
      queryVectors = await deps.embedder(queries, signal)
    } catch (error) {
      if (isAbort(error, signal)) throw error
      vectorNote = '；向量检索失败，已降级为关键词检索'
    }
  }
  const userChunks = input.userChunks ?? []
  const uploads = userChunks.length ? createUploadKnowledgeBase(userChunks, kb.embedding) : undefined
  const hits = retrieve(uploads ? [kb, uploads] : kb, queries, {
    topK: TOP_K[input.answerMode],
    queryVectors,
    minSimilarity: deps.minSimilarity,
    // The browser ranked these over all uploaded chunks, with corpus-wide term statistics.
    extraRankings: uploads ? [userChunks.map(c => c.id)] : [],
  })
  const citations = hits.map((hit, i) => toCitation(hit, i + 1, today))
  const documents = new Set(hits.map(hit => hit.doc.id)).size
  const uploadHits = hits.filter(hit => hit.source === 'upload').length
  yield tool('kb_retrieve', '知识库检索', 'done', {
    output: hits.length
      ? `${queryVectors ? '关键词 + 向量' : '关键词'}检索，RRF 融合后取 ${hits.length} 条，来自 ${documents} 份文件${uploadHits ? `（含我的文档 ${uploadHits} 条）` : ''}${vectorNote}`
      : `未检索到相关条款${vectorNote}`,
    detail: queries.join('\n'),
    durationMs: elapsed(start),
  })
  yield { type: 'evidence', citations }

  // 4. Optional web search; only when general knowledge is allowed (as in the old backend).
  let webResults: KnowledgeWebResult[] = []
  if (input.useWebSearch && input.useBaseModel) {
    start = performance.now()
    yield tool('web_search', '联网搜索（博查）', 'running')
    if (!deps.webSearch) {
      yield tool('web_search', '联网搜索（博查）', 'error', { output: '服务器未配置联网搜索', durationMs: elapsed(start) })
    } else {
      try {
        webResults = await deps.webSearch(analysis?.standalone ?? question, signal)
        yield tool('web_search', '联网搜索（博查）', 'done', { output: `命中 ${webResults.length} 条网页结果`, durationMs: elapsed(start) })
        yield { type: 'evidence', webResults }
      } catch (error) {
        if (isAbort(error, signal)) throw error
        yield tool('web_search', '联网搜索（博查）', 'error', { output: '联网搜索失败，仅使用知识库回答', durationMs: elapsed(start) })
      }
    }
  }

  // 5. Strict mode with nothing retrieved: refuse without spending a model call.
  if (!citations.length && !webResults.length && !input.useBaseModel) {
    yield { type: 'text', content: NO_EVIDENCE_ANSWER }
    return
  }

  // 6. Answer generation, streamed.
  start = performance.now()
  yield tool('synthesis', '生成回答', 'running')
  const thinking = input.answerMode === 'deep'
  const model = deps.chatModel({ purpose: 'answer', thinking })
  const messages = buildAnswerMessages({ question, history, citations, webResults, answerMode: input.answerMode, useBaseModel: input.useBaseModel, today })
  let answer = ''
  let announcedThinking = false
  for await (const chunk of model.invokeStream({ messages, signal })) {
    const delta = chunk.choices[0]?.delta
    if (delta?.reasoning_content && !announcedThinking && !answer) {
      announcedThinking = true
      yield { type: 'status', message: '深度思考中...' }
    }
    if (delta?.content) {
      answer += delta.content
      yield { type: 'text', content: delta.content }
    }
  }
  if (!answer.trim()) throw new Error('模型未返回回答')
  yield tool('synthesis', '生成回答', 'done', { output: `${answer.length} 字`, durationMs: elapsed(start) })

  // 7. Citation check: every [n] must point at a provided source.
  start = performance.now()
  const available = [...citations.map(c => c.ref), ...webResults.map((_, i) => `W${i + 1}`)]
  const check = checkCitations(answer, available)
  const cited = new Set(check.cited)
  const checked = citations.map(c => ({ ...c, cited: cited.has(c.ref) }))
  const citedExpired = checked.some(c => c.cited && (c.status === 'expired' || c.status === 'pending'))
  const citedUploads = checked.some(c => c.cited && c.source === 'upload')
  let output: string
  if (check.invalid.length) output = `${check.invalid.map(ref => `[${ref}]`).join('')} 没有对应的来源`
  else if (!check.cited.length) output = available.length ? '回答没有标注来源' : '无可引用的来源'
  else output = `引用 ${check.cited.length} 处来源，均可对应${citedExpired ? '；含不在有效期内的文件' : ''}${citedUploads ? '；含我上传的文档' : ''}`
  yield tool('citation_check', '引用校验', check.invalid.length ? 'error' : 'done', { output, durationMs: elapsed(start) })
  yield { type: 'evidence', citations: checked }
}
