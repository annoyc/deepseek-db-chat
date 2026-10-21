export type ResultRow = Record<string, unknown>
export type ResultSortDirection = 'asc' | 'desc' | null

/** Missing and non-numeric values must stay missing in charts and statistics. */
export function toResultNumber(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && value.trim() === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

/** SQL values and column labels are authoritative; never infer currency or scale. */
export function formatResultMetricValue(value: unknown): string {
  if (value == null) return '—'
  return String(value)
}

export function formatResultStatistic(value: number): string {
  return value.toLocaleString('zh-CN', { maximumSignificantDigits: 15 })
}

export function sortResultRows(rows: ResultRow[], column: string | null, direction: ResultSortDirection): ResultRow[] {
  if (!column || !direction) return rows
  return [...rows].sort((a, b) => {
    const left = a[column]
    const right = b[column]
    if (left == null && right == null) return 0
    if (left == null) return 1
    if (right == null) return -1
    const leftNumber = toResultNumber(left)
    const rightNumber = toResultNumber(right)
    const comparison = leftNumber !== null && rightNumber !== null
      ? leftNumber - rightNumber
      : String(left).localeCompare(String(right), 'zh-CN')
    return direction === 'asc' ? comparison : -comparison
  })
}

export function getResultPage(rows: ResultRow[], requestedPage: number, pageSize = 100) {
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
  const page = Math.max(0, Math.min(requestedPage, pageCount - 1))
  const start = page * pageSize
  return { rows: rows.slice(start, start + pageSize), page, pageCount, start, end: Math.min(start + pageSize, rows.length) }
}

/** Keep complete labels, including year, time and timezone, for tooltips. */
export function buildResultChartRows(rows: ResultRow[], labelColumn: string, valueColumns: string[]): ResultRow[] {
  return rows.map((row) => {
    const label = row[labelColumn]
    const entry: ResultRow = {
      name: label instanceof Date ? label.toISOString() : label == null ? '（空值）' : String(label),
    }
    for (const column of valueColumns) entry[column] = toResultNumber(row[column])
    return entry
  })
}

export function recommendResultChartType(isTemporal: boolean): 'line' | 'bar' {
  return isTemporal ? 'line' : 'bar'
}

export function canUseResultPie(data: ResultRow[], valueColumns: string[], isTemporal: boolean): boolean {
  if (isTemporal || valueColumns.length !== 1 || data.length < 2 || data.length > 10) return false
  if (new Set(data.map((row) => row.name)).size !== data.length) return false
  const values = data.map((row) => toResultNumber(row[valueColumns[0]]))
  return values.every((value) => value !== null && value >= 0) && values.some((value) => value !== null && value > 0)
}

export function resultRowsToMarkdown(columns: string[], rows: ResultRow[]): string {
  const escape = (value: unknown) => String(value ?? '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')
  return [
    `| ${columns.map(escape).join(' | ')} |`,
    `| ${columns.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${columns.map((column) => escape(row[column])).join(' | ')} |`),
  ].join('\n')
}
