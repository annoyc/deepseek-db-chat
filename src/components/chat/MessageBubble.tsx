import type { ChatMessage } from '@/lib/types'
import { User } from 'lucide-react'
import { ThinkingBlock } from './ThinkingBlock'
import { ToolCallStatus } from './ToolCallStatus'
import { SqlConfirmBlock } from './SqlConfirmBlock'
import { MarkdownContent } from './MarkdownContent'

interface MessageBubbleProps {
  message: ChatMessage
  roundNumber: number
}

export function MessageBubble({ message, roundNumber }: MessageBubbleProps) {
  const isUser = message.role === 'user'

  if (isUser) {
    return (
      <div className="flex gap-3 justify-end">
        <div className="max-w-[70%]">
          <div className="rounded-2xl px-4 py-2.5 text-sm leading-relaxed bg-green-700 text-white">
            <p className="whitespace-pre-wrap">{message.content}</p>
          </div>
        </div>
        <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0 mt-1">
          <User className="w-4 h-4 text-gray-600" />
        </div>
      </div>
    )
  }

  const nonSqlToolCalls = message.toolCalls?.filter((tc) => tc.name !== 'execute_sql') ?? []
  const hasThinking = Boolean(message.thinking)
  const hasToolCalls = nonSqlToolCalls.length > 0
  const hasSqlConfirm = Boolean(message.sqlConfirm)
  const hasContent = Boolean(message.content)
  const hasAnyContent = hasThinking || hasToolCalls || hasSqlConfirm || hasContent

  if (!hasAnyContent) return null

  return (
    <div className="space-y-3">
      {hasThinking && (
        <ThinkingBlock content={message.thinking!} round={roundNumber} />
      )}

      {hasToolCalls && (
        <div className="space-y-3">
          {nonSqlToolCalls.map((tc, idx) => (
            <ToolCallStatus key={idx} toolCall={tc} />
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
    </div>
  )
}
