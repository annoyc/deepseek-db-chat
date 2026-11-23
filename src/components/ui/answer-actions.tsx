import { useCallback, useEffect, useRef, useState } from 'react'
import { BarChart3, Check, Download, RotateCcw, ThumbsDown, ThumbsUp } from 'lucide-react'
import { CopyButton } from './copy-button'
import { cn } from '@/lib/utils'
import type { AnswerFeedback } from '@/lib/message-actions'

export interface AnswerActionsBarProps {
  copyText: string
  onRegenerate?: () => void
  regenerateDisabled?: boolean
  regenerateLabel?: string
  onExportMarkdown?: () => void
  onOpenViz?: () => void
  vizActive?: boolean
  feedback?: AnswerFeedback
  onFeedback?: (rating: AnswerFeedback | null) => void
  className?: string
}

const ACTION_BTN =
  'inline-flex items-center justify-center rounded-md p-1.5 text-stone-400 transition-colors hover:bg-white/80 hover:text-stone-700 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-40'

export function AnswerActionsBar({
  copyText,
  onRegenerate,
  regenerateDisabled = false,
  regenerateLabel = '重新生成',
  onExportMarkdown,
  onOpenViz,
  vizActive = false,
  feedback,
  onFeedback,
  className,
}: AnswerActionsBarProps) {
  const [exported, setExported] = useState(false)
  const exportTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(exportTimerRef.current), [])

  const handleExport = useCallback(() => {
    if (!onExportMarkdown) return
    onExportMarkdown()
    setExported(true)
    clearTimeout(exportTimerRef.current)
    exportTimerRef.current = setTimeout(() => setExported(false), 1800)
  }, [onExportMarkdown])

  const handleFeedback = useCallback(
    (rating: AnswerFeedback) => {
      if (!onFeedback) return
      onFeedback(feedback === rating ? null : rating)
    },
    [feedback, onFeedback],
  )

  return (
    <div className={cn('flex items-center gap-0.5 px-1', className)} role="toolbar" aria-label="回答操作">
      <CopyButton text={copyText} label="复制回答" className="p-1.5 hover:bg-white/80" />

      {onRegenerate && (
        <button
          type="button"
          onClick={onRegenerate}
          disabled={regenerateDisabled}
          title={regenerateLabel}
          aria-label={regenerateLabel}
          className={ACTION_BTN}
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      )}

      {onExportMarkdown && (
        <button
          type="button"
          onClick={handleExport}
          title={exported ? '已导出 Markdown' : '导出 Markdown'}
          aria-label={exported ? '已导出 Markdown' : '导出 Markdown'}
          className={ACTION_BTN}
        >
          {exported ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Download className="h-3.5 w-3.5" />}
        </button>
      )}

      {onOpenViz && (
        <button
          type="button"
          onClick={onOpenViz}
          title={vizActive ? '收起数据面板' : '在数据面板中查看数据与图表'}
          aria-label={vizActive ? '收起数据面板' : '在数据面板中查看数据与图表'}
          aria-pressed={vizActive}
          className={cn(
            ACTION_BTN,
            vizActive && 'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary',
          )}
        >
          <BarChart3 className="h-3.5 w-3.5" />
        </button>
      )}

      {onFeedback && (
        <>
          <span className="mx-1 h-3 w-px bg-stone-200/90" aria-hidden="true" />
          <button
            type="button"
            onClick={() => handleFeedback('up')}
            title={feedback === 'up' ? '取消点赞' : '回答有帮助'}
            aria-label={feedback === 'up' ? '取消点赞' : '回答有帮助'}
            aria-pressed={feedback === 'up'}
            className={cn(
              ACTION_BTN,
              feedback === 'up' && 'bg-emerald-50/90 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700',
            )}
          >
            <ThumbsUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => handleFeedback('down')}
            title={feedback === 'down' ? '取消点踩' : '回答有待改进'}
            aria-label={feedback === 'down' ? '取消点踩' : '回答有待改进'}
            aria-pressed={feedback === 'down'}
            className={cn(
              ACTION_BTN,
              feedback === 'down' && 'bg-rose-50/90 text-rose-600 hover:bg-rose-50 hover:text-rose-700',
            )}
          >
            <ThumbsDown className="h-3.5 w-3.5" />
          </button>
        </>
      )}
    </div>
  )
}
