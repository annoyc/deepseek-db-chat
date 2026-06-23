import mysql from 'mysql2/promise'
import type { DatabaseConnection, SqlResultInfo } from '@/lib/types'
import { MAX_POOL_SIZE, QUERY_TIMEOUT_MS, MAX_RESULT_ROWS } from '@/lib/constants'
import { validateSql } from '@/lib/sql-guard'
import { subsetTables } from './schema-subsetting'

const pools = new Map<string, mysql.Pool>()
const poolFingerprints = new Map<string, string>()

function connectionFingerprint(conn: DatabaseConnection): string {
  return `${conn.host}|${conn.port}|${conn.user}|${conn.password}|${conn.database}`
}

// ── Dictionary table detection & caching ──

interface DictEntry {
  value: string
  label: string
}

/** Cached dict mappings: dictType → [{ value, label }] */
type DictCache = Map<string, DictEntry[]>

/** Per-connection dict cache (populated once on first getTableSchema call) */
const dictCaches = new Map<string, { cache: DictCache; tableInfo: DictTableInfo | null }>()

interface DictTableInfo {
  tableName: string
  typeColumn: string
  valueColumn: string
  labelColumn: string
}

/**
 * Common dictionary table naming patterns in Chinese enterprise systems.
 * Ordered by popularity — first match wins.
 */
const DICT_TABLE_CANDIDATES = [
  'sys_dict_data', 'sys_dict_item', 'sys_dict_detail',
  'dict_data', 'dict_item', 'dict_detail',
  'sys_dictionary_data', 'sys_dictionary_item',
  't_dict_data', 't_dict_item',
  'base_dict_data', 'base_dict_item',
  'sys_dict', 'dict', 'sys_dictionary', 't_dict', 'base_dict',
  'code_item', 'code_table', 'lookup_item', 'lookup',
]

/** Possible column names for each role in a dictionary table */
const DICT_TYPE_COLS = ['dict_type', 'type', 'dict_code', 'code', 'type_code', 'category', 'dict_key', 'group_code', 'parent_code']
const DICT_VALUE_COLS = ['dict_value', 'value', 'item_value', 'code_value', 'data_value', 'dict_sort', 'item_code']
const DICT_LABEL_COLS = ['dict_label', 'label', 'name', 'item_text', 'item_name', 'dict_name', 'code_name', 'data_label', 'display_name', 'title']

/**
 * Detect if the database has a dictionary/lookup table and identify its structure.
 * Returns null if no dictionary table is found.
 */
async function detectDictTable(pool: mysql.Pool, database: string, tableNames: string[]): Promise<DictTableInfo | null> {
  const lowerSet = new Map(tableNames.map(t => [t.toLowerCase(), t]))

  for (const candidate of DICT_TABLE_CANDIDATES) {
    const actualName = lowerSet.get(candidate)
    if (!actualName) continue

    // Get columns of this candidate table
    const [cols] = await pool.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
      [database, actualName],
    )
    const colNames = (cols as Record<string, unknown>[]).map(c => String(c.COLUMN_NAME).toLowerCase())

    // Try to match the three required roles
    const typeCol = DICT_TYPE_COLS.find(c => colNames.includes(c))
    const valueCol = DICT_VALUE_COLS.find(c => colNames.includes(c))
    const labelCol = DICT_LABEL_COLS.find(c => colNames.includes(c))

    if (typeCol && valueCol && labelCol) {
      return { tableName: actualName, typeColumn: typeCol, valueColumn: valueCol, labelColumn: labelCol }
    }
  }
  return null
}

/**
 * Load all dictionary entries into a cache, grouped by dict_type.
 */
async function loadDictCache(pool: mysql.Pool, info: DictTableInfo): Promise<DictCache> {
  const cache: DictCache = new Map()
  try {
    const [rows] = await pool.query(
      `SELECT \`${info.typeColumn}\` AS dict_type, \`${info.valueColumn}\` AS dict_value, \`${info.labelColumn}\` AS dict_label
       FROM \`${info.tableName}\`
       WHERE \`${info.typeColumn}\` IS NOT NULL AND \`${info.labelColumn}\` IS NOT NULL
       ORDER BY \`${info.typeColumn}\`, \`${info.valueColumn}\`
       LIMIT 2000`,
    )
    for (const row of rows as Record<string, unknown>[]) {
      const type = String(row.dict_type)
      const entry: DictEntry = { value: String(row.dict_value), label: String(row.dict_label) }
      if (!cache.has(type)) cache.set(type, [])
      cache.get(type)!.push(entry)
    }
  } catch (err) { console.warn('[database] Failed to load dict cache:', err) }
  return cache
}

