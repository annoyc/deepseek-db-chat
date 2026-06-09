import type { ChatMessage } from '@/lib/types'
import { User } from 'lucide-react'
import { ThinkingBlock } from './ThinkingBlock'
import { ToolCallStatus } from './ToolCallStatus'
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

function StreamingIndicator() {
  return (
    <div className="flex items-center gap-1.5 py-2">
      <div className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }} />
      <div className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '150ms' }} />
      <div className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '300ms' }} />
    </div>
  )
}

function AssistantPartsView({ message, isStreaming, thinkingExpanded, toolCallExpanded }: MessageBubbleProps) {
  const parts = message.parts!
  const toolCalls = message.toolCalls ?? []
  let thinkingIdx = 0

  // 只有最后一个 part 是 thinking 类型时，该 thinking 块才处于流式状态
  const lastPart = parts[parts.length - 1]
  const isLastThinking = isStreaming && lastPart?.type === 'thinking'
  const lastThinkingIndex = (() => {
    let idx = 0
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].type === 'thinking') idx++
    }
    return idx
  })()

  return (
    <div className="space-y-3 min-w-0 max-w-full">
      {parts.map((part, i) => {
        switch (part.type) {
          case 'thinking': {
            const idx = ++thinkingIdx
            const thinkingStreaming = isLastThinking && idx === lastThinkingIndex
            return <ThinkingBlock key={`t-${i}`} content={part.content} index={idx} isStreaming={thinkingStreaming} defaultExpanded={thinkingExpanded} />
          }
          case 'tool-call': {
            const tc = toolCalls[part.toolCallIndex]
            if (!tc || tc.name === 'execute_sql' || tc.name === 'smart_filter') return null
            return <ToolCallStatus key={`tc-${i}`} toolCall={tc} defaultExpanded={toolCallExpanded} />
          }
          case 'text':
            return part.content ? <MarkdownContent key={`txt-${i}`} content={part.content} /> : null
          default:
            return null
        }
      })}

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
  const nonSqlToolCalls = message.toolCalls?.filter((tc) => tc.name !== 'execute_sql' && tc.name !== 'smart_filter') ?? []
  const hasThinking = Boolean(message.thinking)
  const hasToolCalls = nonSqlToolCalls.length > 0
  const hasSqlConfirm = Boolean(message.sqlConfirm)
  const hasSmartFilterConfirm = Boolean(message.smartFilterConfirm)
  const hasContent = Boolean(message.content)
  const hasAnyContent = hasThinking || hasToolCalls || hasSqlConfirm || hasSmartFilterConfirm || hasContent

  if (!hasAnyContent) return null

  return (
    <div className="space-y-3 min-w-0 max-w-full">
      {hasThinking && (
        <ThinkingBlock content={message.thinking!} isStreaming={isStreaming} defaultExpanded={thinkingExpanded} />
      )}

      {hasToolCalls && (
        <div className="space-y-3">
          {nonSqlToolCalls.map((tc, idx) => (
            <ToolCallStatus key={idx} toolCall={tc} defaultExpanded={toolCallExpanded} />
          ))}
        </div>
      )}

      {hasContent && (
        <MarkdownContent content={message.content} />
      )}

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
      <div className="flex gap-3 justify-end">
        <div className="max-w-[70%]">
          <div className="rounded-2xl px-4 py-2.5 text-sm leading-relaxed bg-primary text-primary-foreground">
            <p className="whitespace-pre-wrap">{message.content}</p>
          </div>
        </div>
        <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0 mt-1">
          <User className="w-4 h-4 text-gray-600" />
        </div>
      </div>
    )
  }

  // Show loading indicator when streaming and message has no content yet
  const hasContent = message.parts && message.parts.length > 0
  const hasLegacyContent = message.content || message.thinking || (message.toolCalls && message.toolCalls.length > 0) || message.sqlConfirm || message.smartFilterConfirm

  if (isStreaming && !hasContent && !hasLegacyContent) {
    return <StreamingIndicator />
  }

  if (message.parts && message.parts.length > 0) {
    return <AssistantPartsView message={message} isStreaming={isStreaming} thinkingExpanded={thinkingExpanded} toolCallExpanded={toolCallExpanded} />
  }

  return <AssistantLegacyView message={message} isStreaming={isStreaming} thinkingExpanded={thinkingExpanded} toolCallExpanded={toolCallExpanded} />
}
