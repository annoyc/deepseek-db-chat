import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, Brain, Eye, Globe2, Loader2, Lock, PanelRightOpen, Sparkles, Square } from 'lucide-react'
import { MarkdownContent } from '@/components/chat/MarkdownContent'
import { cn } from '@/lib/utils'
import type { KnowledgeAnswerMode, KnowledgeMessage } from '@/lib/knowledge-types'
import { useKnowledgeChatStore } from '@/hooks/useKnowledgeChat'
import { APP_NAME } from '@/lib/constants'
import { ToolChainTimeline } from './ToolChainTimeline'

interface KnowledgePanelProps {
  contextOpen: boolean
  onOpenContext: () => void
}

const suggestions = [
  '电力市场的构成是什么？',
  '什么是边际机组？',
  '售电公司是干什么的？靠谱吗？',
  '绿电的价格怎么结算？',
]

const features = [
  {
    icon: Brain,
    title: '记忆模型',
    description: '基于 MeMo 记忆模型查询省电、售电、交易规则知识',
    color: 'text-primary',
    bg: 'bg-primary/10',
  },
  {
    icon: Globe2,
    title: '联网补充',
    description: '可选联网搜索补充实时信息，回答中保留来源线索',
    color: 'text-indigo-600',
    bg: 'bg-indigo-50',
  },
  {
    icon: Eye,
    title: '证据可查',
    description: '问题拆解、记忆片段、联网来源集中在证据面板',
    color: 'text-amber-600',
    bg: 'bg-amber-50',
  },
  {
    icon: Lock,
    title: '本地历史',
    description: '问答记录保存到当前浏览器，方便继续追问',
    color: 'text-stone-700',
    bg: 'bg-stone-100',
  },
]

const answerModes: { id: KnowledgeAnswerMode; label: string }[] = [
  { id: 'concise', label: '简洁' },
  { id: 'standard', label: '标准' },
  { id: 'deep', label: '深度' },
]