/**
 * Get or initialize the dictionary cache for a connection.
 */
async function getOrInitDictCache(pool: mysql.Pool, connection: DatabaseConnection, tableNames: string[]): Promise<{ cache: DictCache; tableInfo: DictTableInfo | null }> {
  const key = connection.id
  if (dictCaches.has(key)) return dictCaches.get(key)!

  const tableInfo = await detectDictTable(pool, connection.database, tableNames)
  const cache = tableInfo ? await loadDictCache(pool, tableInfo) : new Map()
  const result = { cache, tableInfo }
  dictCaches.set(key, result)
  return result
}

/**
 * Try to find dictionary labels for a column by matching dict_type against:
 *   1. Exact column name (e.g., dict_type='status' for column 'status')
 *   2. table_column pattern (e.g., dict_type='order_status' for orders.status)
 *   3. Fuzzy prefix match (e.g., dict_type='user_type' for column 'type' in users table)
 */
function lookupDictEntries(cache: DictCache, tableName: string, columnName: string): DictEntry[] | null {
  const colLower = columnName.toLowerCase()
  const tableLower = tableName.toLowerCase().replace(/^(sys_|t_|tb_|tbl_)/, '')

  // Priority 1: exact match on column name
  const exact = cache.get(colLower)
  if (exact && exact.length > 0) return exact

  // Priority 2: table_column compound key
  const compound = cache.get(`${tableLower}_${colLower}`)
  if (compound && compound.length > 0) return compound

  // Priority 3: try without common column suffixes
  // e.g., 'order_status' column → try dict_type='order_status'
  const withoutSuffix = colLower.replace(/_(status|type|state|level|code|kind|mode|flag|category)$/, '')
  if (withoutSuffix !== colLower) {
    const suffixMatch = cache.get(colLower) ?? cache.get(`${tableLower}_${withoutSuffix}`)
    if (suffixMatch && suffixMatch.length > 0) return suffixMatch
  }

  // Priority 4: scan all dict_types for a key that ends with the column name
  for (const [dictType, entries] of cache) {
    if (dictType.endsWith(`_${colLower}`) || dictType.endsWith(`.${colLower}`)) {
      return entries
    }
  }

  return null
}

export function getPool(connection: DatabaseConnection): mysql.Pool {
  const fp = connectionFingerprint(connection)
  const existingPool = pools.get(connection.id)
  const existingFp = poolFingerprints.get(connection.id)

  if (existingPool && existingFp === fp) {
    return existingPool
  }

  if (existingPool) {
    existingPool.end().catch((err) => console.warn('[database] Failed to close stale pool:', err))
    pools.delete(connection.id)
    poolFingerprints.delete(connection.id)
    dictCaches.delete(connection.id)
  }

  const pool = mysql.createPool({
    host: connection.host,
    port: connection.port,
    user: connection.user,
    password: connection.password,
    database: connection.database,
    connectionLimit: MAX_POOL_SIZE,
    connectTimeout: 10_000,
    waitForConnections: true,
    queueLimit: 0,
  })

  pools.set(connection.id, pool)
  poolFingerprints.set(connection.id, fp)
  return pool
}

export async function testConnection(connection: DatabaseConnection): Promise<{ success: boolean; error?: string }> {
  try {
    if (!connection.id) {
      const tempConn = await mysql.createConnection({
        host: connection.host,
        port: connection.port,
        user: connection.user,
        password: connection.password,
        database: connection.database,
        connectTimeout: 10_000,
      })
      await tempConn.ping()
      await tempConn.end()
      return { success: true }
    }

    const pool = getPool(connection)
    const conn = await pool.getConnection()
    await conn.ping()
    conn.release()
    return { success: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[database] Test connection failed:', msg)
    return { success: false, error: '当前所选数据库连接失败，请检查连接参数' }
  }
}

/**
 * Check whether a table name exists in the current database.
 * Used to prevent SQL injection via table name parameters.
 */
async function tableExists(connection: DatabaseConnection, tableName: string): Promise<boolean> {
  const pool = getPool(connection)
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [connection.database, tableName],
  )
  return ((rows as Record<string, unknown>[])[0]?.cnt as number) > 0
}

/**
 * Auto-inject LIMIT into SELECT statements that lack one.
 * Returns the original SQL unchanged for non-SELECT or statements that already have LIMIT.
 */
