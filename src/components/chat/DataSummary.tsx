import { useMemo } from 'react'
import type { SqlResultInfo } from '@/lib/types'
import { formatResultStatistic, toResultNumber } from '@/lib/result-data'

interface DataSummaryProps {
  result: SqlResultInfo
}

interface ColumnSummary {
  col: string
  isNumeric: boolean
  count: number
  nullCount: number
  distinctCount: number
  min?: number
  max?: number
  sum?: number
  avg?: number
  topValues?: { value: string; count: number }[]
}

function formatNum(n: number): string {
  return formatResultStatistic(n)
}

export function DataSummary({ result }: DataSummaryProps) {
  const { columns, rows } = result

  const summaries = useMemo(() => {
    return columns.map((col): ColumnSummary => {
      let numericCount = 0
      let nullCount = 0
      let sum = 0
      let min = Infinity
      let max = -Infinity
      const valueCounts = new Map<string, number>()

      for (const row of rows) {
        const val = row[col]
        if (val === null || val === undefined) {
          nullCount++
          continue
        }
        const str = String(val)
        valueCounts.set(str, (valueCounts.get(str) ?? 0) + 1)

        const n = toResultNumber(val)
        if (n !== null) {
          numericCount++
          sum += n
          min = Math.min(min, n)
          max = Math.max(max, n)
        }
      }

      const isNumeric = numericCount > rows.length * 0.5

      const topValues = [...valueCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([value, count]) => ({ value, count }))

      return {
        col,
        isNumeric,
        count: rows.length - nullCount,
        nullCount,
        distinctCount: valueCounts.size,
        ...(isNumeric && {
          min: min === Infinity ? undefined : min,
          max: max === -Infinity ? undefined : max,
          sum,
          avg: numericCount > 0 ? sum / numericCount : undefined,
        }),
        topValues: isNumeric ? undefined : topValues,
      }
    })
  }, [columns, rows])

  if (rows.length === 0) {
    return (
      <div className="text-center text-xs text-ink-faint py-4">无数据</div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="text-xs text-ink-muted px-1">
        基于已返回的 <span className="font-semibold text-ink-secondary">{rows.length}</span> 行 ×{' '}
        <span className="font-semibold text-ink-secondary">{columns.length}</span> 列
      </div>

      <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
        {summaries.map((s) => (
          <div
            key={s.col}
            className="border border-line rounded-lg px-3 py-2.5 bg-surface"
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold text-ink truncate">{s.col}</span>
              <span className="text-[11px] text-ink-faint flex-shrink-0 ml-2">
                {s.isNumeric ? '数值' : '文本'}
                {s.nullCount > 0 && ` · ${s.nullCount} 空`}
              </span>
            </div>

            {s.isNumeric ? (
              <div className="grid grid-cols-4 gap-1 text-xs">
                <div>
                  <div className="text-ink-faint">最小</div>
                  <div className="font-medium text-ink-secondary">{s.min !== undefined ? formatNum(s.min) : '-'}</div>
                </div>
                <div>
                  <div className="text-ink-faint">最大</div>
                  <div className="font-medium text-ink-secondary">{s.max !== undefined ? formatNum(s.max) : '-'}</div>
                </div>
                <div>
                  <div className="text-ink-faint">平均</div>
                  <div className="font-medium text-ink-secondary">{s.avg !== undefined ? formatNum(s.avg) : '-'}</div>
                </div>
                <div>
                  <div className="text-ink-faint">总和</div>
                  <div className="font-medium text-ink-secondary">{s.sum !== undefined ? formatNum(s.sum) : '-'}</div>
                </div>
              </div>
            ) : (
              <div className="text-xs">
                <div className="text-ink-faint mb-0.5">{s.distinctCount} 种不同值</div>
                {s.topValues && s.topValues.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {s.topValues.map((tv) => (
                      <span
                        key={tv.value}
                        className="inline-flex items-center px-1.5 py-0.5 rounded bg-surface-muted text-ink-secondary text-[11px]"
                      >
                        {tv.value.length > 20 ? tv.value.slice(0, 20) + '…' : tv.value}
                        <span className="ml-1 text-ink-faint">{tv.count}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
