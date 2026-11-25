import { useState, useMemo, useCallback } from 'react'
import { ArrowUpDown, ArrowUp, ArrowDown, Download, Copy, Check } from 'lucide-react'
import type { SqlResultInfo } from '@/lib/types'
import { ResultChart } from './ResultChart'
import { MetricCards, isKpiResult } from './MetricCards'
import { DataSummary } from './DataSummary'
import { cn } from '@/lib/utils'
import { formatResultCellNumber, formatResultStatistic, getResultPage, isNumericResultColumn, resultRowsToMarkdown, sortResultRows, toResultNumber } from '@/lib/result-data'
import { InfoHint } from '@/components/ui/info-hint'

interface ResultTableProps {
  result: SqlResultInfo
}

type ViewMode = 'table' | 'chart' | 'summary'
type SortDir = 'asc' | 'desc' | null

function exportCSV(columns: string[], rows: Record<string, unknown>[], filename = 'export.csv') {
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v)
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s
  }
  const csv = [
    columns.map(escape).join(','),
    ...rows.map((r) => columns.map((c) => escape(r[c])).join(',')),
  ].join('\n')

  const bom = '\uFEFF'
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function ResultTable({ result }: ResultTableProps) {
  const isKpi = isKpiResult(result)
  const [viewMode, setViewMode] = useState<ViewMode>(isKpi ? 'summary' : 'table')
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>(null)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState('')
  const [page, setPage] = useState(0)
  const { columns, rows, rowCount } = result

  const sortedRows = useMemo(() => sortResultRows(rows, sortCol, sortDir), [rows, sortCol, sortDir])
  const currentPage = getResultPage(sortedRows, page)
  const numericColumns = useMemo(() => new Set(columns.filter((col) => isNumericResultColumn(rows, col))), [columns, rows])

  const columnStats = useMemo(() => {
    if (rows.length < 2) return null
    const stats: Record<string, { sum: number; count: number; min: number; max: number; distinct: Set<string> }> = {}
    for (const col of columns) {
      stats[col] = { sum: 0, count: 0, min: Infinity, max: -Infinity, distinct: new Set() }
    }
    for (const row of rows) {
      for (const col of columns) {
        const val = row[col]
        if (val !== null && val !== undefined) {
          stats[col].distinct.add(String(val))
          const n = toResultNumber(val)
          if (n !== null) {
            stats[col].sum += n
            stats[col].count++
            stats[col].min = Math.min(stats[col].min, n)
            stats[col].max = Math.max(stats[col].max, n)
          }
        }
      }
    }
    return stats
  }, [columns, rows])

  const handleSort = useCallback((col: string) => {
    setPage(0)
    if (sortCol !== col) {
      setSortCol(col)
      setSortDir('asc')
    } else if (sortDir === 'asc') {
      setSortDir('desc')
    } else {
      setSortCol(null)
      setSortDir(null)
    }
  }, [sortCol, sortDir])

  const handleCopy = useCallback(async () => {
    setCopyError('')
    try {
      await navigator.clipboard.writeText(resultRowsToMarkdown(columns, sortedRows))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopyError('复制失败，请允许剪贴板访问或导出 CSV。')
    }
  }, [columns, sortedRows])

  const SortIcon = ({ col }: { col: string }) => {
    if (sortCol !== col || !sortDir) return <ArrowUpDown className="w-3 h-3 text-ink-faint" />
    if (sortDir === 'asc') return <ArrowUp className="w-3 h-3 text-primary" />
    return <ArrowDown className="w-3 h-3 text-primary" />
  }

  return (
    <div>
      <div className="flex items-center justify-between px-3 py-2 border-b border-line-subtle">
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-faint">{rows.length > 0 ? `已返回 ${rows.length} 行` : `${rowCount} 行结果`}</span>
          {rows.length > 0 && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => exportCSV(columns, sortedRows, `query-${Date.now()}.csv`)}
                className="p-1 rounded hover:bg-surface-hover transition-colors text-ink-faint hover:text-ink-secondary"
                title={`导出全部已返回的 ${rows.length} 行 CSV（当前排序）`}
                aria-label={`导出全部已返回的 ${rows.length} 行 CSV`}
              >
                <Download className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleCopy}
                className="p-1 rounded hover:bg-surface-hover transition-colors text-ink-faint hover:text-ink-secondary"
                title={`复制全部已返回的 ${rows.length} 行（当前排序）`}
                aria-label={`复制全部已返回的 ${rows.length} 行`}
              >
                {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
              <InfoHint label="统计、复制与导出的范围">
                统计、复制和导出覆盖全部已返回的 {rows.length} 行，而不只是当前页；复制与导出保留当前排序。数值列按千分位显示，复制和导出的仍是原始值。
              </InfoHint>
            </div>
          )}
        </div>
        <div className="flex items-center rounded-md overflow-hidden border border-line">
          {(['table', 'chart', 'summary'] as const).map((mode, i) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={cn(
                'px-2.5 py-1 text-xs font-medium transition-colors',
                i > 0 && 'border-l border-line',
                viewMode === mode
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-surface text-ink-muted hover:bg-surface-hover',
              )}
            >
              {{ table: '表格', chart: '图表', summary: '摘要' }[mode]}
            </button>
          ))}
        </div>
      </div>

      {result.truncated && (
        <p className="border-b border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/45 dark:text-amber-300">
          结果已达到 {result.maxRows ?? rows.length} 行上限，可能还有更多数据。图表、统计、复制和导出仅覆盖已返回的行，请缩小查询范围或使用汇总查询。
        </p>
      )}
      {copyError && <p role="alert" className="px-3 pt-2 text-xs text-red-600 dark:text-red-400">{copyError}</p>}

      {viewMode === 'table' ? (
        columns.length > 0 && rows.length > 0 ? (
          <div className="subtle-scrollbar max-h-80 overflow-auto px-3 pb-2">
            <table className="w-full text-xs border-separate border-spacing-0">
              <thead className="sticky top-0 z-10">
                <tr>
                  {columns.map((col) => (
                    <th
                      key={col}
                      onClick={() => handleSort(col)}
                      aria-sort={sortCol === col && sortDir ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                      className="px-3 py-2 text-left font-semibold text-ink-secondary border-b-2 border-line bg-surface-muted whitespace-nowrap cursor-pointer select-none hover:bg-surface-hover transition-colors"
                    >
                      <div className={cn('flex items-center gap-1', numericColumns.has(col) && 'justify-end')}>
                        {col}
                        <SortIcon col={col} />
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {currentPage.rows.map((row, idx) => (
                  <tr key={idx} className={cn('hover:bg-surface-hover/60 transition-colors', idx % 2 === 1 && 'bg-surface-muted/40')}>
                    {columns.map((col) => {
                      const text = formatCell(row[col], col)
                      return (
                        <td
                          key={col}
                          title={text.length > 24 ? text : undefined}
                          className={cn(
                            'px-3 py-1.5 border-b border-line-subtle whitespace-nowrap max-w-52 truncate',
                            row[col] === null || row[col] === undefined ? 'text-ink-faint' : 'text-ink-secondary',
                            numericColumns.has(col) && 'text-right tabular-nums',
                          )}
                        >
                          {text}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
              {columnStats && (
                <tfoot>
                  <tr className="bg-surface-muted/70 border-t-2 border-line">
                    {columns.map((col) => {
                      const s = columnStats[col]
                      if (!s) return <td key={col} className="px-3 py-1.5 text-ink-faint text-xs" />
                      if (s.count >= rows.length * 0.5) {
                        const avg = s.sum / s.count
                        return (
                          <td key={col} className={cn('px-3 py-1.5 text-xs text-ink-muted whitespace-nowrap tabular-nums', numericColumns.has(col) && 'text-right')}>
                            <span className="font-medium">Σ</span> {formatNumber(s.sum)}
                            <span className="mx-1 text-ink-faint">·</span>
                            <span className="font-medium">μ</span> {formatNumber(avg)}
                          </td>
                        )
                      }
                      return (
                        <td key={col} className="px-3 py-1.5 text-xs text-ink-faint whitespace-nowrap">
                          {s.distinct.size} 种值
                        </td>
                      )
                    })}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        ) : (
          <div className="px-3 py-5 text-center text-xs text-ink-faint">
            {rowCount === 0 ? '查询成功，无返回数据' : '执行成功'}
          </div>
        )
      ) : viewMode === 'chart' ? (
        <div className="p-3">
          <ResultChart result={result} />
        </div>
      ) : (
        <div className="p-3">
          {isKpi ? (
            <MetricCards result={result} />
          ) : (
            <DataSummary result={result} />
          )}
        </div>
      )}

      {viewMode === 'table' && rows.length > 100 && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-ink-muted border-t border-line-subtle">
          <span>第 {currentPage.start + 1}–{currentPage.end} 行 / 已返回 {rows.length} 行</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(currentPage.page - 1)} disabled={currentPage.page === 0} className="rounded px-2 py-1 hover:bg-surface-hover disabled:opacity-40">上一页</button>
            <span>{currentPage.page + 1}/{currentPage.pageCount}</span>
            <button onClick={() => setPage(currentPage.page + 1)} disabled={currentPage.page + 1 === currentPage.pageCount} className="rounded px-2 py-1 hover:bg-surface-hover disabled:opacity-40">下一页</button>
          </div>
        </div>
      )}
    </div>
  )
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/

function formatCell(value: unknown, column: string): string {
  if (value === null || value === undefined) return 'NULL'
  const numeric = formatResultCellNumber(value, column)
  if (numeric !== null) return numeric
  if (typeof value === 'object') {
    if (value instanceof Date) return formatDate(value)
    return JSON.stringify(value)
  }
  const str = String(value)
  if (ISO_DATE_RE.test(str) || DATE_ONLY_RE.test(str)) {
    const d = new Date(str)
    if (!isNaN(d.getTime())) return formatDate(d)
  }
  return str
}

function formatDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const h = d.getHours()
  const min = d.getMinutes()
  const s = d.getSeconds()
  if (h === 0 && min === 0 && s === 0) return `${y}-${m}-${day}`
  return `${y}-${m}-${day} ${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

function formatNumber(n: number): string {
  return formatResultStatistic(n)
}