function ensureSelectLimit(sql: string, maxRows: number): string {
  const trimmed = sql.trim()
  // Only apply to SELECT / WITH queries
  if (!/^\s*(SELECT|WITH)\b/i.test(trimmed)) return trimmed
  // Already has a LIMIT clause at the top level (crude but effective for generated SQL)
  if (/\bLIMIT\s+\d+/i.test(trimmed)) return trimmed
  return `${trimmed.replace(/;?\s*$/, '')} LIMIT ${maxRows}`
}

export async function executeQuery(connection: DatabaseConnection, sql: string): Promise<SqlResultInfo> {
  const pool = getPool(connection)
  const start = Date.now()

  // Enforce result row limit for safety
  const safeSql = ensureSelectLimit(sql, MAX_RESULT_ROWS)

  const conn = await pool.getConnection()
  try {
    const [rows, fields] = await conn.query({
      sql: safeSql,
      timeout: QUERY_TIMEOUT_MS,
    })

    const executionTime = Date.now() - start

    if (Array.isArray(rows)) {
      const columns = fields ? (fields as mysql.FieldPacket[]).map((f) => f.name) : []
      // BigInt-safe serialization: convert to String to preserve precision
      const data = JSON.parse(JSON.stringify(rows, (_key, value) =>
        typeof value === 'bigint' ? String(value) : value
      )) as Record<string, unknown>[]
      return {
        columns,
        rows: data,
        rowCount: data.length,
        executionTime,
      }
    }

    const result = rows as mysql.ResultSetHeader
    return {
      columns: ['affectedRows', 'insertId', 'changedRows'],
      rows: [{ affectedRows: Number(result.affectedRows), insertId: Number(result.insertId), changedRows: Number(result.changedRows) }],
      rowCount: 1,
      executionTime,
    }
  } finally {
    conn.release()
  }
}

export async function listTables(connection: DatabaseConnection): Promise<string[]> {
  const pool = getPool(connection)
  const [rows] = await pool.query('SHOW TABLES')
  return (rows as Record<string, string>[]).map((row) => Object.values(row)[0])
}

/**
 * Get foreign key relationships for a specific table.
 * Returns both outgoing FKs (this table references others) and incoming FKs (others reference this table).
 */
async function getForeignKeys(connection: DatabaseConnection, tableName: string): Promise<string> {
  const pool = getPool(connection)

  // Outgoing: columns in this table that reference other tables
  const [outgoing] = await pool.query(
    `SELECT
       kcu.COLUMN_NAME,
       kcu.REFERENCED_TABLE_NAME,
       kcu.REFERENCED_COLUMN_NAME,
       kcu.CONSTRAINT_NAME
     FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
     WHERE kcu.TABLE_SCHEMA = ?
       AND kcu.TABLE_NAME = ?
       AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
     ORDER BY kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION`,
    [connection.database, tableName],
  )

  // Incoming: columns in other tables that reference this table
  const [incoming] = await pool.query(
    `SELECT
       kcu.TABLE_NAME AS source_table,
       kcu.COLUMN_NAME AS source_column,
       kcu.REFERENCED_COLUMN_NAME,
       kcu.CONSTRAINT_NAME
     FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
     WHERE kcu.TABLE_SCHEMA = ?
       AND kcu.REFERENCED_TABLE_NAME = ?
     ORDER BY kcu.TABLE_NAME, kcu.CONSTRAINT_NAME`,
    [connection.database, tableName],
  )

  let fk = ''

  if ((outgoing as unknown[]).length > 0) {
    fk += '\nForeign Keys (outgoing):\n'
    for (const row of outgoing as Record<string, unknown>[]) {
      fk += `  - ${row.COLUMN_NAME} → ${row.REFERENCED_TABLE_NAME}.${row.REFERENCED_COLUMN_NAME}\n`
    }
  }

  if ((incoming as unknown[]).length > 0) {
    fk += '\nReferenced By (incoming):\n'
    for (const row of incoming as Record<string, unknown>[]) {
      fk += `  - ${row.source_table}.${row.source_column} → ${tableName}.${row.REFERENCED_COLUMN_NAME}\n`
    }
  }

  return fk
}

/**
 * Extract value-to-meaning mappings from column comments.
 * Common patterns in Chinese dev teams:
 *   "状态：0=正常,1=禁用,2=注销"
 *   "类型(1:普通 2:VIP 3:企业)"
 *   "0-未审核 1-已审核 2-已拒绝"
 */
