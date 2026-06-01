import { useEffect, useRef, useMemo, Fragment, useCallback } from 'react'
import type { ChatMessage } from '@/lib/types'
import { MessageBubble } from './MessageBubble'
import { TaskCompleteIndicator } from './TaskCompleteIndicator'
import { useChatStore } from '@/hooks/useChat'
import { useSettings } from '@/hooks/useSettings'
import { Database } from 'lucide-react'
import { AVAILABLE_MODELS } from '@/lib/constants'

interface MessageListProps {
  messages: ChatMessage[]
}

export function MessageList({ messages }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const { sendMessage, isStreaming } = useChatStore()
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
      <div className="h-full flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-gray-200/80 flex items-center justify-center">
            <Database className="w-7 h-7 text-gray-400" />
          </div>
          <p className="text-sm text-gray-500">
            你可以问我关于数据库的任何问题
          </p>
          <div className="flex flex-wrap justify-center gap-2 max-w-md">
            {[
              '这个数据库有哪些表?',
              '帮我查看 users 表的结构',
              '查询最近 7 天的数据量趋势',
            ].map((q) => (
              <button
                key={q}
                onClick={() => sendMessage(q)}
                className="px-3 py-1.5 text-xs text-gray-600 border border-gray-300 rounded-full hover:border-green-500 hover:text-green-700 hover:bg-green-50/50 transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div ref={containerRef} onScroll={handleScroll} className="h-full overflow-y-auto px-[10%] py-4 space-y-4">
      {messages.map((message) => (
        <Fragment key={message.id}>
          <MessageBubble
            message={message}
            roundNumber={roundMap.get(message.id) ?? 0}
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
