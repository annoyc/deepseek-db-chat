import mysql from 'mysql2/promise'
import type { DatabaseConnection, SqlResultInfo } from '@/lib/types'
import { MAX_POOL_SIZE, QUERY_TIMEOUT_MS } from '@/lib/constants'

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
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function executeQuery(connection: DatabaseConnection, sql: string): Promise<SqlResultInfo> {
  const pool = getPool(connection)
  const start = Date.now()

  const conn = await pool.getConnection()
  try {
    const [rows, fields] = await conn.query({
      sql,
      timeout: QUERY_TIMEOUT_MS,
    })

    const executionTime = Date.now() - start

    if (Array.isArray(rows)) {
      const columns = fields ? (fields as mysql.FieldPacket[]).map((f) => f.name) : []
      const data = JSON.parse(JSON.stringify(rows, (_key, value) =>
        typeof value === 'bigint' ? Number(value) : value
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

export async function getTableSchema(connection: DatabaseConnection, tableName: string): Promise<string> {
  const pool = getPool(connection)

  const [columns] = await pool.query(
    `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, COLUMN_COMMENT
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
     ORDER BY ORDINAL_POSITION`,
    [connection.database, tableName]
  )

  const [indexes] = await pool.query(`SHOW INDEX FROM \`${tableName}\``)

  let schema = `Table: ${tableName}\n\nColumns:\n`
  for (const col of columns as Record<string, unknown>[]) {
    schema += `  - ${col.COLUMN_NAME} ${col.COLUMN_TYPE}`
    if (col.COLUMN_KEY === 'PRI') schema += ' [PRIMARY KEY]'
    if (col.COLUMN_KEY === 'UNI') schema += ' [UNIQUE]'
    if (col.IS_NULLABLE === 'NO') schema += ' NOT NULL'
    if (col.COLUMN_DEFAULT !== null) schema += ` DEFAULT ${col.COLUMN_DEFAULT}`
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

  return schema
}

export async function closePool(connectionId: string) {
  const pool = pools.get(connectionId)
  if (pool) {
    await pool.end()
    pools.delete(connectionId)
  }
}
