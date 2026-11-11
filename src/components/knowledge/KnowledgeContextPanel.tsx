import { ExternalLink, FileText, Globe2, ScrollText, Workflow, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { KnowledgeCitation, KnowledgeMessage } from '@/lib/knowledge-types'
import { ToolChainTimeline } from './ToolChainTimeline'

function CitationCard({ citation }: { citation: KnowledgeCitation }) {
  const uncited = citation.cited === false
  return (
    <div className={cn('rounded-lg border border-stone-200/70 bg-stone-50 p-3', uncited && 'opacity-60')}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex-shrink-0 rounded bg-primary/10 px-1.5 text-xs font-semibold text-primary">[{citation.ref}]</span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-stone-900">
            《{citation.docTitle}》{citation.locator}
          </div>
          {citation.headings.length > 0 && (
            <div className="mt-0.5 truncate text-xs text-stone-400">{citation.headings.join(' › ')}</div>
          )}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
        <span
          className={cn(
            'rounded-full px-1.5 py-0.5',
            citation.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800',
          )}
        >
          {citation.statusLabel}
        </span>
        {citation.cited && <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-primary">已引用</span>}
        {citation.retrievers.map((retriever) => (
          <span key={retriever} className="rounded-full bg-stone-100 px-1.5 py-0.5 text-stone-500">
            {retriever === 'keyword' ? '关键词' : '向量'}
          </span>
        ))}
        {citation.sourceUrl && (
          <a
            href={citation.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="ml-auto flex items-center gap-0.5 text-stone-500 hover:text-primary"
          >
            原文
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
      <div className="subtle-scrollbar mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-stone-600">
        {citation.text}
      </div>
    </div>
  )
}

interface KnowledgeContextPanelProps {
  message: KnowledgeMessage | null
  width?: number
  /** Fill the containing overlay instead of using a fixed width. */
  fill?: boolean
  onClose: () => void
}

export function KnowledgeContextPanel({ message, width = 360, fill = false, onClose }: KnowledgeContextPanelProps) {
  const evidence = message?.evidence
  const toolSteps = evidence?.toolSteps ?? []
  const memorySnippets = evidence?.memorySnippets ?? []
  const webResults = evidence?.webResults ?? []
  const subQuestions = evidence?.subQuestions ?? []
  // Answers from the local knowledge base carry citations; remote-backend answers do not.
  const citations = evidence?.citations
  const showQaEvidence = citations === undefined || subQuestions.length > 0 || memorySnippets.length > 0

  return (
    <aside
      className="app-sidebar subtle-scrollbar h-full flex-shrink-0 overflow-y-auto border-l border-sidebar-border p-4"
      style={fill ? undefined : { width }}
    >
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-stone-950">证据面板</div>
          <div className="text-xs text-stone-500">当前回答的过程与证据</div>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-2 text-stone-400 transition-colors hover:bg-white/75 hover:text-stone-700"
          title="关闭证据面板"
          aria-label="关闭证据面板"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <section className="mb-4 rounded-xl border border-stone-200/70 bg-white/78 p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-stone-800">
            <Workflow className="h-4 w-4 text-primary" />
            工具使用链
          </div>
          {toolSteps.length > 0 && (
            <span className="text-xs text-stone-400">
              {toolSteps.filter((s) => s.status !== 'running').length}/{toolSteps.length} 已完成
            </span>
          )}
        </div>
        {toolSteps.length > 0 ? (
          <ToolChainTimeline steps={toolSteps} />
        ) : (
          <p className="text-sm text-stone-400">步骤会随着任务执行逐步出现。</p>
        )}
      </section>

      {citations !== undefined && (
        <section className="mb-4 rounded-xl border border-stone-200/70 bg-white/78 p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-stone-800">
              <ScrollText className="h-4 w-4 text-primary" />
              引用条款
            </div>
            <span className="text-xs text-stone-400">
              {citations.some((c) => c.cited !== undefined)
                ? `已引用 ${citations.filter((c) => c.cited).length}/${citations.length}`
                : citations.length}
            </span>
          </div>
          {citations.length > 0 ? (
            <div className="space-y-3">
              {citations.map((citation) => <CitationCard key={citation.chunkId} citation={citation} />)}
            </div>
          ) : (
            <p className="text-sm text-stone-400">未检索到相关条款。</p>
          )}
        </section>
      )}

      {showQaEvidence && (
        <section className="mb-4 rounded-xl border border-stone-200/70 bg-white/78 p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-stone-800">
              <FileText className="h-4 w-4 text-primary" />
              Evidence
            </div>
            <span className="text-xs text-stone-400">{subQuestions.length + memorySnippets.length}</span>
          </div>

          {subQuestions.length > 0 && (
            <div className="mb-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-400">问题拆解</div>
              <div className="space-y-2">
                {subQuestions.map((question, index) => (
                  <div key={`${question}-${index}`} className="rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-700">
                    {question}
                  </div>
                ))}
              </div>
            </div>
          )}

          {memorySnippets.length > 0 ? (
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-400">历史问答片段</div>
              <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                历史问答片段，未核验原始依据。涉及交易规则时，请核对原文、适用地区及生效日期。
              </p>
              <div className="space-y-3">
                {memorySnippets.map((snippet, index) => (
                  <div key={`${snippet.question}-${index}`} className="rounded-lg border border-stone-200/70 bg-stone-50 p-3">
                    <div className="mb-1 text-xs font-medium text-primary">Q: {snippet.question}</div>
                    <div className="subtle-scrollbar max-h-32 overflow-y-auto text-sm leading-6 text-stone-600">{snippet.answer}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : citations === undefined ? (
            <p className="text-sm text-stone-400">暂无历史问答片段。</p>
          ) : null}
        </section>
      )}

      <section className="rounded-xl border border-stone-200/70 bg-white/78 p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-stone-800">
            <Globe2 className="h-4 w-4 text-primary" />
            Sources
          </div>
          <span className="text-xs text-stone-400">{webResults.length}</span>
        </div>

        {webResults.length > 0 ? (
          <div className="space-y-3">
            {webResults.map((result, index) => (
              <a
                key={`${result.url}-${index}`}
                href={result.url}
                target="_blank"
                rel="noreferrer"
                className="block rounded-lg border border-stone-200/70 bg-stone-50 p-3 transition-colors hover:border-primary/25 hover:bg-primary/5"
              >
                {/* Local answers cite web pages as [W1]…; the remote backend numbers them [1]…. */}
                <div className="text-sm font-medium text-stone-900">[{citations !== undefined ? 'W' : ''}{index + 1}] {result.title || result.url}</div>
                {result.site_name && <div className="mt-1 text-xs text-stone-400">{result.site_name}</div>}
                {result.snippet && <div className="mt-2 line-clamp-3 text-xs leading-5 text-stone-600">{result.snippet}</div>}
              </a>
            ))}
          </div>
        ) : (
          <p className="text-sm text-stone-400">没有联网来源，或本轮未开启联网搜索。</p>
        )}
      </section>
    </aside>
  )
}
