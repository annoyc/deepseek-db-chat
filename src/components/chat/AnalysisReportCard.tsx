import { useMemo, memo } from 'react'
import { TrendingUp, TrendingDown, Minus, Lightbulb } from 'lucide-react'
import type { AnalysisReport, AnalysisMetric, SqlResultInfo } from '@/lib/types'
import { ResultChart, analyzeChartData, type ChartType, type ChartHint } from './ResultChart'

interface AnalysisReportCardProps {
  report: AnalysisReport
  result?: SqlResultInfo
  sqlChartType?: ChartType
  onQueryClick?: (query: string) => void
}

function TrendIcon({ trend }: { trend?: 'up' | 'down' | 'stable' }) {
  if (trend === 'up') return <TrendingUp className="w-3 h-3 text-emerald-500" />
  if (trend === 'down') return <TrendingDown className="w-3 h-3 text-red-500" />
  if (trend === 'stable') return <Minus className="w-3 h-3 text-gray-400" />
  return null
}

function MetricItem({ metric }: { metric: AnalysisMetric }) {
  const trendColor = metric.trend === 'up'
    ? 'text-emerald-600'
    : metric.trend === 'down'
      ? 'text-red-600'
      : 'text-gray-500'

  const hasTrend = metric.trend || metric.changePercent != null

  return (
    <div className="rounded-lg border border-gray-200 bg-white px-2.5 py-2 flex items-center gap-2">
      <div className="flex-1 min-w-0">
        <span className="text-[10px] text-gray-500 font-medium truncate block">{metric.name}</span>
        <div className="flex items-baseline gap-1">
          <span className="text-sm font-semibold text-gray-900 tracking-tight">{metric.value}</span>
          {metric.unit && <span className="text-[10px] text-gray-400">{metric.unit}</span>}
        </div>
      </div>
      {hasTrend && (
        <div className={`flex flex-col items-center flex-shrink-0 ${trendColor}`}>
          <TrendIcon trend={metric.trend} />
          {metric.changePercent != null && (
            <span className="text-[10px] font-medium leading-tight">
              {metric.changePercent > 0 ? '+' : ''}{metric.changePercent.toFixed(1)}%
            </span>
          )}
        </div>
      )}
    </div>
  )
}

const ALTERNATIVE_ORDER: ChartType[] = ['line', 'area', 'bar', 'pie']

function pickDifferentType(avoid: ChartType, pieDisabled: boolean): ChartType {
  for (const t of ALTERNATIVE_ORDER) {
    if (t === avoid) continue
    if (t === 'pie' && pieDisabled) continue
    return t
  }
  return 'bar'
}

export const AnalysisReportCard = memo(function AnalysisReportCard({ report, result, sqlChartType, onQueryClick }: AnalysisReportCardProps) {
  const gridCols = report.metrics.length <= 2
    ? 'grid-cols-2'
    : report.metrics.length <= 3
      ? 'grid-cols-3'
      : 'grid-cols-2 sm:grid-cols-4'

  const suggestion = report.chartSuggestion
  const canRenderChart = !!(result && suggestion && suggestion.type !== 'table')

  const chartHint = useMemo<ChartHint | undefined>(() => {
    if (!canRenderChart) return undefined
    return {
      xAxis: suggestion!.xAxis,
      yAxis: suggestion!.yAxis,
      labelCol: suggestion!.labelCol ?? result?.chartColumnHint?.labelCol,
      valueCols: suggestion!.valueCols ?? result?.chartColumnHint?.valueCols,
    }
  }, [canRenderChart, suggestion, result?.chartColumnHint])

  const analysisChartType = useMemo<ChartType | undefined>(() => {
    if (!canRenderChart || !result || !suggestion) return undefined
    const aiType = suggestion.type as ChartType
    const autoType = sqlChartType
    if (!autoType || aiType !== autoType) return aiType
    const analysis = analyzeChartData(result.columns, result.rows, chartHint)
    const pieDisabled = !analysis || analysis.valueCols.length > 1 || analysis.data.length > 10
    return pickDifferentType(autoType, pieDisabled)
  }, [canRenderChart, result, suggestion, sqlChartType, chartHint])

  return (
    <div className="rounded-xl border border-gray-200 bg-gradient-to-b from-gray-50/80 to-white overflow-hidden animate-in fade-in slide-in-from-bottom-3 duration-400">
      {/* Summary */}
      <div className="px-3 pt-2.5 pb-1.5">
        <p className="text-xs text-gray-700 font-medium leading-relaxed">{report.summary}</p>
      </div>

      {/* Metric Cards */}
      {report.metrics.length > 0 && (
        <div className={`grid ${gridCols} gap-2 px-3 pb-2`}>
          {report.metrics.map((m, i) => (
            <MetricItem key={i} metric={m} />
          ))}
        </div>
      )}

      {/* Chart */}
      {canRenderChart && result && analysisChartType && (
        <div className="px-3 pb-2">
          <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-2">
            <ResultChart result={result} defaultChartType={analysisChartType} chartHint={chartHint} />
          </div>
        </div>
      )}

      {/* Next Queries */}
      {report.nextQueries && report.nextQueries.length > 0 && onQueryClick && (
        <div className="border-t border-gray-100 px-3 py-2">
          <div className="flex items-start gap-2 text-xs">
            <Lightbulb className="w-3.5 h-3.5 text-amber-500 mt-0.5 flex-shrink-0" />
            <div className="flex flex-wrap gap-1.5">
              {report.nextQueries.map((q, i) => (
                <button
                  key={i}
                  onClick={() => onQueryClick(q)}
                  className="inline-block px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-[11px] hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 transition-colors cursor-pointer"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
})
