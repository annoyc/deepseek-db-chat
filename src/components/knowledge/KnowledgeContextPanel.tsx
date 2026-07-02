import { FileText, Globe2, Workflow, X } from 'lucide-react'
import type { KnowledgeMessage } from '@/lib/knowledge-types'
import { ToolChainTimeline } from './ToolChainTimeline'

interface KnowledgeContextPanelProps {
  message: KnowledgeMessage | null
  onClose: () => void
}

export function KnowledgeContextPanel({ message, onClose }: KnowledgeContextPanelProps) {
  const evidence = message?.evidence
  const toolSteps = evidence?.toolSteps ?? []
  const memorySnippets = evidence?.memorySnippets ?? []
  const webResults = evidence?.webResults ?? []
  const subQuestions = evidence?.subQuestions ?? []

  return (
    <aside className="app-sidebar subtle-scrollbar h-screen w-[360px] flex-shrink-0 overflow-y-auto border-l border-sidebar-border p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-stone-950">证据面板</div>
          <div className="text-xs text-stone-500">当前回答的过程与证据</div>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-2 text-stone-400 transition-colors hover:bg-white/75 hover:text-stone-700"
          title="关闭上下文面板"
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
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-400">记忆模型片段</div>
            <div className="space-y-3">
              {memorySnippets.map((snippet, index) => (
                <div key={`${snippet.question}-${index}`} className="rounded-lg border border-stone-200/70 bg-stone-50 p-3">
                  <div className="mb-1 text-xs font-medium text-primary">Q: {snippet.question}</div>
                  <div className="subtle-scrollbar max-h-32 overflow-y-auto text-sm leading-6 text-stone-600">{snippet.answer}</div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-stone-400">暂无记忆模型证据。</p>
        )}
      </section>

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
                <div className="text-sm font-medium text-stone-900">[{index + 1}] {result.title || result.url}</div>
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
