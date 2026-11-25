import { Clock } from 'lucide-react'
import type { TokenUsage } from '@/lib/types'
import { formatTokenCount, formatUsageCost, formatUsageTooltip } from '@/lib/usage'

interface TaskCompleteIndicatorProps {
  duration: number
  queryCount: number
  modelName: string
  usage?: TokenUsage
}

export function TaskCompleteIndicator({ duration, queryCount, modelName, usage }: TaskCompleteIndicatorProps) {
  const formatted = formatDuration(duration)
  const hasTokens = Boolean(usage && usage.totalTokens > 0)
  const hasCost = Boolean(usage && typeof usage.cost === 'number' && Number.isFinite(usage.cost))
  const usageTooltip = usage && (hasTokens || hasCost) ? formatUsageTooltip(usage) : undefined

  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 pt-0 pb-1 px-1">
      <Clock className="w-3.5 h-3.5 text-ink-faint" />
      <span className="text-xs text-ink-faint tabular-nums">
        总耗时 {formatted}
      </span>
      <span className="text-ink-faint/60">·</span>
      <span className="text-xs text-ink-faint tabular-nums">
        {queryCount}次查询
      </span>
      {hasTokens && usage && (
        <>
          <span className="text-ink-faint/60">·</span>
          <span
            className="text-xs text-ink-faint tabular-nums cursor-help decoration-line-strong hover:text-ink-secondary"
            title={usageTooltip}
          >
            {formatTokenCount(usage.totalTokens)} tokens
          </span>
        </>
      )}
      {hasCost && usage && usage.cost !== undefined && (
        <>
          <span className="text-ink-faint/60">·</span>
          <span
            className="text-xs text-ink-faint tabular-nums cursor-help hover:text-ink-secondary"
            title={usageTooltip}
          >
            {formatUsageCost(usage.cost, usage.costCurrency)}
          </span>
        </>
      )}
      {modelName && (
        <>
          <span className="text-ink-faint/60">·</span>
          <span className="text-xs text-ink-faint">
            {modelName}
          </span>
        </>
      )}
    </div>
  )
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.round(seconds % 60)
  return `${minutes}m ${remainingSeconds}s`
}
