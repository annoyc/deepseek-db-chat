import type { ChatMessage } from '@/lib/types'
import { User } from 'lucide-react'
import { ThinkingBlock } from './ThinkingBlock'
import { ToolCallStatus } from './ToolCallStatus'
import { QueryPlanBlock } from './QueryPlanBlock'
import { SqlConfirmBlock } from './SqlConfirmBlock'
import { SmartFilterConfirmBlock } from './SmartFilterConfirmBlock'
import { MarkdownContent } from './MarkdownContent'
import { useVizPanel } from './VisualizationPanel'
import { useSettings, type CollapseMode } from '@/hooks/useSettings'
import { useChatStore } from '@/hooks/useChat'
import { useDatabaseStore } from '@/hooks/useDatabase'
import { CopyButton } from '@/components/ui/copy-button'
import { AnswerActionsBar } from '@/components/ui/answer-actions'
import { buildExportFilename, buildMarkdownExport, downloadMarkdownFile } from '@/lib/message-actions'

/** The answer as the user reads it: prose only, without thinking or tool output. */
function getAnswerText(message: ChatMessage): string {
  if (message.parts && message.parts.length > 0) {
    return message.parts
      .flatMap((part) => (part.type === 'text' && part.content.trim() ? [part.content.trim()] : []))
      .join('\n\n')
  }
  return message.content.trim()
}

function AnswerActions({
  message,
  isStreaming,
  questionText,
  isLatestTurn,
  vizMessageIds,
}: {
  message: ChatMessage
  isStreaming?: boolean
  questionText?: string
  isLatestTurn?: boolean
  vizMessageIds?: string[]
}) {
  const { regenerateMessage, setMessageFeedback, isStreaming: anyStreaming } = useChatStore()
  const { activeConnectionId } = useDatabaseStore()
  const vizPanel = useVizPanel()

  // Short lead-ins before a SQL or filter card are not answers worth acting on.
  if (isStreaming || message.sqlConfirm || message.smartFilterConfirm) return null
  const text = getAnswerText(message)
  if (!text) return null

  const latestVizMessageId = vizMessageIds?.[vizMessageIds.length - 1]
  const vizActive = Boolean(
    vizPanel?.isOpen && vizPanel.activeMessageId && vizMessageIds?.includes(vizPanel.activeMessageId),
  )

  const handleExport = () => {
    const markdown = buildMarkdownExport({
      question: questionText,
      answer: text,
      modelName: message.answerModel,
      durationMs: message.answerDuration,
      queryCount: message.answerQueryCount,
    })
    downloadMarkdownFile(buildExportFilename(questionText, '数据分析报告'), markdown)
  }

  return (
    <AnswerActionsBar
      copyText={text}
      onRegenerate={questionText ? () => void regenerateMessage(message.id) : undefined}
      regenerateDisabled={anyStreaming || !activeConnectionId}
      regenerateLabel={isLatestTurn === false ? '从此问题重新生成' : '重新生成'}
      onExportMarkdown={handleExport}
      onOpenViz={vizPanel && latestVizMessageId ? () => (vizActive ? vizPanel.close() : vizPanel.focus(latestVizMessageId)) : undefined}
      vizActive={vizActive}
      feedback={message.feedback}
      onFeedback={(rating) => setMessageFeedback(message.id, rating)}
    />
  )
}

