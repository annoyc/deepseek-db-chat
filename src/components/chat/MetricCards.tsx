import type { SqlResultInfo } from '@/lib/types'

interface MetricCardsProps {
  result: SqlResultInfo
}

const MONEY_PATTERN = /price|amount|cost|fee|total|revenue|salary|pay|income|profit|金额|价格|费用|收入|利润|薪资/i
const COUNT_PATTERN = /count|num|quantity|total|sum|数量|总数|总计|合计/i
const PERCENT_PATTERN = /rate|ratio|percent|占比|比例|比率/i

function detectFormat(colName: string, value: number): string {
  if (PERCENT_PATTERN.test(colName)) {
    if (value >= 0 && value <= 1) return `${(value * 100).toFixed(1)}%`
    return `${value.toFixed(1)}%`
  }
  if (MONEY_PATTERN.test(colName)) {
    return `¥ ${value.toLocaleString('zh-CN', { minimumFractionDigits: value % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`
  }
  if (Number.isInteger(value) || COUNT_PATTERN.test(colName)) {
    return Math.round(value).toLocaleString('zh-CN')
  }
  return value.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

function formatLabel(colName: string): string {
  return colName
    .replace(/_/g, ' ')
    .replace(/\b(count|sum|avg|max|min)\b/gi, (m) => m.toUpperCase())
    .trim()
}

export function isKpiResult(result: SqlResultInfo): boolean {
  if (result.rowCount !== 1 || result.columns.length === 0 || result.columns.length > 6) return false
  const row = result.rows[0]
  return result.columns.every((col) => {
    const val = row[col]
    if (val === null || val === undefined) return false
    const n = Number(val)
    return !isNaN(n) && isFinite(n)
  })
}

export function MetricCards({ result }: MetricCardsProps) {
  const row = result.rows[0]
  const cols = result.columns

  return (
    <div className={`grid gap-3 ${cols.length <= 2 ? 'grid-cols-2' : cols.length <= 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2 sm:grid-cols-3'}`}>
      {cols.map((col) => {
        const value = Number(row[col])
        return (
          <div
            key={col}
            className="bg-gradient-to-br from-gray-50 to-white border border-gray-200 rounded-xl px-4 py-3 flex flex-col gap-1"
          >
            <span className="text-xs text-gray-500 font-medium truncate">
              {formatLabel(col)}
            </span>
            <span className="text-xl font-bold text-gray-900 tracking-tight">
              {detectFormat(col, value)}
            </span>
          </div>
        )
      })}
    </div>
  )
}