function ProcessCard({ message }: { message: KnowledgeMessage }) {
  const toolSteps = message.evidence?.toolSteps ?? []
  const progress = message.evidence?.progress ?? []
  const hasToolSteps = toolSteps.length > 0
  const running = hasToolSteps ? toolSteps.some((s) => s.status === 'running') : Boolean(message.statusText)
  const hasContent = hasToolSteps || progress.length > 0
  if (!hasContent) return null

  const doneCount = toolSteps.filter((s) => s.status !== 'running').length

  return (
    <div className="rounded-xl border border-stone-200/70 bg-white/78 p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-stone-900">
          {running ? (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          ) : (
            <Sparkles className="h-4 w-4 text-primary" />
          )}
          工具使用链
        </div>
        {toolSteps.length > 0 ? (
          <span className="text-xs text-stone-400">
            {doneCount}/{toolSteps.length} 已完成
          </span>
        ) : (
          message.statusText && <span className="text-xs text-stone-400">{message.statusText}</span>
        )}
      </div>

      {toolSteps.length > 0 ? (
        <ToolChainTimeline steps={toolSteps} />
      ) : (
        <div className="space-y-2">
          {progress.map((item, index) => (
            <div key={`${item}-${index}`} className="flex items-center gap-2 text-sm text-stone-600">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              <span>{item}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function UserMessage({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[min(72%,760px)] rounded-2xl rounded-tr-md bg-stone-950 px-4 py-2.5 text-sm leading-relaxed text-white shadow-sm">
        <p className="whitespace-pre-wrap">{content}</p>
      </div>
    </div>
  )
}

function AssistantMessage({
  message,
  isStreaming,
  onOpenContext,
}: {
  message: KnowledgeMessage
  isStreaming: boolean
  onOpenContext: () => void
}) {
  const evidence = message.evidence
  const evidenceCount =
    (evidence?.subQuestions.length ?? 0) +
    (evidence?.memorySnippets.length ?? 0) +
    (evidence?.webResults.length ?? 0)
  const hasProcessCard =
    (evidence?.toolSteps.length ?? 0) > 0 ||
    (evidence?.progress.length ?? 0) > 0

  return (
    <div className="max-w-[760px] space-y-4">
      <ProcessCard message={message} />

      {message.content ? (
        <div className="max-w-none text-sm leading-relaxed text-stone-900">
          <MarkdownContent content={message.content} />
        </div>
      ) : (
        isStreaming && !hasProcessCard && (
          <div className="flex items-center gap-2 py-3 text-sm text-stone-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            {message.statusText || '正在生成...'}
          </div>
        )
      )}

      {message.error && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {message.error}
        </div>
      )}

      {evidenceCount > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {(evidence?.subQuestions.length ?? 0) > 0 && (
            <span className="rounded-full border border-stone-200 bg-white/80 px-3 py-1 text-xs text-stone-600">
              拆解 {evidence?.subQuestions.length} 个子问题
            </span>
          )}
          {(evidence?.memorySnippets.length ?? 0) > 0 && (
            <span className="rounded-full border border-stone-200 bg-white/80 px-3 py-1 text-xs text-stone-600">
              记忆检索 {evidence?.memorySnippets.length} 条
            </span>
          )}
          {(evidence?.webResults.length ?? 0) > 0 && (
            <span className="rounded-full border border-stone-200 bg-white/80 px-3 py-1 text-xs text-stone-600">
              联网来源 {evidence?.webResults.length} 条
            </span>
          )}
          <button
            onClick={onOpenContext}
            className="flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-primary/90"
          >
            <PanelRightOpen className="h-3.5 w-3.5" />
            查看证据
          </button>
        </div>
      )}
    </div>
  )
}

function EmptyKnowledgeState({ onSuggestionClick }: { onSuggestionClick: (text: string) => void }) {
  return (
    <div className="subtle-scrollbar h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full max-w-4xl flex-col justify-center space-y-4 px-3 py-5 md:px-6 lg:py-6 2xl:max-w-5xl 2xl:space-y-5 2xl:py-8">
        <section className="glass-panel rounded-[20px] p-5 lg:p-6 2xl:p-8">
          <div className="flex items-start gap-3.5 2xl:gap-4">
            <div className="anim-logo d-0 h-12 w-12 flex-shrink-0 overflow-hidden rounded-2xl shadow-lg shadow-primary/15 ring-1 ring-stone-200/80 2xl:h-14 2xl:w-14">
              <img src={`${import.meta.env.BASE_URL}logo.svg`} alt={APP_NAME} className="h-full w-full" />
            </div>
            <div className="min-w-0">
              <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-primary/15 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
                <Brain className="h-3.5 w-3.5" />
                Knowledge Copilot
              </div>
              <h1 className="anim-up d-1 text-2xl font-semibold tracking-tight text-stone-950 lg:text-3xl 2xl:text-4xl">知识库问答</h1>
              <p className="anim-up d-2 mt-2 max-w-2xl text-sm leading-6 text-stone-600">
                基于 MeMo 记忆模型、基座模型与联网搜索，回答电力市场和交易规则问题。
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-3 lg:grid-cols-2 2xl:mt-8">
            {features.map((feature, index) => (
              <div
                key={feature.title}
                className={`group rounded-xl border border-stone-200/70 bg-white/70 p-3.5 transition-all hover:border-primary/25 hover:bg-white hover:shadow-sm 2xl:p-4 anim-up d-${index + 3}`}
              >
                <div className="flex items-start gap-3">
                  <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg 2xl:h-9 2xl:w-9 ${feature.bg}`}>
                    <feature.icon className={`h-4.5 w-4.5 ${feature.color}`} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-stone-900">{feature.title}</h3>
                    <p className="mt-0.5 text-xs leading-relaxed text-stone-500">{feature.description}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="glass-panel space-y-3 rounded-[20px] p-4 2xl:p-5 anim-up d-7">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-400">建议问题</p>
          <div className="grid gap-2 lg:grid-cols-2">
            {suggestions.map((item) => (
              <button
                key={item}
                onClick={() => onSuggestionClick(item)}
                className="rounded-xl border border-stone-200/70 bg-white/72 px-3.5 py-2.5 text-left text-sm leading-5 text-stone-700 transition-all hover:border-primary/35 hover:bg-white hover:text-primary hover:shadow-sm 2xl:px-4 2xl:py-3"
              >
                {item}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function KnowledgePanel({ contextOpen, onOpenContext }: KnowledgePanelProps) {
  const {
    activeSession,
    isStreaming,
    sendMessage,
    stopStreaming,
    useBaseModel,
    setUseBaseModel,
    useWebSearch,
    setUseWebSearch,
    answerMode,
    setAnswerMode,
    setSelectedEvidenceMessage,
  } = useKnowledgeChatStore()
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const messages = activeSession?.messages ?? []
  const lastAssistantId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return messages[i].id
    }
    return null
  }, [messages])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: isStreaming ? 'auto' : 'smooth' })
  }, [messages, isStreaming])

  const submit = useCallback((value?: string) => {
    const text = (value ?? input).trim()
    if (!text || isStreaming) return
    sendMessage(text)
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }, [input, isStreaming, sendMessage])

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 180) + 'px'
  }

  const openEvidence = (messageId: string) => {
    setSelectedEvidenceMessage(messageId)
    onOpenContext()
  }

  return (
    <div className="app-canvas relative flex h-screen min-w-0 flex-1 flex-col">
      <header className="app-header flex flex-shrink-0 items-center justify-between border-b px-5 py-3 backdrop-blur-sm">
        <div>
          <div className="text-sm font-semibold text-stone-950">知识库问答</div>
          <div className="text-xs text-stone-500">MeMo / 基座模型 / 联网搜索</div>
        </div>
        <button
          onClick={onOpenContext}
          className={cn(
            'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors',
            contextOpen
              ? 'border-primary/20 bg-primary/10 text-primary'
              : 'border-stone-200 bg-white/80 text-stone-500 hover:bg-white hover:text-stone-800',
          )}
        >
          <PanelRightOpen className="h-4 w-4" />
          证据面板
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        {messages.length === 0 ? (
          <EmptyKnowledgeState onSuggestionClick={submit} />
        ) : (
          <div
            ref={containerRef}
            className="subtle-scrollbar h-full overflow-y-auto px-4 py-5 md:px-[8%] xl:px-[12%]"
          >
            <div className="mx-auto max-w-3xl space-y-8">
              {messages.map((message) => (
                <div key={message.id}>
                  {message.role === 'user' ? (
                    <UserMessage content={message.content} />
                  ) : (
                    <AssistantMessage
                      message={message}
                      isStreaming={isStreaming && message.id === lastAssistantId}
                      onOpenContext={() => openEvidence(message.id)}
                    />
                  )}
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          </div>
        )}
      </div>

      <div className="px-4 pb-4 pt-2 md:px-6 lg:px-[6%] 2xl:px-[12%]">
        <div className="mx-auto max-w-4xl 2xl:max-w-5xl">
          <div className="glass-panel rounded-[18px] transition-all focus-within:border-primary/35 focus-within:shadow-[0_20px_55px_rgba(15,118,110,0.14)]">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInput}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  submit()
                }
              }}
              disabled={isStreaming}
              rows={2}
              placeholder="输入关于电力市场、省电、售电、交易规则的问题..."
              className="max-h-[180px] w-full resize-none bg-transparent px-4 pt-4 pb-2 text-sm leading-relaxed text-stone-900 outline-none placeholder:text-stone-400 disabled:opacity-60"
            />

            <div className="flex items-center justify-between gap-3 p-3 pt-0">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <button
                  onClick={() => setUseBaseModel(!useBaseModel)}
                  className={cn(
                    'flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-all',
                    useBaseModel ? 'border-primary/50 bg-primary/5 text-primary' : 'border-stone-300 text-stone-500',
                  )}
                >
                  <Brain className="h-3.5 w-3.5" />
                  基座模型
                </button>
                <button
                  onClick={() => setUseWebSearch(!useWebSearch)}
                  disabled={!useBaseModel}
                  className={cn(
                    'flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-all',
                    useWebSearch ? 'border-primary/50 bg-primary/5 text-primary' : 'border-stone-300 text-stone-500',
                    !useBaseModel && 'opacity-45',
                  )}
                >
                  <Globe2 className="h-3.5 w-3.5" />
                  联网搜索
                </button>
                <div className="flex rounded-full border border-stone-300 bg-white/40 p-0.5">
                  {answerModes.map((mode) => (
                    <button
                      key={mode.id}
                      onClick={() => setAnswerMode(mode.id)}
                      className={cn(
                        'rounded-full px-2.5 py-0.5 text-xs transition-colors',
                        answerMode === mode.id ? 'bg-primary text-white' : 'text-stone-500 hover:text-stone-800',
                      )}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
              </div>

              {isStreaming ? (
                <button
                  onClick={stopStreaming}
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-red-500 text-white shadow-sm transition-colors hover:bg-red-600"
                  title="停止生成"
                >
                  <Square className="h-4 w-4" fill="currentColor" />
                </button>
              ) : (
                <button
                  onClick={() => submit()}
                  disabled={!input.trim()}
                  className={cn(
                    'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full transition-all',
                    input.trim()
                      ? 'bg-primary text-white shadow-sm hover:bg-primary/90'
                      : 'bg-stone-200 text-stone-400',
                  )}
                  title="发送"
                >
                  <ArrowUp className="h-5 w-5" />
                </button>
              )}
            </div>
          </div>

          <p className="mt-2 text-center text-xs text-stone-400">
            {isStreaming ? '正在生成中，可随时停止' : '内容由 AI 生成，请仔细甄别'}
          </p>
        </div>
      </div>
    </div>
  )
}
