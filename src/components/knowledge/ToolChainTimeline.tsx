import { useState } from 'react'
import {
  AlertCircle,
  Brain,
  Check,
  ChevronRight,
  Circle,
  Globe2,
  ListTree,
  Loader2,
  Server,
  ShieldCheck,
  Sparkles,
  Wand2,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { KnowledgeToolStep } from '@/lib/knowledge-types'

const ICONS: Record<string, LucideIcon> = {
  guardrail: ShieldCheck,
  query_rewrite: Wand2,
  intent_analysis: ListTree,
  memory_query: Brain,
  web_search: Globe2,
  synthesis: Sparkles,
  fixed: Zap,
  request: Server,
}

function iconFor(name: string): LucideIcon {
  return ICONS[name] ?? Circle
}

function formatDuration(ms?: number): string | null {
  if (ms == null) return null
  if (ms < 1) return '<1ms'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
}

function ToolStepRow({ step, isLast }: { step: KnowledgeToolStep; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const Icon = iconFor(step.name)
  const duration = formatDuration(step.durationMs)
  const hasDetail = Boolean(step.detail || step.output)

  const accent =
    step.status === 'error'
      ? 'text-red-500'
      : step.status === 'running'
        ? 'text-primary'
        : 'text-emerald-600'

  return (
    <div className="relative pl-8">
      {!isLast && (
        <span
          className={cn(
            'absolute left-[11px] top-6 h-[calc(100%-8px)] w-px',
            step.status === 'done' ? 'bg-emerald-200' : 'bg-stone-200',
          )}
        />
      )}

      <span
        className={cn(
          'absolute left-0 top-0.5 flex h-6 w-6 items-center justify-center rounded-full border bg-white',
          step.status === 'error'
            ? 'border-red-200'
            : step.status === 'running'
              ? 'border-primary/30'
              : 'border-emerald-200',
        )}
      >
        {step.status === 'running' ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
        ) : step.status === 'error' ? (
          <AlertCircle className="h-3.5 w-3.5 text-red-500" />
        ) : (
          <Check className="h-3.5 w-3.5 text-emerald-600" />
        )}
      </span>

      <div className="pb-3">
        <button
          type="button"
          onClick={() => hasDetail && setExpanded((v) => !v)}
          className={cn(
            'flex w-full items-center gap-2 text-left',
            hasDetail ? 'cursor-pointer' : 'cursor-default',
          )}
        >
          <Icon className={cn('h-3.5 w-3.5 flex-shrink-0', accent)} />
          <span className="text-sm font-medium text-stone-800">{step.title}</span>
          {duration && (
            <span className="rounded-full bg-stone-100 px-1.5 py-0.5 text-[10px] font-medium text-stone-400">
              {duration}
            </span>
          )}
          {hasDetail && (
            <ChevronRight
              className={cn(
                'ml-auto h-3.5 w-3.5 flex-shrink-0 text-stone-300 transition-transform',
                expanded && 'rotate-90',
              )}
            />
          )}
        </button>

        {step.output && !expanded && (
          <p className="mt-0.5 line-clamp-1 text-xs text-stone-500">{step.output}</p>
        )}

        {expanded && (
          <div className="mt-2 space-y-2">
            {step.detail && (
              <div className="rounded-lg bg-stone-50 p-2.5">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-stone-400">
                  输入
                </div>
                <p className="whitespace-pre-wrap text-xs leading-5 text-stone-600">{step.detail}</p>
              </div>
            )}
            {step.output && (
              <div className="rounded-lg border border-stone-200/70 bg-white p-2.5">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-stone-400">
                  输出
                </div>
                <p className="whitespace-pre-wrap text-xs leading-5 text-stone-600">{step.output}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export function ToolChainTimeline({ steps }: { steps: KnowledgeToolStep[] }) {
  if (steps.length === 0) return null
  return (
    <div className="space-y-0">
      {steps.map((step, index) => (
        <ToolStepRow key={step.id} step={step} isLast={index === steps.length - 1} />
      ))}
    </div>
  )
}
