import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, BookOpenText, Brain, Eye, FileUp, Globe2, Loader2, Menu, PanelRightOpen, Settings, Sparkles, Square } from 'lucide-react'
import { MarkdownContent } from '@/components/chat/MarkdownContent'
import { ContextUsageIndicator } from '@/components/chat/ContextUsageIndicator'
import { ApiKeyDialog } from '@/components/layout/ApiKeyDialog'
import { ErrorCallout } from '@/components/ui/error-callout'
import { BrandLogo } from '@/components/layout/BrandLogo'
import { cn } from '@/lib/utils'
import { computeKnowledgeContextUsage } from '@/lib/context-window'
import { modelLabel } from '@/lib/providers'
import type { KnowledgeAnswerMode, KnowledgeMessage } from '@/lib/knowledge-types'
import { useKnowledgeChatStore } from '@/hooks/useKnowledgeChat'
import { useSettings } from '@/hooks/useSettings'
import { APP_NAME } from '@/lib/constants'
import { ToolChainTimeline } from './ToolChainTimeline'
import { isSubmitKey } from '@/lib/keyboard'
import { PersistenceNotice } from '@/components/layout/PersistenceNotice'
import { CopyButton } from '@/components/ui/copy-button'
import { AnswerActionsBar } from '@/components/ui/answer-actions'
import { buildExportFilename, buildMarkdownExport, downloadMarkdownFile, findTurnContext, type AnswerFeedback } from '@/lib/message-actions'

interface KnowledgePanelProps {
  contextOpen: boolean
  onOpenContext: () => void
  /** Set on phones, where the sidebar is a drawer opened from the header. */
  onOpenSidebar?: () => void
}

const suggestions = [
  '电力市场成员包括哪些？',
  '电力辅助服务包括哪些类型？费用怎么分担？',
  '售电公司有哪些主要权利和义务？',
  '绿电的价格怎么结算？',
]

