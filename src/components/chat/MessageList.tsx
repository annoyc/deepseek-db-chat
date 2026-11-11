import { useEffect, useRef, useState, Fragment, useCallback } from 'react'
import { ArrowDown } from 'lucide-react'
import type { ChatMessage } from '@/lib/types'
import { MessageBubble } from './MessageBubble'
import { TaskCompleteIndicator } from './TaskCompleteIndicator'
import { useChatStore } from '@/hooks/useChat'

interface MessageListProps {
  messages: ChatMessage[]
}

export function MessageList({ messages }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const { isStreaming } = useChatStore()
  const shouldAutoScrollRef = useRef(true)
  const prevLengthRef = useRef(messages.length)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)

  // Track if user manually scrolled up
  const handleScroll = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    shouldAutoScrollRef.current = isNearBottom
    setShowScrollToBottom(!isNearBottom)
  }, [])

  const scrollToBottom = useCallback(() => {
    shouldAutoScrollRef.current = true
    setShowScrollToBottom(false)
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    const isNewMessage = messages.length > prevLengthRef.current
    prevLengthRef.current = messages.length

    if (!shouldAutoScrollRef.current && !isNewMessage) return
    if (isNewMessage) shouldAutoScrollRef.current = true

    const el = containerRef.current
    if (!el) return

    if (isStreaming) {
      el.scrollTop = el.scrollHeight
    } else {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, isStreaming])

  if (messages.length === 0) {
    return null
  }

  const lastAssistantId = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return messages[i].id
    }
    return null
  })()

  return (
    <div className="relative h-full">
    <div ref={containerRef} onScroll={handleScroll} className="subtle-scrollbar h-full overflow-y-auto overflow-x-hidden px-4 py-5 md:px-6 lg:px-[6%] 2xl:px-[12%]">
      <div className="mx-auto max-w-4xl space-y-4 2xl:max-w-5xl">
        {messages.map((message) => (
          <Fragment key={message.id}>
            <MessageBubble
              message={message}
              isStreaming={isStreaming && message.id === lastAssistantId}
            />
            {message.role === 'assistant' && message.answerDuration != null && (
              <TaskCompleteIndicator
                duration={message.answerDuration}
                queryCount={message.answerQueryCount ?? 0}
                modelName={message.answerModel ?? ''}
              />
            )}
          </Fragment>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
    {showScrollToBottom && (
      <button
        type="button"
        onClick={scrollToBottom}
        className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs text-stone-600 shadow-md transition-colors hover:border-primary/30 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary animate-in fade-in slide-in-from-bottom-1 duration-200"
      >
        <ArrowDown className="h-3.5 w-3.5" />
        {isStreaming ? '回到最新内容 · 生成中' : '回到最新内容'}
      </button>
    )}
    </div>
  )
}
