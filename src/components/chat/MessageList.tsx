import { useEffect, useRef, useMemo, Fragment, useCallback } from 'react'
import type { ChatMessage } from '@/lib/types'
import { MessageBubble } from './MessageBubble'
import { TaskCompleteIndicator } from './TaskCompleteIndicator'
import { WelcomeScreen } from './WelcomeScreen'
import { useChatStore } from '@/hooks/useChat'
import { useSettings } from '@/hooks/useSettings'
import { useDatabaseStore } from '@/hooks/useDatabase'
import { AVAILABLE_MODELS } from '@/lib/constants'

interface MessageListProps {
  messages: ChatMessage[]
}

export function MessageList({ messages }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const { sendMessage, isStreaming } = useChatStore()
  const { activeConnection, connectionStatus, connectionError } = useDatabaseStore()
  const { model } = useSettings()
  const shouldAutoScrollRef = useRef(true)
  const prevLengthRef = useRef(messages.length)

  const currentModelName = AVAILABLE_MODELS.find((m) => m.id === model)?.id ?? model

  // Track if user manually scrolled up
  const handleScroll = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    shouldAutoScrollRef.current = isNearBottom
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

  const roundMap = useMemo(() => {
    let round = 0
    const map = new Map<string, number>()

    for (const msg of messages) {
      if (msg.role === 'user') {
        round = 0
        map.set(msg.id, round)
      } else if (msg.role === 'assistant') {
        round++
        map.set(msg.id, round)
      }
    }

    return map
  }, [messages])

  if (messages.length === 0) {
    return (
      <WelcomeScreen
        onSuggestionClick={sendMessage}
        hasConnection={!!activeConnection}
        connectionName={activeConnection?.name}
        connectionStatus={connectionStatus}
        connectionError={connectionError}
      />
    )
  }

  return (
    <div ref={containerRef} onScroll={handleScroll} className="h-full overflow-y-auto px-[10%] py-4 space-y-4">
      {messages.map((message) => (
        <Fragment key={message.id}>
          <MessageBubble
            message={message}
            roundNumber={roundMap.get(message.id) ?? 0}
            isStreaming={isStreaming}
          />
          {message.role === 'assistant' && message.answerDuration != null && (
            <TaskCompleteIndicator
              duration={message.answerDuration}
              queryCount={message.answerQueryCount ?? 0}
              modelName={currentModelName}
            />
          )}
        </Fragment>
      ))}
      <div ref={bottomRef} />
    </div>
  )
}