const features = [
  {
    icon: Brain,
    title: '规则原文检索',
    description: '混合检索规则原文，按条款标注出处',
    color: 'text-primary',
    bg: 'bg-primary/10',
  },
  {
    icon: Globe2,
    title: '联网补充',
    description: '可选联网搜索，保留来源线索',
    color: 'text-indigo-600 dark:text-indigo-400',
    bg: 'bg-indigo-50 dark:bg-indigo-950/50',
  },
  {
    icon: Eye,
    title: '证据可查',
    description: '条款引用与有效期集中在证据面板',
    color: 'text-amber-600 dark:text-amber-400',
    bg: 'bg-amber-50 dark:bg-amber-950/50',
  },
  {
    icon: FileUp,
    title: '私有文档与本地历史',
    description: '本地解析 PDF / Word / Markdown，历史存浏览器',
    color: 'text-ink-secondary',
    bg: 'bg-surface-muted',
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
    <div className="rounded-xl border border-line bg-surface/85 p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink">
          {running ? (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          ) : (
            <Sparkles className="h-4 w-4 text-primary" />
          )}
          工具使用链
        </div>
        {toolSteps.length > 0 ? (
          <span className="text-xs text-ink-faint">
            {doneCount}/{toolSteps.length} 已完成
          </span>
        ) : (
          message.statusText && <span className="text-xs text-ink-faint">{message.statusText}</span>
        )}
      </div>

      {toolSteps.length > 0 ? (
        <ToolChainTimeline steps={toolSteps} />
      ) : (
        <div className="space-y-2">
          {progress.map((item, index) => (
            <div key={`${item}-${index}`} className="flex items-center gap-2 text-sm text-ink-secondary">
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
      <CopyButton text={content} label="复制问题" className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 hover:bg-surface/80" />
      <div className="max-w-[min(72%,760px)] rounded-2xl rounded-tr-md bg-user-bubble px-4 py-2.5 text-sm leading-relaxed text-user-bubble-foreground shadow-sm">
        <p className="whitespace-pre-wrap">{content}</p>
      </div>
    </div>
  )
}

function AssistantMessage({
  message,
  isStreaming,
  questionText,
  isLatestTurn,
  regenerateDisabled,
  onRegenerate,
  onFeedback,
  onOpenContext,
  onOpenSettings,
}: {
  message: KnowledgeMessage
  isStreaming: boolean
  questionText?: string
  isLatestTurn: boolean
  regenerateDisabled: boolean
  onRegenerate?: () => void
  onFeedback: (rating: AnswerFeedback | null) => void
  onOpenContext: () => void
  onOpenSettings?: () => void
}) {
  const evidence = message.evidence
  const evidenceCount =
    (evidence?.subQuestions.length ?? 0) +
    (evidence?.memorySnippets.length ?? 0) +
    (evidence?.webResults.length ?? 0)
  const hasProcessCard =
    (evidence?.toolSteps.length ?? 0) > 0 ||
    (evidence?.progress.length ?? 0) > 0

  const handleExport = () => {
    const markdown = buildMarkdownExport({
      question: questionText,
      answer: message.content,
      citations: evidence?.citations,
    })
    downloadMarkdownFile(buildExportFilename(questionText, '知识问答报告'), markdown)
  }

  return (
    <div className="max-w-[760px] space-y-4">
      <ProcessCard message={message} />

      {message.content ? (
        <div className="max-w-none text-sm leading-relaxed text-ink">
          <MarkdownContent content={message.content} />
        </div>
      ) : (
        isStreaming && !hasProcessCard && (
          <div className="flex items-center gap-2 py-3 text-sm text-ink-faint">
            <Loader2 className="h-4 w-4 animate-spin" />
            {message.statusText || '正在生成...'}
          </div>
        )
      )}

      {message.content && !isStreaming && (
        <AnswerActionsBar
          className="-mt-2"
          copyText={message.content}
          onRegenerate={onRegenerate}
          regenerateDisabled={regenerateDisabled}
          regenerateLabel={isLatestTurn ? '重新生成' : '从此问题重新生成'}
          onExportMarkdown={handleExport}
          feedback={message.feedback}
          onFeedback={onFeedback}
        />
      )}

      {message.error && (
        <ErrorCallout message={message.error} onOpenSettings={onOpenSettings} />
      )}

      {evidenceCount > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {(evidence?.subQuestions.length ?? 0) > 0 && (
            <span className="rounded-full border border-line bg-surface/80 px-3 py-1 text-xs text-ink-secondary">
              拆解 {evidence?.subQuestions.length} 个子问题
            </span>
          )}
          {(evidence?.memorySnippets.length ?? 0) > 0 && (
            <span className="rounded-full border border-line bg-surface/80 px-3 py-1 text-xs text-ink-secondary">
              记忆检索 {evidence?.memorySnippets.length} 条
            </span>
          )}
          {(evidence?.webResults.length ?? 0) > 0 && (
            <span className="rounded-full border border-line bg-surface/80 px-3 py-1 text-xs text-ink-secondary">
              联网来源 {evidence?.webResults.length} 条
            </span>
          )}
          <button
            onClick={onOpenContext}
            className="flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <PanelRightOpen className="h-3.5 w-3.5" />
            查看证据
          </button>
        </div>
      )}
    </div>
  )
}

function EmptyKnowledgeState({ onSuggestionClick, disabled, zeroConfigReady = false }: { onSuggestionClick: (text: string) => void; disabled: boolean; zeroConfigReady?: boolean }) {
  return (
    <div className="subtle-scrollbar h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full max-w-4xl flex-col justify-center space-y-3.5 px-3 py-4 md:px-6 lg:py-5 2xl:max-w-5xl 2xl:space-y-5 2xl:py-8">
        <section className="glass-panel rounded-[20px] p-4 lg:p-5 2xl:p-7">
          <div className="flex items-start gap-3.5 2xl:gap-4">
            <div className="anim-logo d-0 h-11 w-11 flex-shrink-0 2xl:h-14 2xl:w-14">
              <BrandLogo className="h-full w-full" title={APP_NAME} />
            </div>
            <div className="min-w-0">
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/15 bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                  <BookOpenText className="h-3.5 w-3.5" />
                  {APP_NAME} · 知识问答
                </span>
                {zeroConfigReady && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200/90 bg-emerald-50/85 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:border-emerald-800/50 dark:bg-emerald-950/45 dark:text-emerald-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    免配置 · 直接提问
                  </span>
                )}
              </div>
              <h1 className="anim-up d-1 text-xl font-semibold tracking-tight text-ink lg:text-2xl 2xl:text-3xl">知识库问答</h1>
              <p className="anim-up d-2 mt-1 text-sm text-ink-muted">
                查规则原文、看条款出处，支持上传私有文档。
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-2.5 sm:grid-cols-2 2xl:mt-6 2xl:gap-3">
            {features.map((feature, index) => (
              <div
                key={feature.title}
                className={`group rounded-xl border border-line bg-surface/75 p-3 transition-all hover:border-primary/25 hover:bg-surface hover:shadow-sm 2xl:p-4 anim-up d-${index + 3}`}
              >
                <div className="flex items-start gap-2.5">
                  <div className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg 2xl:h-8 2xl:w-8 ${feature.bg}`}>
                    <feature.icon className={`h-4 w-4 ${feature.color}`} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-ink">{feature.title}</h3>
                    <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{feature.description}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="glass-panel space-y-2.5 rounded-[20px] p-4 2xl:p-5 anim-up d-7">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">建议问题</p>
          <div className="grid gap-2 lg:grid-cols-2">
            {suggestions.map((item) => (
              <button
                key={item}
                onClick={() => onSuggestionClick(item)}
                disabled={disabled}
                className="rounded-xl border border-line bg-surface/75 px-3.5 py-2.5 text-left text-sm leading-5 text-ink-secondary transition-all hover:border-primary/35 hover:bg-surface hover:text-primary hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-45 2xl:px-4 2xl:py-3"
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
    regenerateMessage,
    setMessageFeedback,
    stopStreaming,
    useBaseModel,
    setUseBaseModel,
    useWebSearch,
    setUseWebSearch,
    answerMode,
    setAnswerMode,
    setSelectedEvidenceMessage,
    createNewSession,
    persistenceState,
    retrySave,
  } = useKnowledgeChatStore()
  const { provider, activeProvider, serverProviders, model, activeContextWindowOverride, setModelContextWindow } = useSettings()
  const zeroConfigReady = serverProviders.some((p) => p.id === activeProvider?.id && p.hasEnvKey)
  const [input, setInput] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const shouldAutoScrollRef = useRef(true)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const historyUnavailable = persistenceState === 'loading' || persistenceState === 'load-error'
  const historyHint = persistenceState === 'load-error' ? '历史记录读取失败，请先点击“重试读取”' : '正在读取历史记录，请稍候'

  const messages = activeSession?.messages ?? []
  const activeSessionIsStreaming = Boolean(isStreaming && activeSession?.id === streamingSessionId)
  const currentModel = activeProvider?.models.find((m) => m.id === model)
  const currentModelDisplay = currentModel ? modelLabel(currentModel) : (model || '未选择模型')
  const contextUsage = useMemo(
    () => computeKnowledgeContextUsage({
      messages,
      draftText: input,
      modelId: model,
      contextWindowOverride: activeContextWindowOverride,
      isStreaming: activeSessionIsStreaming,
    }),
    [messages, input, model, activeContextWindowOverride, activeSessionIsStreaming],
  )
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
    const container = containerRef.current
    container?.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
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
    // Scroll the list itself; scrollIntoView would also scroll overflow-hidden ancestors.
    const container = containerRef.current
    container?.scrollTo({ top: container.scrollHeight, behavior: activeSessionIsStreaming ? 'auto' : 'smooth' })
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
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          {onOpenSidebar && (
            <button
              onClick={onOpenSidebar}
              aria-label="打开侧边栏"
              title="打开侧边栏"
              className="rounded-lg p-2 text-ink-muted transition-colors hover:bg-surface/80 hover:text-ink"
            >
              <Menu className="h-5 w-5" />
            </button>
          )}
          <div className="hidden h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-line bg-surface/85 text-primary shadow-sm sm:flex">
            <BookOpenText className="h-4.5 w-4.5" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold tracking-tight text-ink">知识库问答</div>
            <div className="truncate text-xs text-ink-muted">规则检索 / 私有文档 / 联网补充</div>
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1.5">
          <button
            onClick={onOpenContext}
            className={cn(
              'flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
              contextOpen
                ? 'border-primary/20 bg-primary/10 text-primary'
                : 'border-line bg-surface/80 text-ink-muted hover:bg-surface hover:text-ink',
            )}
          >
            <PanelRightOpen className="h-4 w-4" />
            证据面板
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="rounded-lg p-2 text-ink-faint transition-colors hover:bg-surface/80 hover:text-ink-secondary"
            title="设置"
            aria-label="设置"
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {messages.length === 0 ? (
          <EmptyKnowledgeState onSuggestionClick={draftSuggestion} disabled={isStreaming || historyUnavailable} zeroConfigReady={zeroConfigReady} />
        ) : (
          <div
            ref={containerRef}
            onScroll={handleScroll}
            className="subtle-scrollbar relative h-full overflow-y-auto px-4 py-5 md:px-[8%] xl:px-[12%]"
          >
            <div className="mx-auto max-w-3xl space-y-8">
              {messages.map((message) => {
                const turn = message.role === 'assistant' ? findTurnContext(messages, message.id) : null
                return (
                  <div key={message.id}>
                    {message.role === 'user' ? (
                      <UserMessage content={message.content} />
                    ) : (
                      <AssistantMessage
                        message={message}
                        isStreaming={activeSessionIsStreaming && message.id === lastAssistantId}
                        questionText={turn?.userMessage?.content}
                        isLatestTurn={turn?.isLatestTurn ?? true}
                        regenerateDisabled={isStreaming || historyUnavailable}
                        onRegenerate={turn?.userMessage ? () => void regenerateMessage(message.id) : undefined}
                        onFeedback={(rating) => setMessageFeedback(message.id, rating)}
                        onOpenContext={() => openEvidence(message.id)}
                        onOpenSettings={() => setShowSettings(true)}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
        {showScrollToBottom && (
          <button onClick={scrollToBottom} className="absolute bottom-3 right-6 flex items-center gap-1 rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-ink-secondary shadow-sm hover:text-primary">
            <ArrowDown className="h-3.5 w-3.5" />
            回到最新内容
          </button>
        )}
      </div>

      <div className="px-4 pb-4 pt-2 md:px-6 lg:px-[6%] 2xl:px-[12%]">
        <div className="mx-auto max-w-4xl 2xl:max-w-5xl">
          <PersistenceNotice state={persistenceState} onRetry={retrySave} />
          <div className="glass-panel composer-shell rounded-[18px] transition-all">
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
              placeholder={historyUnavailable
                ? historyHint
                : zeroConfigReady
                  ? '规则库与模型已就绪，无需配置，直接输入电力市场或私有文档问题…'
                  : '输入关于电力市场、现货、售电或交易规则的问题…'}
              className="max-h-[180px] w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-sm leading-relaxed text-ink outline-none placeholder:text-ink-faint disabled:opacity-60"
            />

            <div className="flex items-center justify-between gap-3 p-3 pt-0">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <button
                  onClick={() => setUseBaseModel(!useBaseModel)}
                  title={useBaseModel ? '知识库依据不足时，允许补充模型的通用知识（单独标注）' : '仅依据知识库条款回答，找不到依据时直接说明'}
                  className={cn(
                    'flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-all',
                    useBaseModel ? 'border-primary/50 bg-primary/5 text-primary' : 'border-line-strong text-ink-muted',
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
                    useWebSearch ? 'border-primary/50 bg-primary/5 text-primary' : 'border-line-strong text-ink-muted',
                    !useBaseModel && 'opacity-45',
                  )}
                >
                  <Globe2 className="h-3.5 w-3.5" />
                  联网搜索
                </button>
                <div className="flex rounded-full border border-line-strong bg-surface/50 p-0.5">
                  {answerModes.map((mode) => (
                    <button
                      key={mode.id}
                      onClick={() => setAnswerMode(mode.id)}
                      className={cn(
                        'rounded-full px-2.5 py-0.5 text-xs transition-colors',
                        answerMode === mode.id ? 'bg-primary text-primary-foreground' : 'text-ink-muted hover:text-ink',
                      )}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
                <ContextUsageIndicator
                  usage={contextUsage}
                  modelName={currentModelDisplay}
                  isStreaming={activeSessionIsStreaming}
                  canStartNewSession={messages.length > 0}
                  onNewSession={createNewSession}
                  onSetContextWindow={model ? (tokens) => setModelContextWindow(provider, model, tokens) : undefined}
                  systemLabel="系统提示词"
                  toolLabel="检索与联网资料"
                  historyNote="知识库问答每次最多携带最近 6 轮历史对话与本轮检索条款。"
                />
              </div>

              <div className="flex shrink-0 items-center gap-2">
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
                        ? 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90'
                        : 'bg-surface-hover text-ink-faint',
                    )}
                    title="发送"
                    aria-label="发送"
                  >
                    <ArrowUp className="h-5 w-5" />
                  </button>
                )}
              </div>
            </div>
          </div>

          <p className="mt-2 text-center text-xs text-ink-faint">
            {historyUnavailable ? historyHint : isStreaming ? '正在生成中，可随时停止' : '内容由 AI 生成，请仔细甄别'}
          </p>
        </div>
      </div>
      <ApiKeyDialog open={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  )
}
