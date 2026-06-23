import { useMemo, useState, useCallback } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, Legend, AreaChart, Area,
} from 'recharts'
import { BarChart3, LineChart as LineChartIcon, PieChart as PieChartIcon, AreaChart as AreaChartIcon } from 'lucide-react'
import type { SqlResultInfo } from '@/lib/types'
import { cn } from '@/lib/utils'

export type ChartType = 'bar' | 'line' | 'pie' | 'area'

export interface ChartHint {
  xAxis?: string
  yAxis?: string
  labelCol?: string
  valueCols?: string[]
}

interface ResultChartProps {
  result: SqlResultInfo
  defaultChartType?: ChartType
  chartHint?: ChartHint
}

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#ec4899']

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}|T\d{2}:\d{2}|^\d{4}\/\d{2}/
const CATEGORICAL_COL_PATTERN = /^(id|code|type|status|category|flag|level|rank|no|seq|sort|index|月份|类型|状态|编码|编号|序号|分类|等级|标记|排序)$/i
const CATEGORICAL_COL_SUFFIX = /(id|code|type|_no|_seq|_flag|_status|_level|_rank|_sort|_category)$/i
const METRIC_COL_KEYWORDS = /(次数|人数|数量|金额|收入|成本|价格|销量|总数|合计|均值|占比|比率|访客|客户数|用户数|笔数|件数|单数|个数|条数|百分比|增长|转化|留存|访问量|浏览量|点击量|曝光量|count|sum|avg|total|amount|num|quantity|rate|revenue|cost|price|sales|visits|views|clicks)/i

const LABEL_COL_STRONG = /(名称|name|title|日期|date|month|年份|年|月|周|quarter|地区|城市|省份|省|部门|渠道|产品|类别|分类|页面|路径|path|page|url|event|事件|场景|来源|source|channel|brand|品牌|区域|region|country|国家|时间|time|period|阶段|版本|version)/i
const LABEL_COL_WEAK = /(描述|desc|备注|remark|标签|tag|label|group|组|维度|dimension)/i
const LABEL_COL_NEGATIVE = /(^id$|_id$|code|编码|编号|hash|token|key|uuid|序号|secret|password|sign)/i
const LONG_NUMERIC_PATTERN = /^\d{9,}$/
const ID_CODE_COL_PATTERN = /(^id$|_id$|编码|编号|code$|_code|号码|uuid|hash|token|key$|_key)/i

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

function isCategoricalColumn(col: string, rows: Record<string, unknown>[], hintValueCols?: Set<string>): boolean {
  if (hintValueCols?.has(col)) return false
  if (METRIC_COL_KEYWORDS.test(col)) return false
  if (CATEGORICAL_COL_PATTERN.test(col) || CATEGORICAL_COL_SUFFIX.test(col)) return true
  if (ID_CODE_COL_PATTERN.test(col)) return true

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

  if (distinct.size <= 3 && rows.length >= 20 && distinct.size < rows.length * 0.05) return true

  return false
}

interface LabelScore {
  col: string
  score: number
  isDate: boolean
  distinctRatio: number
}

function scoreLabelColumn(
  col: string,
  colIndex: number,
  rows: Record<string, unknown>[],
  isDate: boolean,
): LabelScore {
  let score = 0

  // 1. Column name semantics (0-30)
  if (LABEL_COL_STRONG.test(col)) score += 30
  else if (LABEL_COL_WEAK.test(col)) score += 15
  if (LABEL_COL_NEGATIVE.test(col)) score -= 20

  // 2. Value readability (0-25, with possible penalties)
  const values = rows.map((r) => String(r[col] ?? ''))
  const nonEmpty = values.filter((v) => v !== '' && v !== 'null' && v !== 'undefined')
  if (nonEmpty.length > 0) {
    const avgLen = nonEmpty.reduce((s, v) => s + v.length, 0) / nonEmpty.length
    if (avgLen <= 10) score += 25
    else if (avgLen <= 20) score += 15
    else if (avgLen <= 40) score += 5

    const allLongNumeric = nonEmpty.every((v) => LONG_NUMERIC_PATTERN.test(v))
    if (allLongNumeric) score -= 15

    const allSingleDigit = nonEmpty.every((v) => /^-?\d$/.test(v))
    if (allSingleDigit) score -= 20
  }

  // 3. Cardinality fitness (0-20)
  const distinct = new Set(values)
  const distinctRatio = rows.length > 0 ? distinct.size / rows.length : 0
  if (distinct.size <= 2) score -= 5
  else if (distinctRatio < 0.1) score += 5
  else if (distinctRatio < 0.3) score += 15
  else score += 20

  // 4. Date bonus (0-15)
  if (isDate) score += 15

  // 5. Column position (0-10)
  if (colIndex === 0) score += 10
  else if (colIndex === 1) score += 5

  return { col, score, isDate, distinctRatio }
}

