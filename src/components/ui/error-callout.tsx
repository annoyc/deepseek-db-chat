import { AlertCircle, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'

export function needsApiKeyAction(message: string): boolean {
  return /自有\s*API\s*Key|模型服务|尚未配置模型/i.test(message)
}

export interface ErrorCalloutProps {
  message: string
  onOpenSettings?: () => void
  className?: string
}

export function ErrorCallout({ message, onOpenSettings, className }: ErrorCalloutProps) {
  const showSettingsAction = Boolean(onOpenSettings && needsApiKeyAction(message))

  return (
    <div
      role="alert"
      className={cn(
        'rounded-xl border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm text-amber-900 dark:border-amber-800/55 dark:bg-amber-950/45 dark:text-amber-200',
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="whitespace-pre-wrap leading-relaxed">{message}</p>
        </div>
        {showSettingsAction && (
          <button
            type="button"
            onClick={onOpenSettings}
            className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-amber-300/80 bg-white/85 px-3 py-1.5 text-xs font-semibold text-amber-900 shadow-xs transition-colors hover:bg-white dark:border-amber-700/70 dark:bg-amber-900/50 dark:text-amber-100 dark:hover:bg-amber-900/80"
          >
            <Settings className="h-3.5 w-3.5" />
            打开设置配置 API Key
          </button>
        )}
      </div>
    </div>
  )
}