function extractValueMappings(comment: string): string | null {
  // Match patterns like "0=正常", "1:VIP", "0-未审核"
  const mappingPattern = /(\d+)\s*[=:：\-]\s*([^\d,;，；、\s][^,;，；、\d]*)/g
  const mappings: string[] = []
  let match: RegExpExecArray | null
  while ((match = mappingPattern.exec(comment)) !== null) {
    mappings.push(`${match[1]}=${match[2].trim()}`)
  }
  return mappings.length >= 2 ? mappings.join(', ') : null
}

/**
 * Extract ENUM/SET option values from COLUMN_TYPE string.
 * e.g. "enum('active','inactive','pending')" → ['active','inactive','pending']
 */
function parseEnumOptions(columnType: string): string[] | null {
  const match = String(columnType).match(/^(?:enum|set)\(([^)]+)\)$/i)
  if (!match) return null
  return match[1]
    .split(',')
    .map(v => v.trim().replace(/^'|'$/g, ''))
    .filter(v => v.length > 0)
}

export async function getTableSchema(connection: DatabaseConnection, tableName: string, dictCacheOverride?: DictCache): Promise<string> {
  if (!(await tableExists(connection, tableName))) {
    throw new Error(`表 "${tableName}" 不存在于数据库 "${connection.database}" 中`)
  }

  const pool = getPool(connection)

  // Initialize or retrieve dictionary cache for this connection
  let dictCache: DictCache = dictCacheOverride ?? new Map()
  if (!dictCacheOverride) {
    try {
      const tables = await listTables(connection)
      const { cache } = await getOrInitDictCache(pool, connection, tables)
      dictCache = cache
    } catch (err) { console.warn('[database] Dict cache init skipped:', err) }
  }

  const [columns] = await pool.query(
    `SELECT COLUMN_NAME, COLUMN_TYPE, DATA_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, COLUMN_COMMENT, EXTRA
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
     ORDER BY ORDINAL_POSITION`,
    [connection.database, tableName],
  )

  const [indexes] = await pool.query(`SHOW INDEX FROM \`${tableName}\``)

  // Get table row count for context
  const [countResult] = await pool.query(
    `SELECT TABLE_ROWS FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [connection.database, tableName],
  )
  const approxRows = (countResult as Record<string, unknown>[])[0]?.TABLE_ROWS

  let schema = `Table: ${tableName}`
  if (approxRows != null) schema += ` (~${approxRows} rows)`
  schema += '\n\nColumns:\n'

  // Collect columns that behave as enums for distribution queries:
  // 1. MySQL ENUM/SET types (parsed from COLUMN_TYPE)
  // 2. Integer/varchar "status code" columns (detected by naming + type heuristics)
  const enumLikeCols: { name: string; source: 'enum' | 'status_code' }[] = []
  const dateCols: string[] = []

  // Heuristic: column names that commonly encode status codes or categories
  const STATUS_NAME_PATTERNS = /^(status|state|type|level|role|grade|category|kind|mode|phase|flag|is_|has_|can_)/i
  const STATUS_CODE_TYPES = new Set(['tinyint', 'smallint', 'int', 'mediumint', 'bigint'])

  for (const col of columns as Record<string, unknown>[]) {
    const colName = String(col.COLUMN_NAME)
    const colType = String(col.COLUMN_TYPE)
    const dataType = String(col.DATA_TYPE).toLowerCase()
    const comment = col.COLUMN_COMMENT ? String(col.COLUMN_COMMENT) : ''
    const extra = col.EXTRA ? String(col.EXTRA) : ''
    const isPK = col.COLUMN_KEY === 'PRI'
    const isAutoInc = extra.includes('auto_increment')

    schema += `  - ${colName} ${colType}`
    if (isPK) schema += ' [PRIMARY KEY]'
    if (col.COLUMN_KEY === 'UNI') schema += ' [UNIQUE]'
    if (col.IS_NULLABLE === 'NO') schema += ' NOT NULL'
    if (col.COLUMN_DEFAULT !== null) schema += ` DEFAULT ${col.COLUMN_DEFAULT}`
    if (isAutoInc) schema += ' AUTO_INCREMENT'
    if (comment) schema += ` -- ${comment}`

    // 1. MySQL ENUM/SET: parse and display possible values
    const enumVals = parseEnumOptions(colType)
    if (enumVals && enumVals.length > 0) {
      schema += ` [可选值: ${enumVals.join(', ')}]`
      enumLikeCols.push({ name: colName, source: 'enum' })
    }

    // 2. Integer/varchar status code columns: detect by naming conventions
    // Skip primary keys, auto-increment, and foreign key-like columns (*_id)
    if (!enumVals && !isPK && !isAutoInc && !colName.toLowerCase().endsWith('_id')) {
      const isStatusType = STATUS_CODE_TYPES.has(dataType) || dataType === 'varchar'
      const hasStatusName = STATUS_NAME_PATTERNS.test(colName)
      const hasValueMapping = /\d\s*[=:：]\s*\S/.test(comment)

      // Also check if dictionary table has entries for this column
      const dictEntries = dictCache.size > 0 ? lookupDictEntries(dictCache, tableName, colName) : null
      const hasDictMatch = dictEntries && dictEntries.length > 0

      if (isStatusType && (hasStatusName || hasValueMapping || hasDictMatch)) {
        enumLikeCols.push({ name: colName, source: 'status_code' })

        if (hasDictMatch) {
          // Dictionary table is the most authoritative source
          const dictDisplay = dictEntries!.slice(0, 20).map(e => `${e.value}=${e.label}`).join(', ')
          schema += ` [字典值: ${dictDisplay}]`
        } else if (hasValueMapping) {
          const mappings = extractValueMappings(comment)
          if (mappings) {
            schema += ` [值含义: ${mappings}]`
          }
        }
      }
    }

    if (['date', 'datetime', 'timestamp'].includes(dataType)) {
      dateCols.push(colName)
    }

    schema += '\n'
  }

  if ((indexes as unknown[]).length > 0) {
    schema += '\nIndexes:\n'
    const indexMap = new Map<string, string[]>()
    for (const idx of indexes as Record<string, unknown>[]) {
      const name = idx.Key_name as string
      if (!indexMap.has(name)) indexMap.set(name, [])
      indexMap.get(name)!.push(idx.Column_name as string)
    }
    for (const [name, cols] of indexMap) {
      schema += `  - ${name}: (${cols.join(', ')})\n`
    }
  }

  const fkInfo = await getForeignKeys(connection, tableName)
  if (fkInfo) {
    schema += fkInfo
  }

  // Append date range hints for time-based columns
  if (dateCols.length > 0) {
    try {
      const dateHints: string[] = []
      for (const dc of dateCols.slice(0, 3)) {
        const [rangeRows] = await pool.query(
          `SELECT MIN(\`${dc}\`) AS min_val, MAX(\`${dc}\`) AS max_val FROM \`${tableName}\` WHERE \`${dc}\` IS NOT NULL`,
        )
        const range = (rangeRows as Record<string, unknown>[])[0]
        if (range?.min_val && range?.max_val) {
          dateHints.push(`  - ${dc}: ${String(range.min_val).slice(0, 19)} ~ ${String(range.max_val).slice(0, 19)}`)
        }
      }
      if (dateHints.length > 0) {
        schema += '\nDate Ranges:\n' + dateHints.join('\n') + '\n'
      }
    } catch (err) { console.warn('[database] Date range query skipped:', err) }
  }

  // Append value distribution for all enum-like columns (ENUM + status code integers)
  if (enumLikeCols.length > 0) {
    try {
      const distHints: string[] = []
      for (const ec of enumLikeCols.slice(0, 8)) {
        // First check cardinality — skip high-cardinality columns (not truly enum-like)
        const [cardRows] = await pool.query(
          `SELECT COUNT(DISTINCT \`${ec.name}\`) AS card FROM \`${tableName}\` WHERE \`${ec.name}\` IS NOT NULL`,
        )
        const cardinality = Number((cardRows as Record<string, unknown>[])[0]?.card ?? 0)
        if (cardinality > 30 || cardinality === 0) continue

        const [distRows] = await pool.query(
          `SELECT \`${ec.name}\` AS val, COUNT(*) AS cnt FROM \`${tableName}\` WHERE \`${ec.name}\` IS NOT NULL GROUP BY \`${ec.name}\` ORDER BY cnt DESC LIMIT 15`,
        )
        const dist = (distRows as Record<string, unknown>[])
          .map(r => `${r.val}(${r.cnt})`)
          .join(', ')
        if (dist) {
          const label = ec.source === 'status_code' ? `${ec.name} (状态码)` : ec.name
          distHints.push(`  - ${label}: ${dist}`)
        }
      }
      if (distHints.length > 0) {
        schema += '\nValue Distribution:\n' + distHints.join('\n') + '\n'
      }
    } catch (err) { console.warn('[database] Value distribution query skipped:', err) }
  }

  return schema
}

