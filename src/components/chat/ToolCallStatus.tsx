import { useState } from 'react'
import { CheckCircle2, ChevronDown, ChevronRight, Loader2, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ToolCallInfo } from '@/lib/types'

interface ToolCallStatusProps {
  toolCall: ToolCallInfo
}

const TOOL_LABELS: Record<string, string> = {
  list_tables: '查看表列表',
  get_table_schema: '查看表结构',
  execute_sql: 'SQL 查询',
}

const TOOL_PARAM_LABELS: Record<string, Record<string, string>> = {
  get_table_schema: { table_name: '表名' },
  list_tables: {},
}

export function ToolCallStatus({ toolCall }: ToolCallStatusProps) {
  const [expanded, setExpanded] = useState(true)
  const label = TOOL_LABELS[toolCall.name] ?? toolCall.name
  const paramLabels = TOOL_PARAM_LABELS[toolCall.name] ?? {}
  const hasResult = toolCall.status === 'completed' && toolCall.result !== undefined
  const isEmptyResult = hasResult && (!toolCall.result || toolCall.result.trim() === '')
  const hasError = toolCall.status === 'error'
  const showCollapse = (hasResult && !isEmptyResult) || hasError

  const borderClass = toolCall.status === 'calling'
    ? 'border border-amber-300'
    : toolCall.status === 'error' ? 'border border-red-300' : 'border border-gray-700'

  const headerBorderClass = toolCall.status === 'calling'
    ? 'border-b border-b-amber-200 bg-amber-50/50'
    : 'border-b border-b-gray-300'

  return (
    <div className={`${borderClass} rounded-xl overflow-hidden bg-white`}>
      <button
        onClick={() => showCollapse && setExpanded(!expanded)}
        className={cn(
          'w-full flex items-center gap-1.5 px-3 py-2 transition-colors',
          headerBorderClass,
          showCollapse && 'hover:bg-gray-50/50',
        )}
      >
        <StatusIcon status={toolCall.status} />
        <span className="text-[13px] font-semibold text-gray-800">{label}</span>
        <StatusBadge status={toolCall.status} />
        {showCollapse && (
          expanded
            ? <ChevronDown className="w-3.5 h-3.5 text-gray-400 flex-shrink-0 ml-auto" />
            : <ChevronRight className="w-3.5 h-3.5 text-gray-400 flex-shrink-0 ml-auto" />
        )}
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
                  <span className="text-gray-500">{paramLabels[key] ?? key}:</span>
                  <span className="border border-gray-300 rounded px-2 py-0.5 text-gray-700 font-mono text-xs bg-white">
                    {formatValue(value)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {toolCall.status === 'calling' && (
            <div className="border-t border-gray-100 pt-2 mt-2 space-y-1.5">
              <div className="h-3 w-3/4 bg-gray-200 rounded animate-pulse" />
              <div className="h-3 w-1/2 bg-gray-200 rounded animate-pulse" />
            </div>
          )}

          {hasError && toolCall.error && (
            <div className="text-[13px] text-red-600 border-t border-gray-100 pt-2 mt-2 whitespace-pre-wrap break-all max-h-40 overflow-y-auto leading-relaxed">
              {toolCall.error}
            </div>
          )}

          {hasResult && (
            <div className={cn('text-[13px] text-gray-500 mt-2 whitespace-pre-wrap break-all max-h-40 overflow-y-auto leading-relaxed', Object.entries(toolCall.args).length > 0 && 'border-t border-gray-100 pt-2')}>
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
      return <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
    case 'error':
      return <XCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
  }
}

function StatusBadge({ status }: { status: ToolCallInfo['status'] }) {
  switch (status) {
    case 'calling':
      return <span className="text-xs text-amber-500 ml-0.5 font-medium">执行中</span>
    case 'completed':
      return (
        <span className="text-xs bg-green-600 text-white px-1.5 py-px rounded-full font-medium ml-0.5">
          成功
        </span>
      )
    case 'error':
      return (
        <span className="text-xs bg-red-500 text-white px-1.5 py-px rounded-full font-medium ml-0.5">
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
