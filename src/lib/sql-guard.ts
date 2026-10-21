import pkg from 'node-sql-parser'
import { MAX_RESULT_ROWS } from './constants'

const { Parser } = pkg
const parser = new Parser()
const PARSER_OPTIONS = { database: 'MySQL' }

const DANGEROUS_FUNCTIONS = new Set([
  'LOAD_FILE', 'BENCHMARK', 'SLEEP', 'EXEC', 'EXECUTE', 'SYSTEM', 'SYS_EXEC',
  'UUID_TO_BIN', 'INTO_OUTFILE', 'INTO_DUMPFILE', 'EXTRACTVALUE', 'UPDATEXML',
  'EXPORT_SET', 'MAKE_SET', 'GET_LOCK', 'RELEASE_LOCK', 'IS_FREE_LOCK', 'IS_USED_LOCK',
  'MASTER_POS_WAIT', 'SOURCE_POS_WAIT', 'WAIT_FOR_EXECUTED_GTID_SET',
])

type SqlNode = Record<string, any>
export type SqlPermission = 'readonly' | 'write'

export interface SqlValidationResult {
  allowed: boolean
  reason?: string
  tables?: string[]
}

/** Remove ordinary comments without treating comment markers inside literals as comments. */
function normalizeComments(sql: string): string {
  let output = ''
  let quote = ''
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]
    if (quote) {
      output += ch
      if (ch === '\\' && quote !== '`' && i + 1 < sql.length) {
        output += sql[++i]
      } else if (ch === quote) {
        if (sql[i + 1] === quote) output += sql[++i]
        else quote = ''
      }
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
      output += ch
    } else if (ch === '/' && sql[i + 1] === '*') {
      if (sql[i + 2] === '!' || /^M!/i.test(sql.slice(i + 2, i + 4))) {
        throw new Error('不允许 MySQL/MariaDB 可执行注释')
      }
      const end = sql.indexOf('*/', i + 2)
      if (end < 0) throw new Error('SQL 注释未闭合')
      output += ' '
      i = end + 1
    } else if (ch === '#' || (ch === '-' && sql[i + 1] === '-' && /\s/.test(sql[i + 2] ?? ''))) {
      while (i + 1 < sql.length && sql[i + 1] !== '\n') i++
      output += ' '
    } else {
      output += ch
    }
  }
  if (quote) throw new Error('SQL 引号未闭合')
  return output.trim()
}

function inspectNode(node: unknown): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    node.forEach(inspectNode)
    return
  }
  const obj = node as SqlNode
  if (obj.type === 'function') {
    const names = typeof obj.name === 'string'
      ? [obj.name]
      : (obj.name?.name ?? []).map((part: { value?: string }) => part.value ?? '')
    for (const name of names) {
      if (DANGEROUS_FUNCTIONS.has(name.toUpperCase())) {
        throw new Error(`SQL 包含禁止的函数调用: "${name.toUpperCase()}()"`)
      }
    }
  }
  if (obj.type === 'select' && (obj.into?.position || obj.locking_read)) {
    throw new Error('不允许 SELECT INTO 或锁定读取')
  }
  if (obj.type === 'assign' || obj.operator === ':=' || obj.symbol === ':=') throw new Error('不允许修改会话变量')
  for (const value of Object.values(obj)) inspectNode(value)
}

function parseValidatedSql(sql: string, mode: SqlPermission): { ast: SqlNode; tables: string[]; source: string } {
  if (typeof sql !== 'string' || sql.length > 200_000) throw new Error('SQL 为空或超过长度限制')
  const cleaned = normalizeComments(sql)
  if (!cleaned) throw new Error('SQL 语句为空')

  let parsed: ReturnType<InstanceType<typeof Parser>['parse']>
  try {
    parsed = parser.parse(cleaned, PARSER_OPTIONS)
  } catch {
    throw new Error('无法可靠解析此 SQL，请改用受支持的 MySQL 语法；为安全起见已拒绝执行')
  }
  const statements = Array.isArray(parsed.ast) ? parsed.ast : [parsed.ast]
  if (statements.length !== 1 || !statements[0]) throw new Error('每次只能执行一条 SQL')
  const ast = statements[0] as unknown as SqlNode
  const allowed = new Set(['select', 'show', 'desc', 'describe', 'explain'])
  if (mode === 'write') ['insert', 'update', 'delete', 'replace'].forEach(type => allowed.add(type))
  if (!allowed.has(ast.type)) throw new Error(`当前权限不允许执行 "${String(ast.type).toUpperCase()}" 语句`)
  inspectNode(ast)
  const tables = [...new Set(parsed.tableList.map(entry => entry.split('::')[2]).filter(name => name && name !== 'null').map(name => name.toLowerCase()))]
  return { ast, tables, source: cleaned.replace(/;\s*$/, '') }
}

