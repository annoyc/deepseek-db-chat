import pkg from 'node-sql-parser'
const { Parser } = pkg
import { ALLOWED_SQL_KEYWORDS, BLOCKED_SQL_PATTERNS, WRITE_SQL_KEYWORDS } from './constants'

const parser = new Parser()

// ────────────────────────────────────────────────────────────
//  Dangerous MySQL functions — must never appear in SQL
// ────────────────────────────────────────────────────────────
const DANGEROUS_FUNCTIONS = new Set([
  'LOAD_FILE', 'BENCHMARK', 'SLEEP',
  'EXEC', 'EXECUTE',
  'SYSTEM', 'SYS_EXEC',
  'UUID_TO_BIN',
  'INTO_OUTFILE', 'INTO_DUMPFILE',
  'EXTRACTVALUE', 'UPDATEXML',
  'EXPORT_SET', 'MAKE_SET',
  'GET_LOCK', 'RELEASE_LOCK', 'IS_FREE_LOCK', 'IS_USED_LOCK',
  'MASTER_POS_WAIT', 'SOURCE_POS_WAIT',
  'WAIT_FOR_EXECUTED_GTID_SET',
])

// ────────────────────────────────────────────────────────────
//  Regex-based fallback (used when AST parsing fails)
// ────────────────────────────────────────────────────────────

/** Strip SQL comments: single-line (--) and multi-line block comments */
function stripComments(sql: string): string {
  let result = sql.replace(/\/\*[\s\S]*?\*\//g, '')
  result = result.replace(/--[^\n]*/g, '')
  return result
}

/** Split SQL by `;` while respecting quoted strings */
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

// ────────────────────────────────────────────────────────────
//  AST-based table & function extraction
// ────────────────────────────────────────────────────────────

/**
 * Recursively walk an AST node to find all function call names.
 */
function collectFunctionNames(node: unknown, result: Set<string> = new Set()): Set<string> {
  if (!node || typeof node !== 'object') return result

  if (Array.isArray(node)) {
    for (const item of node) collectFunctionNames(item, result)
    return result
  }

  const obj = node as Record<string, unknown>

  // Detect function call nodes: { type: 'function', name: { name: [...] } }
  if (obj.type === 'function' && obj.name && typeof obj.name === 'object') {
    const nameObj = obj.name as { name?: Array<{ value?: string }> }
    if (nameObj.name && Array.isArray(nameObj.name)) {
      for (const part of nameObj.name) {
        if (part?.value) result.add(String(part.value).toUpperCase())
      }
    }
  }

  // Recurse into all child properties
  for (const key of Object.keys(obj)) {
    collectFunctionNames(obj[key], result)
  }

  return result
}

/**
 * Extract all table names from the parser's `tableList` result.
 * Format: `"select::db::table_name"` → extract `table_name`
 */
function extractTableNames(tableList: string[]): string[] {
  const tables = new Set<string>()
  for (const entry of tableList) {
    const parts = entry.split('::')
    if (parts.length >= 3) {
      const tableName = parts[2]
      if (tableName && tableName !== '(null)') {
        tables.add(tableName.toLowerCase())
      }
    }
  }
  return [...tables]
}

// ────────────────────────────────────────────────────────────
//  Main validation function
// ────────────────────────────────────────────────────────────

export interface SqlValidationResult {
  allowed: boolean
  reason?: string
  /** All table names referenced in the SQL (including subqueries) */
  tables?: string[]
}

/**
 * Validate SQL using a hybrid approach:
 * 1. Regex blacklist for known-dangerous patterns (fast, catches DDL/DCL)
 * 2. AST parsing for precise table & function extraction (catches subqueries, nested calls)
 * 3. Regex fallback for first-keyword whitelist if AST parsing fails
 */
export function validateSql(sql: string, mode: 'readonly' | 'write' = 'readonly'): SqlValidationResult {
  const cleaned = stripComments(sql)

  if (!cleaned.trim()) {
    return { allowed: false, reason: 'SQL 语句为空' }
  }

  // ── Step 1: Regex blacklist (always runs — fast and reliable for DDL/DCL) ──
  for (const pattern of BLOCKED_SQL_PATTERNS) {
    if (pattern.test(cleaned)) {
      const match = cleaned.match(pattern)
      return {
        allowed: false,
        reason: `SQL 包含禁止的关键字: "${match?.[0]?.toUpperCase() ?? ''}"`,
      }
    }
  }

  // ── Step 2: AST-based deep analysis ──
  try {
    const parsed = parser.parse(cleaned)

    // Handle multi-statement SQL (parsed returns an array)
    const astList = Array.isArray(parsed.ast) ? parsed.ast : [parsed.ast]

    for (const ast of astList) {
      if (!ast) continue

      // 2a. Check statement type against whitelist
      const stmtType = (ast.type || '').toUpperCase()
      const allowedKeywords = mode === 'write'
        ? [...ALLOWED_SQL_KEYWORDS, ...WRITE_SQL_KEYWORDS]
        : [...ALLOWED_SQL_KEYWORDS]
      const allowedSet = new Set<string>(allowedKeywords)

      if (!allowedSet.has(stmtType)) {
        return {
          allowed: false,
          reason: `不允许执行 "${stmtType}" 语句，仅允许: ${allowedKeywords.join('/')}`,
        }
      }

      // 2b. Check for dangerous function calls anywhere in the AST
      const funcNames = collectFunctionNames(ast)
      for (const fn of funcNames) {
        if (DANGEROUS_FUNCTIONS.has(fn)) {
          return {
            allowed: false,
            reason: `SQL 包含禁止的函数调用: "${fn}()"`,
          }
        }
      }
    }

    // 2c. Extract all referenced table names (for future permission checks)
    const allTableList = Array.isArray(parsed.tableList) ? parsed.tableList : []
    const tables = extractTableNames(allTableList)

    return { allowed: true, tables }
  } catch (err) {
    console.warn('[sql-guard] AST parsing failed, falling back to regex:', err)
    return validateSqlFallback(cleaned, mode)
  }
}

/**
 * Regex-based fallback for when AST parsing fails (e.g. unusual MySQL syntax).
 * Checks first keyword of each statement against whitelist.
 */
function validateSqlFallback(cleaned: string, mode: 'readonly' | 'write'): SqlValidationResult {
  const statements = splitStatements(cleaned)
  const keywords = mode === 'write'
    ? [...ALLOWED_SQL_KEYWORDS, ...WRITE_SQL_KEYWORDS]
    : [...ALLOWED_SQL_KEYWORDS]
  const allowedSet = new Set<string>(keywords)
  const allowedLabel = keywords.join('/')

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
