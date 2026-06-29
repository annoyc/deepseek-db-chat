import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, Brain, Eye, Globe2, Loader2, Lock, PanelRightOpen, Sparkles, Square } from 'lucide-react'
import { MarkdownContent } from '@/components/chat/MarkdownContent'
import { cn } from '@/lib/utils'
import type { KnowledgeAnswerMode, KnowledgeMessage } from '@/lib/knowledge-types'
import { useKnowledgeChatStore } from '@/hooks/useKnowledgeChat'
import { APP_NAME } from '@/lib/constants'

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
    color: 'text-blue-600',
    bg: 'bg-blue-50',
  },
  {
    icon: Eye,
    title: '证据可查',
    description: '问题拆解、记忆片段、联网来源集中在证据面板',
    color: 'text-yellow-600',
    bg: 'bg-yellow-50',
  },
  {
    icon: Lock,
    title: '本地历史',
    description: '问答记录保存到当前浏览器，方便继续追问',
    color: 'text-purple-600',
    bg: 'bg-purple-50',
  },
]

const answerModes: { id: KnowledgeAnswerMode; label: string }[] = [
  { id: 'concise', label: '简洁' },
  { id: 'standard', label: '标准' },
  { id: 'deep', label: '深度' },
]

function ProcessCard({ message }: { message: KnowledgeMessage }) {
  const progress = message.evidence?.progress ?? []
  const hasProgress = progress.length > 0 || message.statusText
  if (!hasProgress) return null

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          {message.statusText ? (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          ) : (
            <Sparkles className="h-4 w-4 text-primary" />
          )}
          执行过程
        </div>
        {message.statusText && <span className="text-xs text-gray-400">{message.statusText}</span>}
      </div>
      <div className="space-y-2">
        {progress.map((item, index) => (
          <div key={`${item}-${index}`} className="flex items-center gap-2 text-sm text-gray-600">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            <span>{item}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function UserMessage({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[70%] rounded-2xl bg-primary px-4 py-2.5 text-sm leading-relaxed text-primary-foreground">
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

  return (
    <div className="max-w-[760px] space-y-4">
      <ProcessCard message={message} />

      {message.content ? (
        <div className="max-w-none text-sm leading-relaxed text-gray-900">
          <MarkdownContent content={message.content} />
        </div>
      ) : (
        isStreaming && (
          <div className="flex items-center gap-2 py-3 text-sm text-gray-400">
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
            <span className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-600">
              拆解 {evidence?.subQuestions.length} 个子问题
            </span>
          )}
          {(evidence?.memorySnippets.length ?? 0) > 0 && (
            <span className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-600">
              记忆检索 {evidence?.memorySnippets.length} 条
            </span>
          )}
          {(evidence?.webResults.length ?? 0) > 0 && (
            <span className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-600">
              联网来源 {evidence?.webResults.length} 条
            </span>
          )}
          <button
            onClick={onOpenContext}
            className="flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-primary/90"
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
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full max-w-4xl flex-col justify-center space-y-8 px-6 py-8">
        <div className="space-y-4 text-center">
          <div className="anim-logo d-0 mx-auto h-20 w-20 overflow-hidden rounded-2xl shadow-lg shadow-primary/20">
            <img src={`${import.meta.env.BASE_URL}logo.svg`} alt={APP_NAME} className="h-full w-full" />
          </div>
          <div className="space-y-1.5">
            <h1 className="anim-up d-1 text-3xl font-bold tracking-tight text-gray-900">{APP_NAME}</h1>
            <p className="anim-up d-2 text-sm text-gray-500">知识库问答 — 基于 MeMo 记忆模型与可选联网搜索</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {features.map((feature, index) => (
            <div
              key={feature.title}
              className={`group rounded-xl border border-gray-100 bg-white p-4 transition-all hover:border-gray-200 hover:shadow-md anim-up d-${index + 3}`}
            >
              <div className="flex items-start gap-3">
                <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${feature.bg}`}>
                  <feature.icon className={`h-4.5 w-4.5 ${feature.color}`} />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-gray-800">{feature.title}</h3>
                  <p className="mt-0.5 text-xs leading-relaxed text-gray-500">{feature.description}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-3 anim-up d-7">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">试试问我</p>
          <div className="grid grid-cols-2 gap-2">
            {suggestions.map((item) => (
              <button
                key={item}
                onClick={() => onSuggestionClick(item)}
                className="rounded-xl border border-gray-100 bg-white px-4 py-3 text-left text-sm text-gray-600 transition-all hover:border-primary/50 hover:bg-primary/5 hover:text-primary"
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
    <div className="relative flex h-screen min-w-0 flex-1 flex-col bg-[#f5f5f0]">
      <header className="flex flex-shrink-0 items-center justify-between border-b border-gray-200 bg-white/80 px-5 py-2.5 backdrop-blur-sm">
        <div>
          <div className="text-sm font-medium text-gray-800">省电知识库</div>
          <div className="text-xs text-gray-400">MeMo / 基座模型 / 联网搜索</div>
        </div>
        <button
          onClick={onOpenContext}
          className={cn(
            'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors',
            contextOpen
              ? 'border-primary/20 bg-primary/10 text-primary'
              : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-700',
          )}
        >
          <PanelRightOpen className="h-4 w-4" />
          证据面板
        </button>
      </header>

      <div
        ref={containerRef}
        className="min-h-0 flex-1 overflow-y-auto px-[10%] pb-44 pt-4"
      >
        {messages.length === 0 ? (
          <EmptyKnowledgeState onSuggestionClick={submit} />
        ) : (
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
        )}
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#f5f5f0] via-[#f5f5f0]/95 to-transparent px-[10%] pb-4 pt-10">
        <div className="pointer-events-auto mx-auto rounded-2xl border border-gray-300 bg-white shadow-sm transition-shadow focus-within:border-gray-400 focus-within:shadow-md">
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
            className="max-h-[180px] w-full resize-none bg-transparent px-4 pt-4 pb-2 text-sm leading-relaxed text-gray-900 outline-none placeholder:text-gray-400 disabled:opacity-60"
          />

          <div className="flex items-center justify-between gap-3 p-3 pt-0">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <button
                onClick={() => setUseBaseModel(!useBaseModel)}
                className={cn(
                  'flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs transition-all',
                  useBaseModel ? 'border-primary/50 text-primary' : 'border-gray-300 text-gray-500',
                )}
              >
                <Brain className="h-3.5 w-3.5" />
                基座模型
              </button>
              <button
                onClick={() => setUseWebSearch(!useWebSearch)}
                disabled={!useBaseModel}
                className={cn(
                  'flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs transition-all',
                  useWebSearch ? 'border-primary/50 text-primary' : 'border-gray-300 text-gray-500',
                  !useBaseModel && 'opacity-45',
                )}
              >
                <Globe2 className="h-3.5 w-3.5" />
                联网搜索
              </button>
              <div className="flex rounded-full border border-gray-300 bg-transparent p-0.5">
                {answerModes.map((mode) => (
                  <button
                    key={mode.id}
                    onClick={() => setAnswerMode(mode.id)}
                    className={cn(
                      'rounded-full px-2.5 py-0.5 text-xs transition-colors',
                      answerMode === mode.id ? 'bg-primary text-white' : 'text-gray-500 hover:text-gray-800',
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
                    : 'bg-gray-200 text-gray-400',
                )}
                title="发送"
              >
                <ArrowUp className="h-5 w-5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