/**
 * Get a comprehensive overview of the entire database.
 * Includes: table names, row counts, table comments, and all foreign key relationships.
 * This is designed to be called once at the beginning of a conversation to give the AI
 * a global understanding of the database structure.
 */
export async function getDatabaseOverview(connection: DatabaseConnection, userQuery?: string, seedTables?: string[]): Promise<string> {
  const pool = getPool(connection)

  // Parallel: fetch tables and FKs simultaneously
  const [tablesResult, fksResult] = await Promise.all([
    pool.query(
      `SELECT TABLE_NAME, TABLE_ROWS, TABLE_COMMENT, AUTO_INCREMENT
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = ?
         AND TABLE_TYPE = 'BASE TABLE'
       ORDER BY TABLE_NAME`,
      [connection.database],
    ),
    pool.query(
      `SELECT
         kcu.TABLE_NAME,
         kcu.COLUMN_NAME,
         kcu.REFERENCED_TABLE_NAME,
         kcu.REFERENCED_COLUMN_NAME
       FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
       WHERE kcu.TABLE_SCHEMA = ?
         AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
       ORDER BY kcu.TABLE_NAME, kcu.CONSTRAINT_NAME`,
      [connection.database],
    ),
  ])

  const tables = tablesResult[0]
  const allFks = fksResult[0]

  if ((tables as unknown[]).length === 0) {
    return `数据库 "${connection.database}" 中没有表。`
  }

  const allTableMetas = (tables as Record<string, unknown>[]).map(t => ({
    name: t.TABLE_NAME as string,
    comment: (t.TABLE_COMMENT as string) ?? '',
    rowCount: t.TABLE_ROWS != null ? Number(t.TABLE_ROWS) : null,
  }))

  const fkEdges = (allFks as Record<string, unknown>[]).map(fk => ({
    from: fk.TABLE_NAME as string,
    to: fk.REFERENCED_TABLE_NAME as string,
  }))

  // Schema Subsetting: for large databases, only show relevant tables
  const { tables: visibleTables, hiddenCount, totalCount } = subsetTables(allTableMetas, userQuery ?? '', fkEdges, seedTables)

  let overview = `数据库: ${connection.database}\n`
  if (hiddenCount > 0) {
    overview += `共 ${totalCount} 张表（基于问题相关性展示 ${visibleTables.length} 张，另有 ${hiddenCount} 张可通过 list_tables 查看完整列表）\n\n`
  } else {
    overview += `共 ${totalCount} 张表\n\n`
  }

  // Table summary (only visible subset)
  overview += '=== 表概览 ===\n'
  const tableNames: string[] = []
  for (const t of visibleTables) {
    tableNames.push(t.name)
    const rows = t.rowCount != null ? `~${t.rowCount} rows` : 'unknown rows'
    const comment = t.comment ? ` -- ${t.comment}` : ''
    overview += `  ${t.name} (${rows})${comment}\n`
  }

  // FK relationships (only those involving visible tables)
  const visibleSet = new Set(visibleTables.map(t => t.name.toLowerCase()))
  const relevantFks = (allFks as Record<string, unknown>[]).filter(fk => {
    const from = (fk.TABLE_NAME as string).toLowerCase()
    const to = (fk.REFERENCED_TABLE_NAME as string).toLowerCase()
    return visibleSet.has(from) || visibleSet.has(to)
  })

  if (relevantFks.length > 0) {
    overview += '\n=== 表关系（外键）===\n'
    for (const fk of relevantFks) {
      overview += `  ${fk.TABLE_NAME}.${fk.COLUMN_NAME} → ${fk.REFERENCED_TABLE_NAME}.${fk.REFERENCED_COLUMN_NAME}\n`
    }
  } else {
    overview += '\n=== 表关系 ===\n  无外键约束。\n'
  }

  // 3 & 4: Parallel — infer join paths + detect dictionary table
  const allTableNames = allTableMetas.map(t => t.name)
  const [inferred, dictResult] = await Promise.all([
    inferJoinPaths(allTableNames, pool, connection.database),
    getOrInitDictCache(pool, connection, allTableNames).catch(() => null),
  ])

  // Only show inferred joins involving visible tables
  const relevantInferred = inferred.filter(j =>
    visibleSet.has(j.fromTable.toLowerCase()) || visibleSet.has(j.toTable.toLowerCase()),
  )
  if (relevantInferred.length > 0) {
    overview += '\n=== 推断的关联关系（基于命名规则）===\n'
    overview += '  以下关联基于字段命名规则推断，生成 JOIN 时可优先参考：\n'
    for (const j of relevantInferred) {
      overview += `  ${j.fromTable}.${j.fromColumn} → ${j.toTable}.${j.toColumn} (${j.confidence})\n`
    }
  }

  // Dictionary table report
  if (dictResult?.tableInfo) {
    const { tableInfo } = dictResult
    overview += `\n=== 字典表 ===\n`
    overview += `  发现字典表: ${tableInfo.tableName}\n`
    overview += `  结构: ${tableInfo.typeColumn}(字典类型), ${tableInfo.valueColumn}(编码值), ${tableInfo.labelColumn}(显示名称)\n`
    overview += `  调用 get_table_schema 时，状态码字段会自动查询字典表获取值含义映射。\n`
  }

  overview += '\n【提示】以上是数据库的全局结构。如需编写 SQL，请对涉及的表调用 get_table_schema 获取详细字段信息。'
  if (hiddenCount > 0) {
    overview += `\n注意：由于表数量较多，以上仅展示与问题可能相关的 ${visibleTables.length} 张表。如果所需的表未在上方列出，请调用 list_tables 查看完整列表，再对具体表调用 get_table_schema。`
  }

  return overview
}

