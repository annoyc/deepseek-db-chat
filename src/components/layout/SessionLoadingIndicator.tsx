import { cn } from '@/lib/utils'

interface SessionLoadingIndicatorProps {
  size?: 'xs' | 'sm'
  variant?: 'streaming' | 'waiting'
  label?: string
  className?: string
}

export function SessionLoadingIndicator({
  size = 'sm',
  variant = 'streaming',
  label,
  className,
}: SessionLoadingIndicatorProps) {
  const accessibleLabel = label ?? (variant === 'waiting' ? '等待用户确认' : 'AI 正在工作')

  return (
    <span
      className={cn(
        'session-loading-indicator',
        size === 'xs' ? 'session-loading-indicator--xs' : 'session-loading-indicator--sm',
        variant === 'waiting' && 'session-loading-indicator--waiting',
        className,
      )}
      role="status"
      aria-label={accessibleLabel}
      title={accessibleLabel}
    >
      <span className="sr-only">{accessibleLabel}</span>
    </span>
  )
}
