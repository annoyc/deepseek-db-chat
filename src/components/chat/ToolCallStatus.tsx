import { useState, useEffect, useRef } from 'react'
import { CheckCircle2, ChevronDown, ChevronRight, Loader2, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ToolCallInfo } from '@/lib/types'
import { resolveToolCallExpanded, type CollapseMode } from '@/lib/collapse-mode'

interface ToolCallStatusProps {
  toolCall: ToolCallInfo
  collapseMode?: CollapseMode
}

const TOOL_LABELS: Record<string, string> = {
  list_tables: '查看表列表',
  get_table_schema: '查看表结构',
  get_database_overview: '查看数据库概览',
  plan_query: '查询规划',
  smart_filter: '智能筛选',
  execute_sql: 'SQL 查询',
  explain_sql: 'SQL 评估',
}

const TOOL_PARAM_LABELS: Record<string, Record<string, string>> = {
  get_table_schema: { table_name: '表名' },
  list_tables: {},
}

export function ToolCallStatus({ toolCall, collapseMode = 'auto' }: ToolCallStatusProps) {
  const [expanded, setExpanded] = useState(() => resolveToolCallExpanded(collapseMode, toolCall.status))
  const manualToggleRef = useRef(false)

  // 当设置中的折叠策略变化时，重置为该策略对应的状态
  useEffect(() => {
    manualToggleRef.current = false
    setExpanded(resolveToolCallExpanded(collapseMode, toolCall.status))
    // Only reset when the global setting changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapseMode])

  // 智能模式：调用报错时自动展开，方便排查原因（尊重用户手动收起）
  useEffect(() => {
    if (collapseMode !== 'auto' || manualToggleRef.current) return
    if (toolCall.status === 'error') setExpanded(true)
  }, [collapseMode, toolCall.status])
  const label = TOOL_LABELS[toolCall.name] ?? toolCall.name
  const paramLabels = TOOL_PARAM_LABELS[toolCall.name] ?? {}
  const hasResult = toolCall.status === 'completed' && toolCall.result !== undefined
  const isEmptyResult = hasResult && (!toolCall.result || toolCall.result.trim() === '')
  const hasError = toolCall.status === 'error'
  const showCollapse = (hasResult && !isEmptyResult) || hasError

  const borderClass = toolCall.status === 'calling'
    ? 'border border-amber-200 dark:border-amber-800/60'
    : toolCall.status === 'error' ? 'border border-red-200 dark:border-red-800/60' : 'border border-line'

  const headerBorderClass = toolCall.status === 'calling'
    ? 'border-b border-b-amber-100 bg-amber-50/50 dark:border-b-amber-800/40 dark:bg-amber-950/35'
    : 'border-b border-b-line-subtle'

  return (
    <div className={`${borderClass} rounded-xl overflow-hidden bg-surface`}>
      <button
        onClick={() => {
          if (!showCollapse) return
          manualToggleRef.current = true
          setExpanded((prev) => !prev)
        }}
        className={cn(
          'w-full flex items-center gap-1.5 px-3 py-2 transition-colors',
          headerBorderClass,
          showCollapse && 'hover:bg-surface-hover',
        )}
      >
        {showCollapse && (
          expanded
            ? <ChevronDown className="w-3.5 h-3.5 text-ink-faint flex-shrink-0" />
            : <ChevronRight className="w-3.5 h-3.5 text-ink-faint flex-shrink-0" />
        )}
        <StatusIcon status={toolCall.status} />
        <span className="text-[13px] font-semibold text-ink">{label}</span>
        <span role="status" className="inline-flex"><StatusBadge status={toolCall.status} /></span>
      </button>

      <div
        className={cn(
          'overflow-hidden transition-all duration-200',
          expanded ? 'max-h-[2000px]' : 'max-h-0',
        )}
      >
        <div className="px-3 py-2.5 space-y-2">
          {Object.entries(toolCall.args).length > 0 && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {Object.entries(toolCall.args).map(([key, value]) => (
                <div key={key} className="flex items-center gap-1.5 text-[13px]">
                  <span className="text-ink-muted">{paramLabels[key] ?? key}:</span>
                  <span className="border border-line rounded px-2 py-0.5 text-ink-secondary font-mono text-xs bg-surface-muted">
                    {formatValue(value)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {toolCall.status === 'calling' && (
            <div className="border-t border-line-subtle pt-2 mt-2 space-y-1.5">
              <div className="h-3 w-3/4 bg-surface-hover rounded animate-pulse" />
              <div className="h-3 w-1/2 bg-surface-hover rounded animate-pulse" />
            </div>
          )}

          {hasError && toolCall.error && (
            <div className="text-[13px] text-red-600 dark:text-red-400 border-t border-line-subtle pt-2 mt-2 whitespace-pre-wrap break-all max-h-40 overflow-y-auto leading-relaxed">
              {toolCall.error}
            </div>
          )}

          {hasResult && (
            <div className={cn('text-[13px] text-ink-muted mt-2 whitespace-pre-wrap break-all max-h-40 overflow-y-auto leading-relaxed', Object.entries(toolCall.args).length > 0 && 'border-t border-line-subtle pt-2')}>
              {isEmptyResult ? '无数据' : truncateResult(toolCall.result!)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function StatusIcon({ status }: { status: ToolCallInfo['status'] }) {
  switch (status) {
    case 'calling':
      return <Loader2 className="w-3.5 h-3.5 text-amber-500 animate-spin flex-shrink-0" />
    case 'completed':
      return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
    case 'error':
      return <XCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
  }
}

function StatusBadge({ status }: { status: ToolCallInfo['status'] }) {
  switch (status) {
    case 'calling':
      return <span className="text-xs text-amber-600 dark:text-amber-400 ml-0.5 font-medium">执行中</span>
    case 'completed':
      return <span className="sr-only">成功</span>
    case 'error':
      return (
        <span className="text-xs border border-red-200 bg-red-50 text-red-700 dark:border-red-800/50 dark:bg-red-950/45 dark:text-red-300 px-1.5 py-px rounded-full font-medium ml-0.5">
          失败
        </span>
      )
  }
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return String(value)
  return JSON.stringify(value)
}

function truncateResult(result: string): string {
  if (result.length <= 800) return result
  return result.slice(0, 800) + '...'
}
