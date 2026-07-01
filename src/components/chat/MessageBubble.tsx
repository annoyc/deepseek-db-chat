import type { ChatMessage } from '@/lib/types'
import { User } from 'lucide-react'
import { ThinkingBlock } from './ThinkingBlock'
import { ToolCallStatus } from './ToolCallStatus'
import { QueryPlanBlock } from './QueryPlanBlock'
import { SqlConfirmBlock } from './SqlConfirmBlock'
import { SmartFilterConfirmBlock } from './SmartFilterConfirmBlock'
import { MarkdownContent } from './MarkdownContent'
import { useSettings } from '@/hooks/useSettings'

interface MessageBubbleProps {
  message: ChatMessage
  isStreaming?: boolean
  thinkingExpanded?: boolean
  toolCallExpanded?: boolean
}

function formatStreamingStatus(text?: string) {
  const trimmed = text?.trim().replace(/[.。…\s]+$/u, '')
  return trimmed || '正在生成'
}

function StreamingIndicator({ text }: { text?: string }) {
  const displayText = formatStreamingStatus(text)

  return (
    <div className="streaming-wait flex items-center gap-1.5 px-2 py-1.5" role="status" aria-live="polite" aria-label={displayText}>
      <span className="streaming-wait-text">{displayText}</span>
      <span className="streaming-ellipsis" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
    </div>
  )
}


function AssistantPartsView({ message, isStreaming, thinkingExpanded, toolCallExpanded }: MessageBubbleProps) {
  const parts = message.parts!
  const toolCalls = message.toolCalls ?? []
  let thinkingIdx = 0

  const lastPart = parts[parts.length - 1]
  const isLastThinking = isStreaming && lastPart?.type === 'thinking'
  const isLastText = isStreaming && lastPart?.type === 'text'
  const lastThinkingIndex = (() => {
    let idx = 0
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].type === 'thinking') idx++
    }
    return idx
  })()

  const hasConfirmBlock = Boolean(message.sqlConfirm || message.smartFilterConfirm)
  const isLastToolCallActive = (() => {
    if (!isStreaming || lastPart?.type !== 'tool-call') return false
    const tc = toolCalls[lastPart.toolCallIndex]
    return tc?.status === 'calling'
  })()
  const showTailIndicator = isStreaming && !isLastThinking && !isLastText && !hasConfirmBlock && !isLastToolCallActive

  return (
    <div className="space-y-3 min-w-0 max-w-full animate-in fade-in duration-200">
      {parts.map((part, i) => {
        switch (part.type) {
          case 'thinking': {
            const idx = ++thinkingIdx
            const thinkingStreaming = isLastThinking && idx === lastThinkingIndex
            return <ThinkingBlock key={`t-${i}`} content={part.content} index={idx} isStreaming={thinkingStreaming} defaultExpanded={thinkingExpanded} />
          }
          case 'tool-call': {
            const tc = toolCalls[part.toolCallIndex]
            if (!tc || tc.name === 'execute_sql' || tc.name === 'smart_filter' || tc.name === 'report_analysis') return null
            if (tc.name === 'plan_query') return <div key={`plan-${i}`} className="animate-in fade-in slide-in-from-bottom-2 duration-300"><QueryPlanBlock toolCall={tc} defaultExpanded={toolCallExpanded} /></div>
            return <div key={`tc-${i}`} className="animate-in fade-in slide-in-from-bottom-2 duration-300"><ToolCallStatus toolCall={tc} defaultExpanded={toolCallExpanded} /></div>
          }
          case 'text':
            return part.content ? <MarkdownContent key={`txt-${i}`} content={part.content} isStreaming={isLastText && i === parts.length - 1} /> : null
          default:
            return null
        }
      })}

      {showTailIndicator && <StreamingIndicator text={message.statusText} />}

      {message.sqlConfirm && (
        <SqlConfirmBlock
          info={message.sqlConfirm}
          messageId={message.id}
          result={message.sqlResult}
        />
      )}

      {message.smartFilterConfirm && (
        <SmartFilterConfirmBlock
          info={message.smartFilterConfirm}
          messageId={message.id}
        />
      )}
    </div>
  )
}

