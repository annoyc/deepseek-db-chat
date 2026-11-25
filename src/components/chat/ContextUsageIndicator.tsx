import { useState } from 'react'
import { AlertTriangle, Pencil, Plus, RotateCcw } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { parseContextWindowInput, type ContextUsageSummary, type ContextWindowSource } from '@/lib/context-window'
import { formatTokenCount, formatUsageCost } from '@/lib/usage'

export interface ContextUsageIndicatorProps {
  usage: ContextUsageSummary
  modelName: string
  isStreaming?: boolean
  canStartNewSession?: boolean
  onNewSession?: () => void
  onSetContextWindow?: (tokens: number | null) => void
  systemLabel?: string
  toolLabel?: string
  historyNote?: string
}

export interface ContextUsagePopoverBodyProps extends ContextUsageIndicatorProps {
  onRequestClose?: () => void
}

const RING_RADIUS = 7.5
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

const WINDOW_PRESETS = [
  { label: '32k', tokens: 32_000 },
  { label: '64k', tokens: 64_000 },
  { label: '128k', tokens: 128_000 },
  { label: '200k', tokens: 200_000 },
  { label: '256k', tokens: 256_000 },
  { label: '1M', tokens: 1_000_000 },
] as const

const LEVEL_STYLES = {
  normal: {
    pill: 'border-line bg-surface/75 text-ink-secondary hover:bg-surface hover:text-ink',
    ring: 'stroke-primary',
    text: 'text-ink-secondary',
    accentText: 'text-primary',
    systemBar: 'bg-primary',
    badge: 'bg-primary/10 text-primary',
  },
  warning: {
    pill: 'border-amber-300/80 bg-amber-50/80 text-amber-700 hover:bg-amber-50 dark:border-amber-700/60 dark:bg-amber-950/45 dark:text-amber-300 dark:hover:bg-amber-950/65',
    ring: 'stroke-amber-500',
    text: 'text-amber-700 dark:text-amber-300',
    accentText: 'text-amber-700 dark:text-amber-300',
    systemBar: 'bg-amber-500',
    badge: 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
  },
  danger: {
    pill: 'border-red-300/80 bg-red-50/85 text-red-700 hover:bg-red-50 dark:border-red-700/60 dark:bg-red-950/45 dark:text-red-300 dark:hover:bg-red-950/65',
    ring: 'stroke-red-500',
    text: 'text-red-700 dark:text-red-300',
    accentText: 'text-red-700 dark:text-red-300',
    systemBar: 'bg-red-500',
    badge: 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300',
  },
} as const

function sourceBadgeLabel(usage: ContextUsageSummary): string {
  if (usage.source === 'idle') return '空闲'
  if (usage.source === 'measured') return usage.includesDraftEstimate ? '实测 + 估算' : '实测'
  return '估算'
}

function windowSourceSuffix(source: ContextWindowSource): string {
  if (source === 'user') return '（自定义）'
  if (source === 'api') return '（接口获取）'
  if (source === 'default') return '（默认上限）'
  return ''
}

function segmentWidthPercent(tokens: number, maxTokens: number): number {
  if (tokens <= 0 || maxTokens <= 0) return 0
  return Math.min(100, (tokens / maxTokens) * 100)
}