interface InferredJoin {
  fromTable: string
  fromColumn: string
  toTable: string
  toColumn: string
  confidence: 'high' | 'medium'
}

/**
 * Infer likely JOIN paths by matching column naming conventions:
 *   - table_name_id / tableNameId → table_name.id
 *   - xxx_id where "xxxs" or "xxx" is a table name → xxx.id
 */
async function inferJoinPaths(
  tableNames: string[],
  pool: mysql.Pool,
  database: string,
): Promise<InferredJoin[]> {
  const results: InferredJoin[] = []
  const tableSet = new Set(tableNames.map(t => t.toLowerCase()))

  // Build lookup: table name → possible singular/plural forms
  const tableVariants = new Map<string, string>()
  for (const t of tableNames) {
    const lower = t.toLowerCase()
    tableVariants.set(lower, t)
    if (lower.endsWith('s')) tableVariants.set(lower.slice(0, -1), t)
    if (lower.endsWith('es')) tableVariants.set(lower.slice(0, -2), t)
    if (lower.endsWith('ies')) tableVariants.set(lower.slice(0, -3) + 'y', t)
  }

  try {
    // Get all columns ending with _id across the database
    const [idCols] = await pool.query(
      `SELECT TABLE_NAME, COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ?
         AND (COLUMN_NAME LIKE '%\\_id' OR COLUMN_NAME LIKE '%Id')
         AND COLUMN_KEY != 'PRI'
       ORDER BY TABLE_NAME, COLUMN_NAME`,
      [database],
    )

    const seen = new Set<string>()
    for (const row of idCols as Record<string, unknown>[]) {
      const fromTable = String(row.TABLE_NAME)
      const colName = String(row.COLUMN_NAME)

      // Extract the referenced entity name from the column name
      // e.g. "user_id" → "user", "order_item_id" → "order_item", "userId" → "user"
      let refName = ''
      if (colName.endsWith('_id')) {
        refName = colName.slice(0, -3)
      } else if (colName.endsWith('Id') && colName.length > 2) {
        // camelCase: userId → user, orderItemId → order_item
        refName = colName.slice(0, -2).replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '')
      }
      if (!refName || refName === fromTable.toLowerCase()) continue

      // Try to match against known tables
      const targetTable = tableVariants.get(refName)
        ?? tableVariants.get(refName + 's')
        ?? tableVariants.get(refName + 'es')
      if (!targetTable) continue
      if (targetTable.toLowerCase() === fromTable.toLowerCase()) continue

      const key = `${fromTable}.${colName}->${targetTable}`
      if (seen.has(key)) continue
      seen.add(key)

      // Exact name match = high confidence, plural/variant = medium
      const confidence: 'high' | 'medium' = tableSet.has(refName) ? 'high' : 'medium'

      results.push({
        fromTable,
        fromColumn: colName,
        toTable: targetTable,
        toColumn: 'id',
        confidence,
      })
    }
  } catch (err) { console.warn('[database] Join path inference skipped:', err) }

  // Sort: high confidence first
  results.sort((a, b) => (a.confidence === 'high' ? 0 : 1) - (b.confidence === 'high' ? 0 : 1))
  return results.slice(0, 50)
}

