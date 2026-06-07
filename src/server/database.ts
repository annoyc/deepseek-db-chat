import mysql from 'mysql2/promise'
import type { DatabaseConnection, SqlResultInfo } from '@/lib/types'
import { MAX_POOL_SIZE, QUERY_TIMEOUT_MS, MAX_RESULT_ROWS } from '@/lib/constants'

const pools = new Map<string, mysql.Pool>()

export function getPool(connection: DatabaseConnection): mysql.Pool {
  if (pools.has(connection.id)) {
    return pools.get(connection.id)!
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
  return pool
}

export async function testConnection(connection: DatabaseConnection): Promise<{ success: boolean; error?: string }> {
  try {
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

export async function getTableSchema(connection: DatabaseConnection, tableName: string): Promise<string> {
  // Validate table name to prevent injection
  if (!(await tableExists(connection, tableName))) {
    throw new Error(`表 "${tableName}" 不存在于数据库 "${connection.database}" 中`)
  }

  const pool = getPool(connection)

  const [columns] = await pool.query(
    `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, COLUMN_COMMENT, EXTRA
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
     ORDER BY ORDINAL_POSITION`,
    [connection.database, tableName],
  )

  const [indexes] = await pool.query(`SHOW INDEX FROM \`${tableName}\``)

  let schema = `Table: ${tableName}\n\nColumns:\n`
  for (const col of columns as Record<string, unknown>[]) {
    schema += `  - ${col.COLUMN_NAME} ${col.COLUMN_TYPE}`
    if (col.COLUMN_KEY === 'PRI') schema += ' [PRIMARY KEY]'
    if (col.COLUMN_KEY === 'UNI') schema += ' [UNIQUE]'
    if (col.IS_NULLABLE === 'NO') schema += ' NOT NULL'
    if (col.COLUMN_DEFAULT !== null) schema += ` DEFAULT ${col.COLUMN_DEFAULT}`
    if (col.EXTRA && String(col.EXTRA).includes('auto_increment')) schema += ' AUTO_INCREMENT'
    if (col.COLUMN_COMMENT) schema += ` -- ${col.COLUMN_COMMENT}`
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

  // Append foreign key information (critical for JOIN queries)
  const fkInfo = await getForeignKeys(connection, tableName)
  if (fkInfo) {
    schema += fkInfo
  }

  return schema
}

/**
 * Get a comprehensive overview of the entire database.
 * Includes: table names, row counts, table comments, and all foreign key relationships.
 * This is designed to be called once at the beginning of a conversation to give the AI
 * a global understanding of the database structure.
 */
export async function getDatabaseOverview(connection: DatabaseConnection): Promise<string> {
  const pool = getPool(connection)

  // 1. Get table list with row estimates and comments
  const [tables] = await pool.query(
    `SELECT TABLE_NAME, TABLE_ROWS, TABLE_COMMENT, AUTO_INCREMENT
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = ?
       AND TABLE_TYPE = 'BASE TABLE'
     ORDER BY TABLE_NAME`,
    [connection.database],
  )

  if ((tables as unknown[]).length === 0) {
    return `数据库 "${connection.database}" 中没有表。`
  }

  let overview = `数据库: ${connection.database}\n`
  overview += `共 ${(tables as unknown[]).length} 张表\n\n`

  // Table summary
  overview += '=== 表概览 ===\n'
  const tableNames: string[] = []
  for (const t of tables as Record<string, unknown>[]) {
    const name = t.TABLE_NAME as string
    tableNames.push(name)
    const rows = t.TABLE_ROWS != null ? `~${t.TABLE_ROWS} rows` : 'unknown rows'
    const comment = t.TABLE_COMMENT ? ` -- ${t.TABLE_COMMENT}` : ''
    overview += `  ${name} (${rows})${comment}\n`
  }

  // 2. Get ALL foreign key relationships in the database
  const [allFks] = await pool.query(
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
  )

  if ((allFks as unknown[]).length > 0) {
    overview += '\n=== 表关系（外键）===\n'
    for (const fk of allFks as Record<string, unknown>[]) {
      overview += `  ${fk.TABLE_NAME}.${fk.COLUMN_NAME} → ${fk.REFERENCED_TABLE_NAME}.${fk.REFERENCED_COLUMN_NAME}\n`
    }
  } else {
    overview += '\n=== 表关系 ===\n  无外键关系（连表查询请通过字段名推断关联关系）\n'
  }

  // 3. Hint for AI
  overview += '\n【提示】以上是数据库的全局结构。如需编写 SQL，请对涉及的表调用 get_table_schema 获取详细字段信息。'

  return overview
}

/**
 * Run EXPLAIN on a query and return the execution plan summary.
 * Used for pre-execution safety analysis.
 */
export async function explainQuery(connection: DatabaseConnection, sql: string): Promise<string> {
  const pool = getPool(connection)
  const conn = await pool.getConnection()
  try {
    const [rows] = await conn.query(`EXPLAIN ${sql}`)
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
}