/** Parsing failures are rejected; no keyword-only fallback is allowed. */
export function validateSql(sql: string, mode: SqlPermission = 'readonly'): SqlValidationResult {
  try {
    return { allowed: true, tables: parseValidatedSql(sql, mode).tables }
  } catch (error) {
    return { allowed: false, reason: error instanceof Error ? error.message : 'SQL 校验失败' }
  }
}

export interface PreparedSql {
  sql: string
  isSelect: boolean
  isWrite: boolean
  maxRows: number
  resultLimitApplied: boolean
}

/** Locate only the outer LIMIT after the AST has established that one exists. */
function findOuterLimit(source: string): number {
  let depth = 0
  let quote = ''
  let lastLimit = -1
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]
    if (quote) {
      if (ch === '\\' && quote !== '`') i++
      else if (ch === quote) {
        if (source[i + 1] === quote) i++
        else quote = ''
      }
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch
    else if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (/[A-Za-z_]/.test(ch)) {
      const start = i
      while (i + 1 < source.length && /[A-Za-z0-9_$]/.test(source[i + 1])) i++
      if (depth === 0 && source.slice(start, i + 1).toUpperCase() === 'LIMIT') lastLimit = start
    }
  }
  return lastLimit
}

/** Use the validated AST for the outer cap, preserving original numeric/string literals. */
export function prepareSqlForExecution(sql: string, mode: SqlPermission = 'readonly', maxRows = MAX_RESULT_ROWS): PreparedSql {
  if (!Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > MAX_RESULT_ROWS) throw new Error('无效的结果行数限制')
  const { ast, source } = parseValidatedSql(sql, mode)
  let executableSql = source
  const isSelect = ast.type === 'select'
  let resultLimitApplied = false
  if (isSelect) {
    // UNION's unparenthesized final SELECT owns the global limit. Parenthesized
    // branches use the root's _limit for the compound query's global limit.
    let tail = ast
    while (tail._next) tail = tail._next
    const useCompoundLimit = Boolean(ast._limit || tail.parentheses_symbol)
    const owner = useCompoundLimit ? ast : tail
    const key = useCompoundLimit ? '_limit' : 'limit'
    const limit = owner[key]
    const countIndex = limit?.seperator === ',' ? 1 : 0
    const count = limit?.value?.[countIndex]
    if (limit && (!count || limit.value.some((value: SqlNode) => value.type !== 'number' || !Number.isSafeInteger(value.value) || value.value < 0))) {
      throw new Error('LIMIT 必须为非负整数')
    }
    if (!limit || count.value > maxRows) {
      // Fetch one sentinel row to distinguish truncation from exactly maxRows rows.
      if (!limit) executableSql = `${source} LIMIT ${maxRows + 1}`
      else {
        const position = findOuterLimit(source)
        if (position < 0) throw new Error('无法可靠定位外层 LIMIT，已拒绝执行')
        const suffix = limit.seperator === ','
          ? `${limit.value[0].value}, ${maxRows + 1}`
          : limit.seperator === 'offset'
            ? `${maxRows + 1} OFFSET ${limit.value[1].value}`
            : `${maxRows + 1}`
        executableSql = `${source.slice(0, position)}LIMIT ${suffix}`
      }
      resultLimitApplied = true
    }
  }
  return {
    sql: executableSql,
    isSelect,
    isWrite: ['insert', 'update', 'delete', 'replace'].includes(ast.type),
    maxRows,
    resultLimitApplied,
  }
}