export function ContextUsagePopoverBody({
  usage,
  modelName,
  isStreaming = false,
  canStartNewSession = false,
  onNewSession,
  onSetContextWindow,
  systemLabel = '系统提示与工具',
  toolLabel = '工具结果与 SQL 记录',
  historyNote,
  onRequestClose,
}: ContextUsagePopoverBodyProps) {
  const [editingWindow, setEditingWindow] = useState(false)
  const [windowInput, setWindowInput] = useState('')
  const [windowError, setWindowError] = useState('')

  const style = LEVEL_STYLES[usage.level]
  const badgeText = sourceBadgeLabel(usage)
  const { breakdown, maxTokens } = usage

  const segments = [
    { key: 'system', label: systemLabel, tokens: breakdown.systemTokens, barClass: style.systemBar, dotClass: style.systemBar },
    {
      key: 'history',
      label: usage.turnCount > 0 ? `对话历史（${usage.turnCount} 轮）` : '对话历史',
      tokens: breakdown.historyTokens,
      barClass: 'bg-teal-400',
      dotClass: 'bg-teal-400',
    },
    { key: 'tools', label: toolLabel, tokens: breakdown.toolOrEvidenceTokens, barClass: 'bg-sky-400', dotClass: 'bg-sky-400' },
    { key: 'draft', label: '当前输入草稿', tokens: breakdown.draftTokens, barClass: 'bg-amber-400', dotClass: 'bg-amber-400' },
  ].filter(item => item.tokens > 0)

  const handleOpenEditor = () => {
    setWindowInput(formatTokenCount(maxTokens))
    setWindowError('')
    setEditingWindow((prev) => !prev)
  }

  const handleApplyWindow = (tokens: number | null) => {
    if (!onSetContextWindow) return
    onSetContextWindow(tokens)
    setEditingWindow(false)
    setWindowError('')
  }

  const handleSubmitWindowInput = () => {
    const parsed = parseContextWindowInput(windowInput)
    if (parsed === null) {
      setWindowError('请输入合法大小，如 128k、256k、1M 或 200000')
      return
    }
    handleApplyWindow(parsed)
  }

  const handleNewSession = () => {
    if (!onNewSession || isStreaming) return
    onRequestClose?.()
    onNewSession()
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-ink">上下文占用</span>
        <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', style.badge)}>
          {badgeText}
        </span>
      </div>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-xs text-ink-muted tabular-nums">
            <span className="text-sm font-semibold text-ink">{formatTokenCount(usage.usedTokens)}</span>
            <span> / {formatTokenCount(maxTokens)} tokens</span>
          </div>
          <span className={cn('text-sm font-semibold tabular-nums', style.accentText)}>
            {usage.percentText}
          </span>
        </div>

        <div className="flex h-2 w-full overflow-hidden rounded-full bg-surface-muted" role="progressbar" aria-valuenow={Math.round(usage.rawRatio * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="上下文窗口占用比例">
          {segments.map((seg) => (
            <div
              key={seg.key}
              className={cn('h-full transition-[width] duration-300 first:rounded-l-full last:rounded-r-full', seg.barClass)}
              style={{ width: `${segmentWidthPercent(seg.tokens, maxTokens)}%` }}
            />
          ))}
        </div>
      </div>

      {usage.source === 'idle' ? (
        <p className="rounded-xl bg-surface-muted px-3 py-2 text-xs leading-relaxed text-ink-muted">
          新对话尚未占用上下文。发送消息后将按模型接口返回的真实 Token 精确更新。
        </p>
      ) : (
        <div className="space-y-1.5">
          {segments.map((seg) => (
            <div key={seg.key} className="flex items-center justify-between gap-2 text-xs">
              <span className="flex min-w-0 items-center gap-1.5 text-ink-secondary">
                <span className={cn('h-2 w-2 shrink-0 rounded-full', seg.dotClass)} />
                <span className="truncate">{seg.label}</span>
              </span>
              <span className="shrink-0 font-medium text-ink tabular-nums">
                {formatTokenCount(seg.tokens)}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1 border-t border-line-subtle pt-2.5 text-xs text-ink-muted">
        <div className="flex items-center justify-between gap-2">
          <span>剩余可用</span>
          <span className="font-medium text-ink-secondary tabular-nums">{formatTokenCount(usage.remainingTokens)} tokens</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="shrink-0">模型窗口</span>
          <div className="flex min-w-0 items-center gap-1">
            <span className="truncate text-right text-ink-secondary">
              {modelName} · {formatTokenCount(maxTokens)}
              {windowSourceSuffix(usage.windowSource)}
            </span>
            {onSetContextWindow && (
              <button
                type="button"
                onClick={handleOpenEditor}
                aria-label="设置模型上下文窗口"
                title="设置模型上下文窗口"
                className="shrink-0 rounded p-0.5 text-ink-faint transition-colors hover:bg-surface-hover hover:text-primary"
              >
                <Pencil className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        {editingWindow && onSetContextWindow && (
          <div className="mt-1.5 space-y-2 rounded-xl border border-line bg-surface-muted/90 p-2.5">
            <div className="flex flex-wrap gap-1">
              {WINDOW_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => handleApplyWindow(preset.tokens)}
                  className={cn(
                    'rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors',
                    maxTokens === preset.tokens
                      ? 'border-primary/40 bg-primary/10 text-primary'
                      : 'border-line bg-surface text-ink-secondary hover:border-primary/30 hover:text-primary',
                  )}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={windowInput}
                onChange={(e) => { setWindowInput(e.target.value); setWindowError('') }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleSubmitWindowInput()
                  }
                }}
                placeholder="如 128k / 1M"
                aria-label="自定义上下文窗口大小"
                className="min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-2 py-1 font-mono text-xs text-ink outline-none focus:border-primary"
              />
              <button
                type="button"
                onClick={handleSubmitWindowInput}
                className="shrink-0 rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                保存
              </button>
            </div>
            {windowError && <p role="alert" className="text-[11px] text-red-600 dark:text-red-400">{windowError}</p>}
            {usage.windowSource === 'user' && (
              <button
                type="button"
                onClick={() => handleApplyWindow(null)}
                className="inline-flex items-center gap-1 text-[11px] text-ink-muted hover:text-primary"
              >
                <RotateCcw className="h-3 w-3" />
                恢复自动识别
              </button>
            )}
          </div>
        )}

        {usage.cachedTokens !== undefined && usage.cachedTokens > 0 && (
          <div className="flex items-center justify-between gap-2">
            <span>缓存命中</span>
            <span className="font-medium text-emerald-700 dark:text-emerald-400 tabular-nums">
              {formatTokenCount(usage.cachedTokens)}
              {usage.cacheHitRate !== undefined ? ` (${Math.round(usage.cacheHitRate * 100)}%)` : ''}
            </span>
          </div>
        )}
        {usage.sessionUsage && usage.sessionUsage.totalTokens > 0 && (
          <div className="flex items-center justify-between gap-2">
            <span>会话累计消耗</span>
            <span className="text-ink-secondary tabular-nums">
              {formatTokenCount(usage.sessionUsage.totalTokens)} tokens
              {typeof usage.sessionUsage.cost === 'number' && Number.isFinite(usage.sessionUsage.cost)
                ? ` · ${formatUsageCost(usage.sessionUsage.cost, usage.sessionUsage.costCurrency)}`
                : ''}
            </span>
          </div>
        )}
        {historyNote && (
          <p className="pt-1 text-[11px] leading-relaxed text-ink-faint">{historyNote}</p>
        )}
      </div>

      {usage.level === 'danger' && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700 dark:border-red-800/50 dark:bg-red-950/45 dark:text-red-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>上下文接近上限，继续对话可能截断历史或降低质量，建议开启新对话。</span>
        </div>
      )}

      {usage.level === 'warning' && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:border-amber-800/50 dark:bg-amber-950/45 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>上下文占用较高，切换话题时建议开启新对话。</span>
        </div>
      )}

      {canStartNewSession && onNewSession && (
        <button
          type="button"
          onClick={handleNewSession}
          disabled={isStreaming}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-line bg-surface-muted px-3 py-2 text-xs font-medium text-ink-secondary transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" />
          开启新对话
        </button>
      )}
    </div>
  )
}

export function ContextUsageIndicator(props: ContextUsageIndicatorProps) {
  const [open, setOpen] = useState(false)
  const { usage } = props
  const style = LEVEL_STYLES[usage.level]
  const visibleRatio = usage.usedTokens > 0 ? Math.max(usage.ratio, 0.03) : 0
  const dashOffset = RING_CIRCUMFERENCE * (1 - visibleRatio)
  const label = `上下文占用 ${formatTokenCount(usage.usedTokens)} / ${formatTokenCount(usage.maxTokens)} (${usage.percentText})，点击查看详情`

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          className={cn(
            'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary',
            style.pill,
          )}
        >
          <svg
            viewBox="0 0 20 20"
            className="h-3.5 w-3.5 -rotate-90 shrink-0"
            aria-hidden="true"
          >
            <circle
              cx="10"
              cy="10"
              r={RING_RADIUS}
              fill="none"
              strokeWidth="2.2"
              className="stroke-line"
            />
            <circle
              cx="10"
              cy="10"
              r={RING_RADIUS}
              fill="none"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={dashOffset}
              className={cn('transition-[stroke-dashoffset] duration-300 motion-reduce:transition-none', style.ring)}
            />
          </svg>
          <span className={style.text}>{usage.percentText}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-80 rounded-2xl border border-line bg-popover/95 p-4 shadow-xl backdrop-blur-md"
      >
        <ContextUsagePopoverBody {...props} onRequestClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  )
}
