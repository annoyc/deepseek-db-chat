import type { SqlResultInfo } from './types'
import { maskPII, sanitizeModelData } from './masking'

/**
 * Build comprehensive column-level statistics for AI analysis.
 * Produces numeric stats (min/max/avg/median/sum) and categorical frequency distributions,
 * so the AI can analyze the full dataset rather than just the first N rows.
 */
export function computeFullColumnStats(columns: string[], rows: Record<string, unknown>[]): string[] {
  if (rows.length === 0) return []
  const sections: string[] = []

  for (const col of columns) {
    const nums: number[] = []
    let nullCount = 0
    const valueCounts = new Map<string, number>()

    for (const row of rows) {
      const val = row[col]
      if (val === null || val === undefined) { nullCount++; continue }
      const str = String(val)
      valueCounts.set(str, (valueCounts.get(str) ?? 0) + 1)
      const n = Number(val)
      if (!isNaN(n) && isFinite(n) && str.trim() !== '') nums.push(n)
    }

    const distinctCount = valueCounts.size
    const parts: string[] = [`  ${col}:`]

    if (nullCount > 0) parts.push(`    空值: ${nullCount}/${rows.length}`)

    // Numeric column: full statistical summary
    if (nums.length >= 2 && nums.length >= rows.length * 0.3) {
      nums.sort((a, b) => a - b)
      const min = nums[0]
      const max = nums[nums.length - 1]
      const sum = nums.reduce((a, b) => a + b, 0)
      const avg = sum / nums.length
      const mid = nums.length % 2 === 0
        ? (nums[nums.length / 2 - 1] + nums[nums.length / 2]) / 2
        : nums[Math.floor(nums.length / 2)]
      parts.push(`    数值统计: 最小=${min}, 最大=${max}, 平均=${Number(avg.toFixed(2))}, 中位数=${Number(mid.toFixed(2))}, 总和=${Number(sum.toFixed(2))}`)
    }

    // Categorical column: frequency distribution (top values + long tail info)
    if (distinctCount <= 30 || (distinctCount > 0 && distinctCount < rows.length * 0.3)) {
      const sorted = [...valueCounts.entries()].sort((a, b) => b[1] - a[1])
      const top = sorted.slice(0, 10)
      const freqParts = top.map(([v, c]) => `${v}(${c})`)
      if (sorted.length > 10) freqParts.push(`...还有${sorted.length - 10}种`)
      parts.push(`    分布(${distinctCount}种): ${freqParts.join(', ')}`)
    } else if (distinctCount > 0) {
      parts.push(`    去重数: ${distinctCount}`)
    }

    if (parts.length > 1) sections.push(parts.join('\n'))
  }
  return sections
}

/**
 * Determine the appropriate detail level for sending results to the AI.
 * Small results: send all rows. Large results: send stats + representative sample.
 */
export function formatSqlResultForAI(sql: string, rawResult: SqlResultInfo): string {
  const result = { ...rawResult, rows: sanitizeModelData(rawResult.rows) as Record<string, unknown>[] }
  sql = result.executedSql ?? sql
  const lines: string[] = [`以下SQL已执行完成：`, '```sql', sql, '```', '']
  lines.push(`执行耗时: ${result.executionTime}ms，返回 ${result.rowCount} 行`)
  if (result.truncated) lines.push(`注意：结果已截断，仅包含前 ${result.maxRows ?? result.rowCount} 行。下方统计仅代表这些已返回行，不能推断全表总数或整体分布；需要全量指标时重新提交聚合 SQL。`)
  lines.push('')

  if (result.rows.length > 0) {
    const insertId = Number(result.rows[0]?.insertId ?? 0)
    if (insertId > 0) {
      lines.push(`⚠️ 本次 INSERT 的真实 insertId = ${insertId}。后续如需 UPDATE/DELETE/SELECT 该记录，请使用此 ID。`)
      lines.push('')
    }

    const isSmallResult = result.rows.length <= 30

    if (isSmallResult) {
      // Small result: send all rows directly
      lines.push('结果数据：')
      const header = result.columns.join(' | ')
      lines.push(header)
      lines.push(result.columns.map(() => '---').join(' | '))
      for (const row of result.rows) {
        lines.push(result.columns.map((col) => maskPII(String(row[col] ?? 'NULL'))).join(' | '))
      }
    } else {
      // Large result: statistics first, then representative sample
      const statsLines = computeFullColumnStats(result.columns, result.rows)
      if (statsLines.length > 0) {
        lines.push(`【统计摘要】（基于已返回 ${result.rowCount} 行计算）：`)
        lines.push(...statsLines)
        lines.push('')
      }

      // Representative sample: first 5 + last 5 rows
      lines.push(`【样本数据】（前5行 + 后5行）：`)
      const header = result.columns.join(' | ')
      lines.push(header)
      lines.push(result.columns.map(() => '---').join(' | '))
      for (const row of result.rows.slice(0, 5)) {
        lines.push(result.columns.map((col) => maskPII(String(row[col] ?? 'NULL'))).join(' | '))
      }
      lines.push('...')
      for (const row of result.rows.slice(-5)) {
        lines.push(result.columns.map((col) => maskPII(String(row[col] ?? 'NULL'))).join(' | '))
      }
    }

    // Always append full stats for results > 2 rows (even small ones benefit from summary)
    if (!isSmallResult || result.rows.length > 2) {
      const statsForSmall = isSmallResult ? computeFullColumnStats(result.columns, result.rows) : []
      if (isSmallResult && statsForSmall.length > 0) {
        lines.push('')
        lines.push('统计摘要：')
        lines.push(...statsForSmall)
      }
    }
  } else {
    lines.push('查询无返回数据。')
  }

  lines.push('')

  const isWriteOperation = /^\s*(INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|CREATE|TRUNCATE)\s/i.test(sql.trim())
  if (isWriteOperation) {
    lines.push('以上写操作已成功执行。请直接基于此结果给出最终回复，告知用户操作结果。除非用户明确要求执行更多操作，否则不要再生成新的SQL。')
  } else {
    lines.push('请基于以上统计摘要和样本数据分析并回答用户的问题。分析时优先引用统计摘要中的数据（而非仅看样本行），必须说明结论所覆盖的已返回数据范围。如果已有足够信息回答，请直接给出最终答案。如果确实还需要更多数据才能回答，可以继续生成SQL。')
  }

  return lines.join('\n')
}
