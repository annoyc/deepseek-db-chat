import { useState, useMemo, useCallback } from 'react'
import { ArrowUpDown, ArrowUp, ArrowDown, Download, Copy, Check } from 'lucide-react'
import type { SqlResultInfo } from '@/lib/types'
import { ResultChart } from './ResultChart'
import { MetricCards, isKpiResult } from './MetricCards'
import { DataSummary } from './DataSummary'
import { cn } from '@/lib/utils'

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

function toMarkdownTable(columns: string[], rows: Record<string, unknown>[]): string {
  const header = `| ${columns.join(' | ')} |`
  const separator = `| ${columns.map(() => '---').join(' | ')} |`
  const body = rows
    .map((r) => `| ${columns.map((c) => String(r[c] ?? '')).join(' | ')} |`)
    .join('\n')
  return [header, separator, body].join('\n')
}

export function ResultTable({ result }: ResultTableProps) {
  const isKpi = isKpiResult(result)
  const [viewMode, setViewMode] = useState<ViewMode>(isKpi ? 'summary' : 'table')
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>(null)
  const [copied, setCopied] = useState(false)
  const { columns, rows, rowCount } = result

  const sortedRows = useMemo(() => {
    const slice = rows.slice(0, 100)
    if (!sortCol || !sortDir) return slice
    return [...slice].sort((a, b) => {
      const va = a[sortCol]
      const vb = b[sortCol]
      if (va === null || va === undefined) return 1
      if (vb === null || vb === undefined) return -1
      const na = Number(va)
      const nb = Number(vb)
      if (!isNaN(na) && !isNaN(nb)) {
        return sortDir === 'asc' ? na - nb : nb - na
      }
      const sa = String(va)
      const sb = String(vb)
      return sortDir === 'asc' ? sa.localeCompare(sb) : sb.localeCompare(sa)
    })
  }, [rows, sortCol, sortDir])

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
          const n = Number(val)
          if (!isNaN(n) && isFinite(n)) {
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
    const md = toMarkdownTable(columns, rows.slice(0, 100))
    await navigator.clipboard.writeText(md)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [columns, rows])

  const SortIcon = ({ col }: { col: string }) => {
    if (sortCol !== col || !sortDir) return <ArrowUpDown className="w-3 h-3 text-gray-300" />
    if (sortDir === 'asc') return <ArrowUp className="w-3 h-3 text-primary" />
    return <ArrowDown className="w-3 h-3 text-primary" />
  }

  return (
    <div>
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">{rowCount} 行结果</span>
          {rows.length > 0 && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => exportCSV(columns, rows, `query-${Date.now()}.csv`)}
                className="p-1 rounded hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600"
                title="导出 CSV"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleCopy}
                className="p-1 rounded hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600"
                title="复制表格"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          )}
        </div>
        <div className="flex items-center rounded-md overflow-hidden border border-gray-200">
          {(['table', 'chart', 'summary'] as const).map((mode, i) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={cn(
                'px-2.5 py-1 text-xs font-medium transition-colors',
                i > 0 && 'border-l border-gray-200',
                viewMode === mode
                  ? 'bg-gray-800 text-white'
                  : 'bg-white text-gray-500 hover:bg-gray-50'
              )}
            >
              {{ table: '表格', chart: '图表', summary: '摘要' }[mode]}
            </button>
          ))}
        </div>
      </div>

      {viewMode === 'table' ? (
        columns.length > 0 && rows.length > 0 ? (
          <div className="overflow-x-auto max-h-80 px-3 py-2">
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0">
                <tr>
                  {columns.map((col) => (
                    <th
                      key={col}
                      onClick={() => handleSort(col)}
                      className="px-3 py-2 text-left font-semibold text-gray-700 border-b-2 border-gray-200 bg-gray-50/80 whitespace-nowrap cursor-pointer select-none hover:bg-gray-100/80 transition-colors"
                    >
                      <div className="flex items-center gap-1">
                        {col}
                        <SortIcon col={col} />
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row, idx) => (
                  <tr key={idx} className={cn('hover:bg-gray-50/50 transition-colors', idx % 2 === 1 && 'bg-gray-50/30')}>
                    {columns.map((col) => (
                      <td
                        key={col}
                        className="px-3 py-1.5 border-b border-gray-100 text-gray-600 whitespace-nowrap max-w-52 truncate"
                      >
                        {formatCell(row[col])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {columnStats && (
                <tfoot>
                  <tr className="bg-gray-50/60 border-t-2 border-gray-200">
                    {columns.map((col) => {
                      const s = columnStats[col]
                      if (!s) return <td key={col} className="px-3 py-1.5 text-gray-400 text-xs" />
                      if (s.count >= rows.length * 0.5) {
                        const avg = s.sum / s.count
                        return (
                          <td key={col} className="px-3 py-1.5 text-xs text-gray-500 whitespace-nowrap">
                            <span className="font-medium">Σ</span> {formatNumber(s.sum)}
                            <span className="mx-1 text-gray-300">·</span>
                            <span className="font-medium">μ</span> {formatNumber(avg)}
                          </td>
                        )
                      }
                      return (
                        <td key={col} className="px-3 py-1.5 text-xs text-gray-400 whitespace-nowrap">
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
          <div className="px-3 py-5 text-center text-xs text-gray-400">
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
        <div className="px-3 py-2 text-center text-xs text-gray-400 border-t border-gray-100">
          显示前 100 行（共 {rowCount} 行）
        </div>
      )}
    </div>
  )
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
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
  if (Number.isInteger(n)) return n.toLocaleString('zh-CN')
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}
