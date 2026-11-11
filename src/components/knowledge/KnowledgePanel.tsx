import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Brain, Eye, Globe2, Loader2, Lock, Menu, PanelRightOpen, Sparkles, Square } from 'lucide-react'
import { MarkdownContent } from '@/components/chat/MarkdownContent'
import { cn } from '@/lib/utils'
import type { KnowledgeAnswerMode, KnowledgeMessage } from '@/lib/knowledge-types'
import { useKnowledgeChatStore } from '@/hooks/useKnowledgeChat'
import { APP_NAME } from '@/lib/constants'
import { ToolChainTimeline } from './ToolChainTimeline'
import { isSubmitKey } from '@/lib/keyboard'
import { PersistenceNotice } from '@/components/layout/PersistenceNotice'
import { CopyButton } from '@/components/ui/copy-button'

interface KnowledgePanelProps {
  contextOpen: boolean
  onOpenContext: () => void
  /** Set on phones, where the sidebar is a drawer opened from the header. */
  onOpenSidebar?: () => void
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
    title: '规则原文检索',
    description: '关键词与向量混合检索电力市场规则原文，按条款给出出处',
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
    description: '工具链、引用条款及有效期、联网来源集中在证据面板',
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
    <div className="group flex items-center justify-end gap-1.5">
      <CopyButton text={content} label="复制问题" className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 hover:bg-white/80" />
      <div className="max-w-[min(72%,760px)] rounded-2xl rounded-tr-md bg-user-bubble px-4 py-2.5 text-sm leading-relaxed text-white shadow-sm">
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

      {message.content && !isStreaming && (
        <div className="-mt-2 px-1">
          <CopyButton text={message.content} label="复制回答" className="hover:bg-white/80" />
        </div>
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

function EmptyKnowledgeState({ onSuggestionClick, disabled }: { onSuggestionClick: (text: string) => void; disabled: boolean }) {
  return (
    <div className="subtle-scrollbar h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full max-w-4xl flex-col justify-center space-y-4 px-3 py-5 md:px-6 lg:py-6 2xl:max-w-5xl 2xl:space-y-5 2xl:py-8">
        <section className="glass-panel rounded-[20px] p-5 lg:p-6 2xl:p-8">
          <div className="flex items-start gap-3.5 2xl:gap-4">
            <div className="anim-logo d-0 h-12 w-12 flex-shrink-0 2xl:h-14 2xl:w-14">
              <img src={`${import.meta.env.BASE_URL}logo.svg`} alt={APP_NAME} className="h-full w-full" />
            </div>
            <div className="min-w-0">
              <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-primary/15 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                <Brain className="h-3.5 w-3.5" />
                Knowledge Copilot
              </div>
              <h1 className="anim-up d-1 text-2xl font-semibold tracking-tight text-stone-950 lg:text-3xl 2xl:text-4xl">知识库问答</h1>
              <p className="anim-up d-2 mt-2 max-w-2xl text-sm leading-6 text-stone-600">
                基于电力市场规则原文检索、大模型与联网搜索，回答电力市场和交易规则问题，并标注引用条款。
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
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-400">建议问题 <span className="font-normal normal-case tracking-normal">· 点击填入输入框，可修改后发送</span></p>
          <div className="grid gap-2 lg:grid-cols-2">
            {suggestions.map((item) => (
              <button
                key={item}
                onClick={() => onSuggestionClick(item)}
                disabled={disabled}
                className="rounded-xl border border-stone-200/70 bg-white/72 px-3.5 py-2.5 text-left text-sm leading-5 text-stone-700 transition-all hover:border-primary/35 hover:bg-white hover:text-primary hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-45 2xl:px-4 2xl:py-3"
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

export function KnowledgePanel({ contextOpen, onOpenContext, onOpenSidebar }: KnowledgePanelProps) {
  const {
    activeSession,
    isStreaming,
    streamingSessionId,
    sendMessage,
    stopStreaming,
    useBaseModel,
    setUseBaseModel,
    useWebSearch,
    setUseWebSearch,
    answerMode,
    setAnswerMode,
    setSelectedEvidenceMessage,
    persistenceState,
    retrySave,
  } = useKnowledgeChatStore()
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const shouldAutoScrollRef = useRef(true)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const historyUnavailable = persistenceState === 'loading' || persistenceState === 'load-error'
  const historyHint = persistenceState === 'load-error' ? '历史记录读取失败，请先点击“重试读取”' : '正在读取历史记录，请稍候'

  const messages = activeSession?.messages ?? []
  const activeSessionIsStreaming = Boolean(isStreaming && activeSession?.id === streamingSessionId)
  const lastAssistantId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return messages[i].id
    }
    return null
  }, [messages])

  useEffect(() => {
    shouldAutoScrollRef.current = true
    setShowScrollToBottom(false)
  }, [activeSession?.id])

  const scrollToBottom = useCallback(() => {
    shouldAutoScrollRef.current = true
    setShowScrollToBottom(false)
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  const handleScroll = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80
    shouldAutoScrollRef.current = nearBottom
    setShowScrollToBottom(!nearBottom)
  }, [])

  useEffect(() => {
    if (!shouldAutoScrollRef.current) return
    bottomRef.current?.scrollIntoView({ behavior: activeSessionIsStreaming ? 'auto' : 'smooth' })
  }, [messages, activeSessionIsStreaming, activeSession?.id])

  const submit = useCallback((value?: string) => {
    const text = (value ?? input).trim()
    if (!text || isStreaming || historyUnavailable) return
    shouldAutoScrollRef.current = true
    setShowScrollToBottom(false)
    sendMessage(text)
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }, [input, isStreaming, historyUnavailable, sendMessage])

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 180) + 'px'
  }

  const draftSuggestion = useCallback((text: string) => {
    setInput(text)
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.style.height = 'auto'
      el.style.height = Math.min(el.scrollHeight, 180) + 'px'
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    })
  }, [])

  const openEvidence = (messageId: string) => {
    setSelectedEvidenceMessage(messageId)
    onOpenContext()
  }

  return (
    <div className="app-canvas relative flex h-full min-w-0 flex-1 flex-col">
      <header className="app-header flex flex-shrink-0 items-center justify-between gap-2 border-b px-3 py-3 backdrop-blur-sm sm:px-5">
        <div className="flex min-w-0 items-center gap-2">
          {onOpenSidebar && (
            <button
              onClick={onOpenSidebar}
              aria-label="打开侧边栏"
              title="打开侧边栏"
              className="rounded-lg p-2 text-stone-500 transition-colors hover:bg-white/80 hover:text-stone-800"
            >
              <Menu className="h-5 w-5" />
            </button>
          )}
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-stone-950">知识库问答</div>
            <div className="truncate text-xs text-stone-500">规则检索 / 大模型 / 联网搜索</div>
          </div>
        </div>
        <button
          onClick={onOpenContext}
          className={cn(
            'flex flex-shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border px-3 py-2 text-sm transition-colors',
            contextOpen
              ? 'border-primary/20 bg-primary/10 text-primary'
              : 'border-stone-200 bg-white/80 text-stone-500 hover:bg-white hover:text-stone-800',
          )}
        >
          <PanelRightOpen className="h-4 w-4" />
          证据面板
        </button>
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {messages.length === 0 ? (
          <EmptyKnowledgeState onSuggestionClick={draftSuggestion} disabled={isStreaming || historyUnavailable} />
        ) : (
          <div
            ref={containerRef}
            onScroll={handleScroll}
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
                      isStreaming={activeSessionIsStreaming && message.id === lastAssistantId}
                      onOpenContext={() => openEvidence(message.id)}
                    />
                  )}
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          </div>
        )}
        {showScrollToBottom && (
          <button onClick={scrollToBottom} className="absolute bottom-3 right-6 flex items-center gap-1 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs text-stone-600 shadow-sm hover:text-primary">
            <ArrowDown className="h-3.5 w-3.5" />
            回到最新内容
          </button>
        )}
      </div>