/**
 * Run EXPLAIN on a query and return the execution plan summary.
 * Used for pre-execution safety analysis.
 */
export async function explainQuery(connection: DatabaseConnection, sql: string): Promise<string> {
  const validation = validateSql(sql, 'readonly')
  if (!validation.allowed) {
    throw new Error(`EXPLAIN 拒绝执行: ${validation.reason}`)
  }

  const pool = getPool(connection)
  const conn = await pool.getConnection()
  try {
    const [rows] = await conn.query({ sql: `EXPLAIN ${sql}`, timeout: QUERY_TIMEOUT_MS })
    const explainRows = rows as Record<string, unknown>[]

    if (explainRows.length === 0) return 'EXPLAIN 无结果'

    let result = 'EXPLAIN 执行计划:\n'
    for (const row of explainRows) {
      const id = row.id ?? '?'
      const type = row.type ?? '?'  // ALL, index, range, ref, eq_ref, const, system
      const table = row.table ?? '?'
      const possibleKeys = row.possible_keys ?? 'none'
      const key = row.key ?? 'none'
      const rowsEstimate = row.rows ?? '?'
      const extra = row.Extra ?? ''
      result += `  [${id}] ${table}: type=${type}, key=${key}, rows≈${rowsEstimate}, extra=${extra}\n`
    }

    // Warn about full table scans
    const hasFullScan = explainRows.some(r => r.type === 'ALL' && Number(r.rows) > 10000)
    if (hasFullScan) {
      result += '\n⚠️ 检测到全表扫描（type=ALL），查询可能较慢。建议添加合适的 WHERE 条件或索引。'
    }

    return result
  } finally {
    conn.release()
  }
}

