import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { resolveThinkingExpanded, type CollapseMode } from '@/lib/collapse-mode'

interface ThinkingBlockProps {
  content: string
  index?: number
  isStreaming?: boolean
  collapseMode?: CollapseMode
}

function renderInlineCode(text: string): ReactNode[] {
  const parts = text.split(/(`[^`]+`)/g)
  return parts.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code
          key={i}
          className="bg-surface-hover text-ink-secondary px-1 py-0.5 rounded text-[12px] font-mono"
        >
          {part.slice(1, -1)}
        </code>
      )
    }
    return <span key={i}>{part}</span>
  })
}

export function ThinkingBlock({ content, index, isStreaming = false, collapseMode = 'auto' }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(() => resolveThinkingExpanded(collapseMode, isStreaming))
  const [manualToggle, setManualToggle] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const shouldAutoScrollRef = useRef(true)

  // 当设置中的折叠策略变化时，重置为该策略对应的状态
  useEffect(() => {
    setManualToggle(false)
    setExpanded(resolveThinkingExpanded(collapseMode, isStreaming))
    // Only reset when the global setting changes, not on every streaming tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapseMode])

  // 智能模式：思考中自动展开预览，思考结束后自动收起（尊重用户手动点击）
  useEffect(() => {
    if (collapseMode !== 'auto' || manualToggle) return
    setExpanded(isStreaming)
  }, [collapseMode, isStreaming, manualToggle])

  const handleToggle = useCallback(() => {
    setManualToggle(true)
    setExpanded((prev) => !prev)
  }, [])

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

  let title = isStreaming
    ? '思考中...'
    : (index && index > 1) ? `思考过程 #${index}` : '思考过程'

  return (
    <div className="border border-line rounded-xl overflow-hidden bg-surface">
      <button
        type="button"
        onClick={handleToggle}
        className="w-full flex items-center gap-1.5 px-3 py-2 text-[13px] hover:bg-surface-hover transition-colors border-b border-line-subtle"
      >
        {isStreaming && <span className="streaming-thinking-dot flex-shrink-0" aria-hidden="true" />}
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-ink-faint flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-ink-faint flex-shrink-0" />
        )}
        <span className="font-medium text-ink-muted" aria-live="polite">{title}</span>
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
          className={cn(
            'px-3 pb-3 text-[13px] text-ink-muted leading-[1.8] whitespace-pre-wrap overflow-y-auto',
            collapseMode === 'auto' && isStreaming && !manualToggle ? 'max-h-[220px]' : 'max-h-[500px]',
          )}
        >
          <div className="pt-2">
            {renderInlineCode(content)}
          </div>
        </div>
      </div>
    </div>
  )
}
