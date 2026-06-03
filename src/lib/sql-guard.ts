import { ALLOWED_SQL_KEYWORDS, BLOCKED_SQL_PATTERNS, WRITE_SQL_KEYWORDS } from './constants'

/**
 * 去除 SQL 中的注释
 * 支持 -- 单行注释和 /* *\/ 多行注释
 */
function stripComments(sql: string): string {
  // 去除多行注释 /* ... */
  let result = sql.replace(/\/\*[\s\S]*?\*\//g, '')
  // 去除单行注释 -- ...
  result = result.replace(/--[^\n]*/g, '')
  return result
}

/**
 * 按分号拆分 SQL 语句，忽略字符串内的分号
 */
function splitStatements(sql: string): string[] {
  const statements: string[] = []
  let current = ''
  let inSingleQuote = false
  let inDoubleQuote = false
  let inBacktick = false

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]

    if (ch === "'" && !inDoubleQuote && !inBacktick) {
      inSingleQuote = !inSingleQuote
    } else if (ch === '"' && !inSingleQuote && !inBacktick) {
      inDoubleQuote = !inDoubleQuote
    } else if (ch === '`' && !inSingleQuote && !inDoubleQuote) {
      inBacktick = !inBacktick
    } else if (ch === ';' && !inSingleQuote && !inDoubleQuote && !inBacktick) {
      const trimmed = current.trim()
      if (trimmed) statements.push(trimmed)
      current = ''
      continue
    }

    current += ch
  }

  const trimmed = current.trim()
  if (trimmed) statements.push(trimmed)

  return statements
}

/**
 * 校验 SQL 是否允许执行
 * 双重校验：白名单（首关键字）+ 黑名单（危险模式）
 * @param mode 'readonly' 仅允许查询; 'write' 额外允许写操作
 */
export function validateSql(sql: string, mode: 'readonly' | 'write' = 'readonly'): { allowed: boolean; reason?: string } {
  const cleaned = stripComments(sql)

  if (!cleaned.trim()) {
    return { allowed: false, reason: 'SQL 语句为空' }
  }

  // 检查整条 SQL 是否包含危险模式
  for (const pattern of BLOCKED_SQL_PATTERNS) {
    if (pattern.test(cleaned)) {
      const match = cleaned.match(pattern)
      return {
        allowed: false,
        reason: `SQL 包含禁止的关键字: "${match?.[0]?.toUpperCase() ?? ''}"`,
      }
    }
  }

  // 拆分多语句，逐条检查白名单
  const statements = splitStatements(cleaned)
  const keywords = mode === 'write'
    ? [...ALLOWED_SQL_KEYWORDS, ...WRITE_SQL_KEYWORDS]
    : [...ALLOWED_SQL_KEYWORDS]
  const allowedSet = new Set<string>(keywords)
  const allowedLabel = keywords.join('/')
  console.log('allowedSet', allowedSet)

  for (const stmt of statements) {
    const firstWord = /^[A-Za-z_]+/.exec(stmt)
    if (!firstWord) {
      return { allowed: false, reason: `无法识别的 SQL 语句开头: "${stmt.slice(0, 30)}"` }
    }
    if (!allowedSet.has(firstWord[0].toUpperCase())) {
      return {
        allowed: false,
        reason: `不允许执行 "${firstWord[0].toUpperCase()}" 语句，仅允许: ${allowedLabel}`,
      }
    }
  }

  return { allowed: true }
}