export async function closePool(connectionId: string) {
  const pool = pools.get(connectionId)
  if (pool) {
    await pool.end()
    pools.delete(connectionId)
  }
  poolFingerprints.delete(connectionId)
  dictCaches.delete(connectionId)
}

/**
 * Query actual data values for a specific column to drive Smart Filter UI controls.
 * Returns MIN/MAX for date columns, DISTINCT values for ENUM/FK columns, and row count.
 */
/**
 * Validate that a column exists in the given table.
 * Used alongside `tableExists` to prevent SQL injection via column name parameters.
 */
async function columnExists(connection: DatabaseConnection, tableName: string, columnName: string): Promise<boolean> {
  const pool = getPool(connection)
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [connection.database, tableName, columnName],
  )
  return ((rows as Record<string, unknown>[])[0]?.cnt as number) > 0
}

export async function getColumnFilterData(
  connection: DatabaseConnection,
  tableName: string,
  columnName: string,
): Promise<{
  dateMin?: string
  dateMax?: string
  distinctValues?: string[]
  rowCount?: number
}> {
  const pool = getPool(connection)

  // Validate table AND column existence to prevent injection
  if (!(await tableExists(connection, tableName))) {
    throw new Error(`表 "${tableName}" 不存在`)
  }
  if (!(await columnExists(connection, tableName, columnName))) {
    throw new Error(`列 "${columnName}" 不存在于表 "${tableName}" 中`)
  }

  const result: {
    dateMin?: string
    dateMax?: string
    distinctValues?: string[]
    rowCount?: number
  } = {}

  try {
    // Always get row count
    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM \`${tableName}\``,
    )
    result.rowCount = Number((countRows as Record<string, unknown>[])[0]?.cnt ?? 0)

    // Get column data type to determine which queries to run
    const [colInfo] = await pool.query(
      `SELECT DATA_TYPE, COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [connection.database, tableName, columnName],
    )
    const info = (colInfo as Record<string, unknown>[])[0]
    if (!info) return result

    const dataType = (info.DATA_TYPE as string).toLowerCase()
    const columnType = (info.COLUMN_TYPE as string).toLowerCase()
    const isDateType = ['date', 'datetime', 'timestamp'].includes(dataType)
    const isEnumType = columnType.startsWith('enum') || columnType.startsWith('set')

    // MIN/MAX for date-like columns
    if (isDateType) {
      const [rangeRows] = await pool.query(
        `SELECT MIN(\`${columnName}\`) AS min_val, MAX(\`${columnName}\`) AS max_val FROM \`${tableName}\``,
      )
      const range = (rangeRows as Record<string, unknown>[])[0]
      if (range?.min_val) result.dateMin = String(range.min_val)
      if (range?.max_val) result.dateMax = String(range.max_val)
    }

    // DISTINCT values for ENUM/SET columns or columns with low cardinality
    if (isEnumType || !isDateType) {
      const [distinctRows] = await pool.query(
        `SELECT DISTINCT \`${columnName}\` AS val FROM \`${tableName}\`
         WHERE \`${columnName}\` IS NOT NULL
         ORDER BY val LIMIT 100`,
      )
      result.distinctValues = (distinctRows as Record<string, unknown>[])
        .map(r => String(r.val))
        .filter(v => v.length > 0)
    }
  } catch (err) {
    console.warn('[database] Column filter data query failed:', err)
  }

  return result
}
