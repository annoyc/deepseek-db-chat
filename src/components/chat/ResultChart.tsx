import { useMemo, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, Legend, AreaChart, Area,
} from 'recharts'
import { BarChart3, LineChart as LineChartIcon, PieChart as PieChartIcon, AreaChart as AreaChartIcon } from 'lucide-react'
import type { SqlResultInfo } from '@/lib/types'
import { cn } from '@/lib/utils'

interface ResultChartProps {
  result: SqlResultInfo
}

type ChartType = 'bar' | 'line' | 'pie' | 'area'

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#ec4899']

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}|T\d{2}:\d{2}|^\d{4}\/\d{2}/
const CATEGORICAL_COL_PATTERN = /^(id|code|type|status|category|flag|level|rank|no|seq|sort|index|月份|类型|状态|编码|编号|序号|分类|等级|标记|排序)$/i
const CATEGORICAL_COL_SUFFIX = /(id|code|type|_no|_seq|_flag|_status|_level|_rank|_sort|_category)$/i

function isDateValue(val: unknown): boolean {
  if (val === null || val === undefined) return false
  const str = String(val)
  return DATE_PATTERN.test(str)
}

function isStrictlyNumeric(val: unknown): boolean {
  if (val === null || val === undefined) return false
  if (typeof val === 'number') return true
  const str = String(val).trim()
  if (str === '') return false
  if (isDateValue(val)) return false
  const num = Number(str)
  return !isNaN(num) && isFinite(num)
}

function isCategoricalColumn(col: string, rows: Record<string, unknown>[]): boolean {
  if (CATEGORICAL_COL_PATTERN.test(col) || CATEGORICAL_COL_SUFFIX.test(col)) return true

  const vals: number[] = []
  const distinct = new Set<number>()
  for (const row of rows) {
    const v = row[col]
    if (v === null || v === undefined) continue
    const n = Number(v)
    if (isNaN(n) || !isFinite(n)) continue
    vals.push(n)
    distinct.add(n)
  }
  if (vals.length === 0) return false

  const allIntegers = vals.every((n) => Number.isInteger(n))
  if (!allIntegers) return false

  // Few distinct small integers relative to row count → likely categorical
  if (distinct.size <= 10 && distinct.size < rows.length * 0.15) return true
  // Very small range of values (e.g. 0-12) → likely enum/month/type
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  if (max - min <= 12 && distinct.size <= 13) return true

  return false
}

function recommendChartType(dataLen: number, valueColCount: number, hasDate: boolean): ChartType {
  if (dataLen <= 6 && valueColCount === 1) return 'pie'
  if (hasDate || dataLen > 10) return 'line'
  return 'bar'
}

function generateTitle(labelCol: string, valueCols: string[]): string {
  const valPart = valueCols.length <= 2
    ? valueCols.join(' / ')
    : `${valueCols[0]} 等 ${valueCols.length} 项指标`
  return `${valPart}（按 ${labelCol}）`
}

const CHART_TYPE_OPTIONS: { type: ChartType; icon: typeof BarChart3; label: string }[] = [
  { type: 'bar', icon: BarChart3, label: '柱状图' },
  { type: 'line', icon: LineChartIcon, label: '折线图' },
  { type: 'area', icon: AreaChartIcon, label: '面积图' },
  { type: 'pie', icon: PieChartIcon, label: '饼图' },
]

