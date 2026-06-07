import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ThinkingBlockProps {
  content: string
  round: number
  index?: number
  isStreaming?: boolean
}

function renderInlineCode(text: string): ReactNode[] {
  const parts = text.split(/(`[^`]+`)/g)
  return parts.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code
          key={i}
          className="bg-gray-200/60 text-gray-700 px-1 py-0.5 rounded text-[12px] font-mono"
        >
          {part.slice(1, -1)}
        </code>
      )
    }
    return <span key={i}>{part}</span>
  })
}

export function ThinkingBlock({ content, round, index, isStreaming }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const shouldAutoScrollRef = useRef(true)

  // Track whether user has manually scrolled away from bottom
  const handleInnerScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    shouldAutoScrollRef.current = isNearBottom
  }, [])

  // Auto-scroll to bottom when content updates during streaming
  useEffect(() => {
    if (!isStreaming || !shouldAutoScrollRef.current) return
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [content, isStreaming])

  let title = round <= 1 ? '思考过程' : `思考过程 (第${round}轮)`
  if (index && index > 1) {
    title += ` #${index}`
  }

  return (
    <div className="border border-gray-700 rounded-xl overflow-hidden bg-white">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-1.5 px-3 py-2 text-[13px] hover:bg-gray-50/50 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
        )}
        <span className="font-medium text-gray-500">{title}</span>
      </button>
      <div
        className={cn(
          'overflow-hidden transition-all duration-200',
          expanded ? 'max-h-[2000px]' : 'max-h-0',
        )}
      >
        <div
          ref={scrollRef}
          onScroll={handleInnerScroll}
          className="px-3 pb-3 text-[13px] text-gray-500 leading-[1.8] whitespace-pre-wrap overflow-y-auto max-h-[500px] border-t border-gray-300"
        >
          <div className="pt-2">
            {renderInlineCode(content)}
          </div>
        </div>
      </div>
    </div>
  )
}
