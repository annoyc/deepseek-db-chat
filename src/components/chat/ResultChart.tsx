import { useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, Legend } from 'recharts'
import type { SqlResultInfo } from '@/lib/types'

interface ResultChartProps {
  result: SqlResultInfo
}

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#ec4899']

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}|T\d{2}:\d{2}|^\d{4}\/\d{2}/

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
      return {
        col,
        isNumeric: numericCount > rows.length * 0.5,
        isDate: dateCount > rows.length * 0.3,
      }
    })

    const valueCols = colAnalysis
      .filter((c) => c.isNumeric && !c.isDate)
      .map((c) => c.col)

    if (valueCols.length === 0) return null

    const labelCandidates = colAnalysis.filter((c) => !c.isNumeric || c.isDate)
    const labelCol = labelCandidates.length > 0
      ? (labelCandidates.find((c) => !c.isDate)?.col ?? labelCandidates[0].col)
      : columns[0]

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

    return { data, labelCol, valueCols }
  }, [columns, rows])

  if (!chartData) {
    return (
      <div className="flex items-center justify-center h-60 text-sm text-gray-400">
        数据不适合图表展示
      </div>
    )
  }

  const { data, valueCols } = chartData

  if (data.length <= 6 && valueCols.length === 1) {
    return (
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
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
        </ResponsiveContainer>
      </div>
    )
  }

  if (data.length > 10) {
    return (
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
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
        </ResponsiveContainer>
      </div>
    )
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
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
      </ResponsiveContainer>
    </div>
  )
}