      <div className="px-4 pb-4 pt-2 md:px-6 lg:px-[6%] 2xl:px-[12%]">
        <div className="mx-auto max-w-4xl 2xl:max-w-5xl">
          <PersistenceNotice state={persistenceState} onRetry={retrySave} />
          <div className="glass-panel rounded-[18px] transition-all focus-within:border-primary/35 focus-within:shadow-[0_20px_55px_rgba(15,118,110,0.14)]">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInput}
              onKeyDown={(e) => {
                if (isSubmitKey(e)) {
                  e.preventDefault()
                  submit()
                }
              }}
              disabled={isStreaming || historyUnavailable}
              rows={1}
              placeholder={historyUnavailable ? historyHint : '输入关于电力市场、省电、售电、交易规则的问题...'}
              className="max-h-[180px] w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-sm leading-relaxed text-stone-900 outline-none placeholder:text-stone-400 disabled:opacity-60"
            />

            <div className="flex items-center justify-between gap-3 p-3 pt-0">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <button
                  onClick={() => setUseBaseModel(!useBaseModel)}
                  title={useBaseModel ? '知识库依据不足时，允许补充模型的通用知识（单独标注）' : '仅依据知识库条款回答，找不到依据时直接说明'}
                  className={cn(
                    'flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-all',
                    useBaseModel ? 'border-primary/50 bg-primary/5 text-primary' : 'border-stone-300 text-stone-500',
                  )}
                >
                  <Brain className="h-3.5 w-3.5" />
                  通用知识
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
                  aria-label="停止生成"
                >
                  <Square className="h-4 w-4" fill="currentColor" />
                </button>
              ) : (
                <button
                  onClick={() => submit()}
                  disabled={!input.trim() || historyUnavailable}
                  className={cn(
                    'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full transition-all',
                    input.trim() && !historyUnavailable
                      ? 'bg-primary text-white shadow-sm hover:bg-primary/90'
                      : 'bg-stone-200 text-stone-400',
                  )}
                  title="发送"
                  aria-label="发送"
                >
                  <ArrowUp className="h-5 w-5" />
                </button>
              )}
            </div>
          </div>

          <p className="mt-2 text-center text-xs text-stone-400">
            {historyUnavailable ? historyHint : isStreaming ? '正在生成中，可随时停止' : '内容由 AI 生成，请仔细甄别'}
          </p>
        </div>
      </div>
    </div>
  )
}