function AssistantLegacyView({ message, isStreaming, thinkingExpanded, toolCallExpanded }: MessageBubbleProps) {
  const nonSqlToolCalls = message.toolCalls?.filter((tc) => tc.name !== 'execute_sql' && tc.name !== 'smart_filter' && tc.name !== 'plan_query' && tc.name !== 'report_analysis') ?? []
  const planToolCalls = message.toolCalls?.filter((tc) => tc.name === 'plan_query') ?? []
  const hasThinking = Boolean(message.thinking)
  const hasToolCalls = nonSqlToolCalls.length > 0 || planToolCalls.length > 0
  const hasSqlConfirm = Boolean(message.sqlConfirm)
  const hasSmartFilterConfirm = Boolean(message.smartFilterConfirm)
  const hasContent = Boolean(message.content)
  const hasAnyContent = hasThinking || hasToolCalls || hasSqlConfirm || hasSmartFilterConfirm || hasContent

  if (!hasAnyContent) return null

  const hasConfirmBlock = hasSqlConfirm || hasSmartFilterConfirm
  const hasActiveToolCall = nonSqlToolCalls.some((tc) => tc.status === 'calling')
  const showTailIndicator = isStreaming && !hasConfirmBlock && !hasContent && !hasActiveToolCall

  return (
    <div className="space-y-3 min-w-0 max-w-full animate-in fade-in duration-200">
      {hasThinking && (
        <ThinkingBlock content={message.thinking!} isStreaming={isStreaming} defaultExpanded={thinkingExpanded} />
      )}

      {hasToolCalls && (
        <div className="space-y-3">
          {planToolCalls.map((tc, idx) => (
            <div key={`plan-${idx}`} className="animate-in fade-in slide-in-from-bottom-2 duration-300">
              <QueryPlanBlock toolCall={tc} defaultExpanded={toolCallExpanded} />
            </div>
          ))}
          {nonSqlToolCalls.map((tc, idx) => (
            <div key={idx} className="animate-in fade-in slide-in-from-bottom-2 duration-300">
              <ToolCallStatus toolCall={tc} defaultExpanded={toolCallExpanded} />
            </div>
          ))}
        </div>
      )}

      {hasContent && (
        <MarkdownContent content={message.content} isStreaming={isStreaming} />
      )}

      {showTailIndicator && <StreamingIndicator text={message.statusText} />}

      {hasSqlConfirm && (
        <SqlConfirmBlock
          info={message.sqlConfirm!}
          messageId={message.id}
          result={message.sqlResult}
        />
      )}

      {hasSmartFilterConfirm && (
        <SmartFilterConfirmBlock
          info={message.smartFilterConfirm!}
          messageId={message.id}
        />
      )}
    </div>
  )
}

export function MessageBubble({ message, isStreaming }: MessageBubbleProps) {
  const { thinkingCollapseMode, toolCallCollapseMode } = useSettings()
  const thinkingExpanded = thinkingCollapseMode === 'expanded'
  const toolCallExpanded = toolCallCollapseMode === 'expanded'

  if (message.role === 'user') {
    return (
      <div className="flex gap-3 justify-end animate-in fade-in slide-in-from-bottom-1 duration-200">
        <div className="max-w-[min(72%,760px)]">
          <div className="rounded-2xl rounded-tr-md bg-stone-950 px-4 py-2.5 text-sm leading-relaxed text-white shadow-sm">
            <p className="whitespace-pre-wrap">{message.content}</p>
          </div>
        </div>
        <div className="mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl border border-stone-200 bg-white/80 text-stone-600 shadow-sm">
          <User className="w-4 h-4" />
        </div>
      </div>
    )
  }

  // Show loading indicator when streaming and message has no content yet
  const hasContent = message.parts && message.parts.length > 0
  const hasLegacyContent = message.content || message.thinking || (message.toolCalls && message.toolCalls.length > 0) || message.sqlConfirm || message.smartFilterConfirm

  if (isStreaming && !hasContent && !hasLegacyContent) {
    return <StreamingIndicator text={message.statusText} />
  }

  if (message.parts && message.parts.length > 0) {
    return <AssistantPartsView message={message} isStreaming={isStreaming} thinkingExpanded={thinkingExpanded} toolCallExpanded={toolCallExpanded} />
  }

  return <AssistantLegacyView message={message} isStreaming={isStreaming} thinkingExpanded={thinkingExpanded} toolCallExpanded={toolCallExpanded} />
}
