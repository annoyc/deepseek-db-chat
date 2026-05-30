import { Clock } from 'lucide-react'

interface TaskCompleteIndicatorProps {
  duration: number
  queryCount: number
  modelName: string
}

export function TaskCompleteIndicator({ duration, queryCount, modelName }: TaskCompleteIndicatorProps) {
  const formatted = formatDuration(duration)

  return (
    <div className="flex items-center gap-1.5 pt-0 pb-1 px-1">
      <Clock className="w-3.5 h-3.5 text-gray-400" />
      <span className="text-xs text-gray-400">
        总耗时 {formatted}
      </span>
      <span className="text-gray-300">·</span>
      <span className="text-xs text-gray-400">
        {queryCount}次查询
      </span>
      <span className="text-gray-300">·</span>
      <span className="text-xs text-gray-400">
        {modelName}
      </span>
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