export function ResultChart({ result }: ResultChartProps) {
  const { columns, rows } = result

  const chartData = useMemo(() => {
    if (rows.length === 0 || columns.length < 2) return null

    const colAnalysis = columns.map((col) => {
      let numericCount = 0
      let dateCount = 0
      for (const row of rows) {
        const val = row[col]
        if (isDateValue(val)) dateCount++
        else if (isStrictlyNumeric(val)) numericCount++
      }
      const isNumeric = numericCount > rows.length * 0.5
      const categorical = isNumeric && isCategoricalColumn(col, rows)
      return {
        col,
        isNumeric: isNumeric && !categorical,
        isCategorical: categorical,
        isDate: dateCount > rows.length * 0.3,
      }
    })

    const valueCols = colAnalysis
      .filter((c) => c.isNumeric && !c.isDate && !c.isCategorical)
      .map((c) => c.col)

    if (valueCols.length === 0) return null

    // Pick the best label column: prefer high-cardinality non-numeric columns
    const labelCandidates = colAnalysis.filter((c) => !c.isNumeric || c.isDate || c.isCategorical)
    let labelCol: string
    if (labelCandidates.length > 0) {
      // Score by distinct value count (higher = better label)
      const scored = labelCandidates.map((c) => {
        const distinct = new Set(rows.map((r) => String(r[c.col] ?? '')))
        return { col: c.col, isDate: c.isDate, distinctRatio: distinct.size / rows.length }
      })
      // Prefer non-date with high cardinality, then date
      scored.sort((a, b) => {
        if (a.isDate !== b.isDate) return a.isDate ? 1 : -1
        return b.distinctRatio - a.distinctRatio
      })
      labelCol = scored[0].col
    } else {
      labelCol = columns[0]
    }

    const hasDate = colAnalysis.some((c) => c.isDate && c.col === labelCol)

    const data = rows.slice(0, 30).map((row) => {
      let name = String(row[labelCol] ?? '')
      if (isDateValue(row[labelCol])) {
        const d = new Date(String(row[labelCol]))
        if (!isNaN(d.getTime())) {
          name = `${d.getMonth() + 1}/${d.getDate()}`
        }
      }
      const entry: Record<string, unknown> = { name }
      for (const col of valueCols) {
        entry[col] = Number(row[col]) || 0
      }
      return entry
    })

    const recommended = recommendChartType(data.length, valueCols.length, hasDate)
    const title = generateTitle(labelCol, valueCols)

    return { data, labelCol, valueCols, recommended, title }
  }, [columns, rows])

  const [chartType, setChartType] = useState<ChartType | null>(null)

  if (!chartData) {
    return (
      <div className="flex items-center justify-center h-60 text-sm text-gray-400">
        数据不适合图表展示
      </div>
    )
  }

  const { data, valueCols, recommended, title } = chartData
  const activeType = chartType ?? recommended
  const pieDisabled = valueCols.length > 1 || data.length > 10

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-500 truncate">{title}</span>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {CHART_TYPE_OPTIONS.map(({ type, icon: Icon, label }) => {
            const disabled = type === 'pie' && pieDisabled
            return (
              <button
                key={type}
                onClick={() => !disabled && setChartType(type)}
                disabled={disabled}
                title={label}
                className={cn(
                  'p-1.5 rounded transition-colors',
                  activeType === type
                    ? 'bg-gray-800 text-white'
                    : disabled
                      ? 'text-gray-300 cursor-not-allowed'
                      : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'
                )}
              >
                <Icon className="w-3.5 h-3.5" />
              </button>
            )
          })}
        </div>
      </div>

      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%" minWidth={100} minHeight={100}>
          {activeType === 'pie' ? (
            <PieChart>
              <Pie
                data={data}
                dataKey={valueCols[0]}
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={80}
                label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                labelLine={true}
              >
                {data.map((_, index) => (
                  <Cell key={index} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          ) : activeType === 'line' ? (
            <LineChart data={data} margin={{ top: 10, right: 30, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              {valueCols.map((col, idx) => (
                <Line key={col} type="monotone" dataKey={col} stroke={COLORS[idx % COLORS.length]} strokeWidth={2} dot={{ r: 3 }} />
              ))}
            </LineChart>
          ) : activeType === 'area' ? (
            <AreaChart data={data} margin={{ top: 10, right: 30, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              {valueCols.map((col, idx) => (
                <Area
                  key={col}
                  type="monotone"
                  dataKey={col}
                  stroke={COLORS[idx % COLORS.length]}
                  fill={COLORS[idx % COLORS.length]}
                  fillOpacity={0.15}
                  strokeWidth={2}
                />
              ))}
            </AreaChart>
          ) : (
            <BarChart data={data} margin={{ top: 10, right: 30, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              {valueCols.map((col, idx) => (
                <Bar key={col} dataKey={col} fill={COLORS[idx % COLORS.length]} radius={[4, 4, 0, 0]} />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  )
}
