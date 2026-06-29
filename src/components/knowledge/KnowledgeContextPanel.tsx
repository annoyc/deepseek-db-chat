import { Check, ChevronDown, FileText, Globe2, ListChecks, X } from 'lucide-react'
import type { KnowledgeMessage } from '@/lib/knowledge-types'

interface KnowledgeContextPanelProps {
  message: KnowledgeMessage | null
  onClose: () => void
}

export function KnowledgeContextPanel({ message, onClose }: KnowledgeContextPanelProps) {
  const evidence = message?.evidence
  const progress = evidence?.progress ?? []
  const memorySnippets = evidence?.memorySnippets ?? []
  const webResults = evidence?.webResults ?? []
  const subQuestions = evidence?.subQuestions ?? []

  return (
    <aside className="h-screen w-[360px] flex-shrink-0 overflow-y-auto border-l border-gray-200 bg-white p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-gray-900">证据面板</div>
          <div className="text-xs text-gray-500">当前回答的过程与证据</div>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
          title="关闭上下文面板"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <section className="mb-4 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
            <ListChecks className="h-4 w-4 text-primary" />
            Progress
          </div>
          <ChevronDown className="h-4 w-4 text-gray-400" />
        </div>
        {progress.length > 0 ? (
          <div className="space-y-2">
            {progress.map((item, index) => (
              <div key={`${item}-${index}`} className="flex items-start gap-2 text-sm text-gray-600">
                <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-primary">
                  <Check className="h-3 w-3" />
                </span>
                <span>{item}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-400">步骤会随着任务执行逐步出现。</p>
        )}
      </section>

      <section className="mb-4 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
            <FileText className="h-4 w-4 text-primary" />
            Evidence
          </div>
          <span className="text-xs text-gray-400">{subQuestions.length + memorySnippets.length}</span>
        </div>

        {subQuestions.length > 0 && (
          <div className="mb-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">问题拆解</div>
            <div className="space-y-2">
              {subQuestions.map((question, index) => (
                <div key={`${question}-${index}`} className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">
                  {question}
                </div>
              ))}
            </div>
          </div>
        )}

        {memorySnippets.length > 0 ? (
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">记忆模型片段</div>
            <div className="space-y-3">
              {memorySnippets.map((snippet, index) => (
                <div key={`${snippet.question}-${index}`} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                  <div className="mb-1 text-xs font-medium text-primary">Q: {snippet.question}</div>
                  <div className="max-h-32 overflow-y-auto text-sm leading-6 text-gray-600">{snippet.answer}</div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-400">暂无记忆模型证据。</p>
        )}
      </section>

      <section className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
            <Globe2 className="h-4 w-4 text-primary" />
            Sources
          </div>
          <span className="text-xs text-gray-400">{webResults.length}</span>
        </div>

        {webResults.length > 0 ? (
          <div className="space-y-3">
            {webResults.map((result, index) => (
              <a
                key={`${result.url}-${index}`}
                href={result.url}
                target="_blank"
                rel="noreferrer"
                className="block rounded-lg border border-gray-100 bg-gray-50 p-3 transition-colors hover:border-primary/25 hover:bg-primary/5"
              >
                <div className="text-sm font-medium text-gray-900">[{index + 1}] {result.title || result.url}</div>
                {result.site_name && <div className="mt-1 text-xs text-gray-400">{result.site_name}</div>}
                {result.snippet && <div className="mt-2 line-clamp-3 text-xs leading-5 text-gray-600">{result.snippet}</div>}
              </a>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-400">没有联网来源，或本轮未开启联网搜索。</p>
        )}
      </section>
    </aside>
  )
}
