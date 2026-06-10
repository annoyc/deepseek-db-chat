import { useState, useEffect } from 'react'
import { ChevronDown, ChevronRight, ListChecks, ArrowRight, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ToolCallInfo } from '@/lib/types'

interface QueryPlanBlockProps {
  toolCall: ToolCallInfo
  defaultExpanded?: boolean
}

interface PlanStep {
  step: number
  description: string
  sql_type: string
  depends_on?: number[]
}

interface PlanData {
  question: string
  complexity: 'moderate' | 'complex'
  involved_tables: string[]
  steps: PlanStep[]
  total_queries: number
  strategy_note?: string
}

const COMPLEXITY_CONFIG = {
  moderate: { label: '中等', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  complex: { label: '复杂', className: 'bg-red-50 text-red-700 border-red-200' },
} as const

export function QueryPlanBlock({ toolCall, defaultExpanded = true }: QueryPlanBlockProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  useEffect(() => {
    setExpanded(defaultExpanded)
  }, [defaultExpanded])

  const isLoading = toolCall.status === 'calling'
  const isCompleted = toolCall.status === 'completed'

  if (isLoading) {
    return (
      <div className="border border-indigo-200 rounded-xl overflow-hidden bg-white">
        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-indigo-100">
          <Loader2 className="w-3.5 h-3.5 text-indigo-500 animate-spin flex-shrink-0" />
          <ListChecks className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" />
          <span className="text-[13px] font-semibold text-gray-800">查询规划</span>
          <span className="text-xs text-indigo-500 ml-0.5 font-medium">分析中...</span>
        </div>
        <div className="px-3 py-3 space-y-2">
          <div className="h-3.5 w-2/3 bg-indigo-50 rounded animate-pulse" />
          <div className="h-3.5 w-4/5 bg-indigo-50 rounded animate-pulse" />
          <div className="h-3.5 w-1/2 bg-indigo-50 rounded animate-pulse" />
        </div>
      </div>
    )
  }

  const plan = toolCall.args as unknown as PlanData
  if (!plan || !plan.steps) return null

  const complexityConfig = COMPLEXITY_CONFIG[plan.complexity] ?? COMPLEXITY_CONFIG.moderate

  return (
    <div className="border border-indigo-200 rounded-xl overflow-hidden bg-white">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-1.5 px-3 py-2 border-b border-indigo-100 hover:bg-indigo-50/30 transition-colors"
      >
        {expanded
          ? <ChevronDown className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
          : <ChevronRight className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />}
        <ListChecks className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" />
        <span className="text-[13px] font-semibold text-gray-800">查询规划</span>
        <span className={cn('text-[11px] px-1.5 py-px rounded-full border font-medium ml-0.5', complexityConfig.className)}>
          {complexityConfig.label}
        </span>
        <span className="text-xs text-gray-400 ml-auto">
          {plan.steps.length} 步 · {plan.total_queries} 条 SQL
        </span>
      </button>

      <div className={cn('overflow-hidden transition-all duration-200', expanded ? 'max-h-[2000px]' : 'max-h-0')}>
        <div className="px-3 py-2.5 space-y-3">
          {plan.involved_tables?.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs text-gray-400">涉及表:</span>
              {plan.involved_tables.map((t) => (
                <span key={t} className="text-[11px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 font-mono border border-indigo-100">
                  {t}
                </span>
              ))}
            </div>
          )}

          <div className="space-y-1.5">
            {plan.steps.map((step, idx) => (
              <div key={step.step} className="flex items-start gap-2">
                <div className="flex flex-col items-center flex-shrink-0 mt-0.5">
                  <div className={cn(
                    'w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold',
                    isCompleted
                      ? 'bg-green-100 text-green-700 border border-green-200'
                      : 'bg-indigo-100 text-indigo-700 border border-indigo-200',
                  )}>
                    {step.step}
                  </div>
                  {idx < plan.steps.length - 1 && (
                    <div className="w-px h-3 bg-gray-200 my-0.5" />
                  )}
                </div>
                <div className="flex-1 min-w-0 pb-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[13px] text-gray-700">{step.description}</span>
                    <span className="text-[10px] px-1.5 py-px rounded bg-gray-100 text-gray-500 border border-gray-200 whitespace-nowrap">
                      {step.sql_type}
                    </span>
                  </div>
                  {step.depends_on && step.depends_on.length > 0 && (
                    <div className="flex items-center gap-1 mt-0.5 text-[11px] text-gray-400">
                      <ArrowRight className="w-3 h-3" />
                      依赖步骤 {step.depends_on.join(', ')}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {plan.strategy_note && (
            <div className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-2 leading-relaxed">
              <span className="font-medium text-gray-600">策略: </span>{plan.strategy_note}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