function recommendChartType(
  dataLen: number,
  valueColCount: number,
  hasDate: boolean,
  labelDistinctRatio?: number,
): ChartType {
  if (dataLen <= 6 && valueColCount === 1 && (labelDistinctRatio ?? 1) >= 0.8) return 'pie'
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

export interface ChartAnalysis {
  data: Record<string, unknown>[]
  labelCol: string
  valueCols: string[]
  recommended: ChartType
  title: string
}

export function analyzeChartData(
  columns: string[],
  rows: Record<string, unknown>[],
  chartHint?: ChartHint,
): ChartAnalysis | null {
  if (rows.length === 0 || columns.length < 2) return null

  // Fast path: AI already classified columns
  if (chartHint?.labelCol && chartHint?.valueCols && chartHint.valueCols.length > 0) {
    const aiLabel = columns.includes(chartHint.labelCol) ? chartHint.labelCol : null
    const aiValues = chartHint.valueCols.filter((c) => columns.includes(c))
    if (aiLabel && aiValues.length > 0) {
      const hasDate = rows.some((r) => isDateValue(r[aiLabel]))
      const data = rows.slice(0, 30).map((row) => {
        let name = String(row[aiLabel] ?? '')
        if (isDateValue(row[aiLabel])) {
          const d = new Date(String(row[aiLabel]))
          if (!isNaN(d.getTime())) name = `${d.getMonth() + 1}/${d.getDate()}`
        }
        if (name.length > 20) name = name.slice(0, 18) + '…'
        const entry: Record<string, unknown> = { name }
        for (const col of aiValues) entry[col] = Number(row[col]) || 0
        return entry
      })
      const distinct = new Set(data.map((d) => d.name as string))
      const distinctRatio = data.length > 0 ? distinct.size / data.length : 0
      const recommended = recommendChartType(data.length, aiValues.length, hasDate, distinctRatio)
      return { data, labelCol: aiLabel, valueCols: aiValues, recommended, title: generateTitle(aiLabel, aiValues) }
    }
  }

  const hintValueCols = new Set<string>()
  if (chartHint?.yAxis) {
    for (const col of columns) {
      if (chartHint.yAxis.includes(col)) hintValueCols.add(col)
    }
  }

  const colAnalysis = columns.map((col) => {
    let numericCount = 0
    let dateCount = 0
    for (const row of rows) {
      const val = row[col]
      if (isDateValue(val)) dateCount++
      else if (isStrictlyNumeric(val)) numericCount++
    }
    const isNumeric = numericCount > rows.length * 0.5
    const categorical = isNumeric && isCategoricalColumn(col, rows, hintValueCols)
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

  const hintXAxis = chartHint?.xAxis
  const hintLabelCol = hintXAxis ? columns.find((c) => c === hintXAxis || c.includes(hintXAxis) || hintXAxis.includes(c)) : undefined

  const labelCandidates = colAnalysis.filter((c) => !c.isNumeric || c.isDate || c.isCategorical)
  const allScored = labelCandidates.map((c) =>
    scoreLabelColumn(c.col, columns.indexOf(c.col), rows, c.isDate),
  )
  allScored.sort((a, b) => b.score - a.score)

  let labelCol: string
  let bestScore: LabelScore | undefined

  if (hintLabelCol && !valueCols.includes(hintLabelCol)) {
    const ca = colAnalysis.find((c) => c.col === hintLabelCol)
    const hintScore = scoreLabelColumn(hintLabelCol, columns.indexOf(hintLabelCol), rows, ca?.isDate ?? false)
    const autoTop = allScored[0]
    if (hintScore.score >= 15 && (!autoTop || hintScore.score >= autoTop.score - 10)) {
      labelCol = hintLabelCol
      bestScore = hintScore
    } else if (autoTop && autoTop.score >= 15) {
      labelCol = autoTop.col
      bestScore = autoTop
    } else {
      labelCol = columns[0]
      bestScore = scoreLabelColumn(columns[0], 0, rows, colAnalysis[0]?.isDate ?? false)
    }
  } else if (allScored.length > 0 && allScored[0].score >= 15) {
    bestScore = allScored[0]
    labelCol = bestScore.col
  } else {
    labelCol = columns[0]
    bestScore = scoreLabelColumn(columns[0], 0, rows, colAnalysis[0]?.isDate ?? false)
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
    if (name.length > 20) name = name.slice(0, 18) + '…'
    const entry: Record<string, unknown> = { name }
    for (const col of valueCols) {
      entry[col] = Number(row[col]) || 0
    }
    return entry
  })

  const recommended = recommendChartType(data.length, valueCols.length, hasDate, bestScore?.distinctRatio)
  const title = generateTitle(labelCol, valueCols)

  return { data, labelCol, valueCols, recommended, title }
}

export function ResultChart({ result, defaultChartType, chartHint }: ResultChartProps) {
  const { columns, rows } = result

  const mergedHint = useMemo<ChartHint | undefined>(() => {
    const aiHint = result.chartColumnHint
    if (!aiHint && !chartHint) return undefined
    return {
      ...chartHint,
      labelCol: chartHint?.labelCol ?? aiHint?.labelCol,
      valueCols: chartHint?.valueCols ?? aiHint?.valueCols,
    }
  }, [result.chartColumnHint, chartHint])

  const chartData = useMemo(
    () => analyzeChartData(columns, rows, mergedHint),
    [columns, rows, mergedHint],
  )

  const [chartType, setChartType] = useState<ChartType | null>(null)
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set())

  const handleLegendClick = useCallback((dataKey: string) => {
    setHiddenSeries((prev) => {
      const next = new Set(prev)
      if (next.has(dataKey)) next.delete(dataKey)
      else next.add(dataKey)
      return next
    })
  }, [])

  if (!chartData) return null

  const { data, valueCols, recommended, title } = chartData
  const activeType = chartType ?? defaultChartType ?? recommended
  const pieDisabled = valueCols.length > 1 || data.length > 10

  const tooltipStyle = {
    contentStyle: { fontSize: 11, padding: '4px 8px', borderRadius: 6, border: '1px solid #e5e7eb' },
    labelStyle: { fontSize: 11, fontWeight: 600, marginBottom: 2 },
    itemStyle: { fontSize: 11, padding: 0 },
  }

  const legendProps = {
    wrapperStyle: { fontSize: 11, cursor: 'pointer' } as const,
    iconSize: 8,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onClick: (e: any) => { const key = String(e?.dataKey ?? ''); if (key) handleLegendClick(key) },
    formatter: (value: string) => (
      <span style={{ color: hiddenSeries.has(value) ? '#ccc' : '#666', fontSize: 11 }}>{value}</span>
    ),
  }

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
                label={({ name, percent, x, y, textAnchor }) => (
                  <text x={x} y={y} textAnchor={textAnchor} dominantBaseline="central" fontSize={10} fill="#666">
                    {String(name).length > 8 ? String(name).slice(0, 7) + '…' : name} {((percent ?? 0) * 100).toFixed(0)}%
                  </text>
                )}
                labelLine={true}
              >
                {data.map((_, index) => (
                  <Cell key={index} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip {...tooltipStyle} />
              <Legend {...legendProps} />
            </PieChart>
          ) : activeType === 'line' ? (
            <LineChart data={data} margin={{ top: 10, right: 30, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip {...tooltipStyle} />
              <Legend {...legendProps} />
              {valueCols.map((col, idx) => (
                <Line key={col} type="monotone" dataKey={col} stroke={COLORS[idx % COLORS.length]} strokeWidth={2} dot={{ r: 3 }} hide={hiddenSeries.has(col)} />
              ))}
            </LineChart>
          ) : activeType === 'area' ? (
            <AreaChart data={data} margin={{ top: 10, right: 30, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip {...tooltipStyle} />
              <Legend {...legendProps} />
              {valueCols.map((col, idx) => (
                <Area
                  key={col}
                  type="monotone"
                  dataKey={col}
                  stroke={COLORS[idx % COLORS.length]}
                  fill={COLORS[idx % COLORS.length]}
                  fillOpacity={hiddenSeries.has(col) ? 0 : 0.15}
                  strokeWidth={2}
                  hide={hiddenSeries.has(col)}
                />
              ))}
            </AreaChart>
          ) : (
            <BarChart data={data} margin={{ top: 10, right: 30, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip {...tooltipStyle} />
              <Legend {...legendProps} />
              {valueCols.map((col, idx) => (
                <Bar key={col} dataKey={col} fill={COLORS[idx % COLORS.length]} radius={[4, 4, 0, 0]} hide={hiddenSeries.has(col)} />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  )
}