interface MessageBubbleProps {
  message: ChatMessage
  isStreaming?: boolean
  thinkingCollapseMode?: CollapseMode
  toolCallCollapseMode?: CollapseMode
  questionText?: string
  isLatestTurn?: boolean
  vizMessageIds?: string[]
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


function AssistantPartsView({ message, isStreaming, thinkingCollapseMode, toolCallCollapseMode, questionText, isLatestTurn, vizMessageIds }: MessageBubbleProps) {
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
            return <ThinkingBlock key={`t-${i}`} content={part.content} index={idx} isStreaming={thinkingStreaming} collapseMode={thinkingCollapseMode} />
          }
          case 'tool-call': {
            const tc = toolCalls[part.toolCallIndex]
            if (!tc || tc.name === 'execute_sql' || tc.name === 'smart_filter' || tc.name === 'report_analysis') return null
            if (tc.name === 'plan_query') return <div key={`plan-${i}`} className="animate-in fade-in slide-in-from-bottom-2 duration-300"><QueryPlanBlock toolCall={tc} collapseMode={toolCallCollapseMode} /></div>
            return <div key={`tc-${i}`} className="animate-in fade-in slide-in-from-bottom-2 duration-300"><ToolCallStatus toolCall={tc} collapseMode={toolCallCollapseMode} /></div>
          }
          case 'text':
            return part.content ? <MarkdownContent key={`txt-${i}`} content={part.content} isStreaming={isLastText && i === parts.length - 1} /> : null
          default:
            return null
        }
      })}

      {showTailIndicator && <StreamingIndicator text={message.statusText} />}

      <AnswerActions
        message={message}
        isStreaming={isStreaming}
        questionText={questionText}
        isLatestTurn={isLatestTurn}
        vizMessageIds={vizMessageIds}
      />

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

function AssistantLegacyView({ message, isStreaming, thinkingCollapseMode, toolCallCollapseMode, questionText, isLatestTurn, vizMessageIds }: MessageBubbleProps) {
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
  const thinkingStreaming = Boolean(isStreaming && !hasContent && !hasToolCalls && !hasConfirmBlock)

  return (
    <div className="space-y-3 min-w-0 max-w-full animate-in fade-in duration-200">
      {hasThinking && (
        <ThinkingBlock content={message.thinking!} isStreaming={thinkingStreaming} collapseMode={thinkingCollapseMode} />
      )}

      {hasToolCalls && (
        <div className="space-y-3">
          {planToolCalls.map((tc, idx) => (
            <div key={`plan-${idx}`} className="animate-in fade-in slide-in-from-bottom-2 duration-300">
              <QueryPlanBlock toolCall={tc} collapseMode={toolCallCollapseMode} />
            </div>
          ))}
          {nonSqlToolCalls.map((tc, idx) => (
            <div key={idx} className="animate-in fade-in slide-in-from-bottom-2 duration-300">
              <ToolCallStatus toolCall={tc} collapseMode={toolCallCollapseMode} />
            </div>
          ))}
        </div>
      )}

      {hasContent && (
        <MarkdownContent content={message.content} isStreaming={isStreaming} />
      )}

      {showTailIndicator && <StreamingIndicator text={message.statusText} />}

      <AnswerActions
        message={message}
        isStreaming={isStreaming}
        questionText={questionText}
        isLatestTurn={isLatestTurn}
        vizMessageIds={vizMessageIds}
      />

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

export function MessageBubble({ message, isStreaming, questionText, isLatestTurn, vizMessageIds }: MessageBubbleProps) {
  const { thinkingCollapseMode, toolCallCollapseMode } = useSettings()

  if (message.role === 'user') {
    return (
      <div className="group flex gap-3 justify-end animate-in fade-in slide-in-from-bottom-1 duration-200">
        <CopyButton text={message.content} label="复制问题" className="mt-2 self-start opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 hover:bg-white/80" />
        <div className="max-w-[min(72%,760px)]">
          <div className="rounded-2xl rounded-tr-md bg-user-bubble px-4 py-2.5 text-sm leading-relaxed text-white shadow-sm">
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
    return (
      <AssistantPartsView
        message={message}
        isStreaming={isStreaming}
        thinkingCollapseMode={thinkingCollapseMode}
        toolCallCollapseMode={toolCallCollapseMode}
        questionText={questionText}
        isLatestTurn={isLatestTurn}
        vizMessageIds={vizMessageIds}
      />
    )
  }

  return (
    <AssistantLegacyView
      message={message}
      isStreaming={isStreaming}
      thinkingCollapseMode={thinkingCollapseMode}
      toolCallCollapseMode={toolCallCollapseMode}
      questionText={questionText}
      isLatestTurn={isLatestTurn}
      vizMessageIds={vizMessageIds}
    />
  )
}
