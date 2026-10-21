import type { SqlResultInfo } from '@/lib/types'
import { formatResultMetricValue, toResultNumber } from '@/lib/result-data'

interface MetricCardsProps {
  result: SqlResultInfo
}

export function isKpiResult(result: SqlResultInfo): boolean {
  if (result.rows.length !== 1 || result.columns.length === 0 || result.columns.length > 6) return false
  const row = result.rows[0]
  return result.columns.every((col) => toResultNumber(row[col]) !== null)
}

export function MetricCards({ result }: MetricCardsProps) {
  const row = result.rows[0]
  const cols = result.columns
  if (!row) return null

  return (
    <div className={`grid gap-3 ${cols.length <= 2 ? 'grid-cols-2' : cols.length <= 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2 sm:grid-cols-3'}`}>
      {cols.map((col) => {
        return (
          <div
            key={col}
            className="bg-gradient-to-br from-gray-50 to-white border border-gray-200 rounded-xl px-4 py-3 flex flex-col gap-1"
          >
            <span className="text-xs text-gray-500 font-medium truncate" title={col}>
              {col}
            </span>
            <span className="text-xl font-bold text-gray-900 tracking-tight">
              {formatResultMetricValue(row[col])}
            </span>
          </div>
        )
      })}
    </div>
  )
}
