import { createServerFn } from '@tanstack/react-start'
import { getPool } from '@/server/database'
import { decrypt } from '@/server/crypto'
import type { DatabaseConnection } from '@/lib/types'

/**
 * Extract ENUM/SET option values from COLUMN_TYPE string.
 * e.g. 'enum('active','inactive','pending')' → ['active','inactive','pending']
 */
function parseEnumValues(columnType: string): string[] | undefined {
  const match = columnType.match(/^(?:enum|set)\(([^)]+)\)$/i)
  if (!match) return undefined
  return match[1]
    .split(',')
    .map(v => v.trim().replace(/^'|'$/g, ''))
    .filter(v => v.length > 0)
}

/**
 * Determine base data type from COLUMN_TYPE.
 * e.g. 'enum('a','b')' → 'enum', 'timestamp' → 'timestamp', 'int(11)' → 'int'
 */
function parseDataType(columnType: string): string {
  const match = columnType.match(/^([a-z]+)/i)
  return match ? match[1].toLowerCase() : columnType.toLowerCase()
}

/** Date-like data types that should have MIN/MAX queried */
const DATE_TYPES = new Set(['date', 'datetime', 'timestamp'])

/** Column types where DISTINCT values are useful (ENUM, SET, FK columns) */
const DISTINCT_TYPES = new Set(['enum', 'set'])

export interface ColumnFilterData {
  name: string
  type: string
  dataType: string
  enumValues?: string[]
  isPrimary: boolean
  isNullable: boolean
  comment: string
  fkTarget?: string
  // Data-driven fields
  dateMin?: string
  dateMax?: string
  distinctValues?: string[]
  rowCount?: number
}

export interface TableFilterData {
  name: string
  comment: string
  rowCount: number
  columns: ColumnFilterData[]
}

export interface FkRelationData {
  table: string
  column: string
  targetTable: string
  targetColumn: string
}

export interface SchemaFilterData {
  tables: TableFilterData[]
  fkRelations: FkRelationData[]
}

interface GetSchemaMetadataInput {
  connection: DatabaseConnection
}

export const getSchemaMetadata = createServerFn({ method: 'POST' })
  .inputValidator((data: GetSchemaMetadataInput) => data)
  .handler(async ({ data }): Promise<SchemaFilterData> => {
    const decryptedConnection: DatabaseConnection = {
      ...data.connection,
      password: decrypt(data.connection.password),
    }

    const pool = getPool(decryptedConnection)

    // 1. Get all tables with row counts and comments
    const [tableRows] = await pool.query(
      `SELECT TABLE_NAME, TABLE_ROWS, TABLE_COMMENT
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
       ORDER BY TABLE_NAME`,
      [decryptedConnection.database],
    )

    const tables: TableFilterData[] = []

    for (const t of tableRows as Record<string, unknown>[]) {
      const tableName = t.TABLE_NAME as string

      // 2. Get column metadata for each table
      const [colRows] = await pool.query(
        `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, COLUMN_COMMENT, EXTRA
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
         ORDER BY ORDINAL_POSITION`,
        [decryptedConnection.database, tableName],
      )

      const columns: ColumnFilterData[] = []
      for (const c of colRows as Record<string, unknown>[]) {
        const columnType = c.COLUMN_TYPE as string
        const dataType = parseDataType(columnType)
        const enumValues = parseEnumValues(columnType)

        columns.push({
          name: c.COLUMN_NAME as string,
          type: columnType,
          dataType,
          enumValues,
          isPrimary: (c.COLUMN_KEY as string) === 'PRI',
          isNullable: (c.IS_NULLABLE as string) === 'YES',
          comment: c.COLUMN_COMMENT as string,
        })
      }

      tables.push({
        name: tableName,
        comment: t.TABLE_COMMENT as string,
        rowCount: (t.TABLE_ROWS as number) ?? 0,
        columns,
      })
    }

    // 3. Get all foreign key relationships
    const [fkRows] = await pool.query(
      `SELECT
         kcu.TABLE_NAME,
         kcu.COLUMN_NAME,
         kcu.REFERENCED_TABLE_NAME,
         kcu.REFERENCED_COLUMN_NAME
       FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
       WHERE kcu.TABLE_SCHEMA = ?
         AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
       ORDER BY kcu.TABLE_NAME, kcu.CONSTRAINT_NAME`,
      [decryptedConnection.database],
    )

    const fkRelations: FkRelationData[] = []
    for (const f of fkRows as Record<string, unknown>[]) {
      fkRelations.push({
        table: f.TABLE_NAME as string,
        column: f.COLUMN_NAME as string,
        targetTable: f.REFERENCED_TABLE_NAME as string,
        targetColumn: f.REFERENCED_COLUMN_NAME as string,
      })
    }

    // 4. Attach fkTarget to columns that have outgoing FKs
    for (const fk of fkRelations) {
      const table = tables.find(t => t.name === fk.table)
      if (table) {
        const col = table.columns.find(c => c.name === fk.column)
        if (col) {
          col.fkTarget = `${fk.targetTable}.${fk.targetColumn}`
        }
      }
    }

    // 5. Query actual data: MIN/MAX for date fields, DISTINCT for ENUM/FK fields
    for (const table of tables) {
      for (const col of table.columns) {
        try {
          // MIN/MAX for date-like columns
          if (DATE_TYPES.has(col.dataType)) {
            const [rangeRows] = await pool.query(
              `SELECT MIN(\`${col.name}\`) AS min_val, MAX(\`${col.name}\`) AS max_val, COUNT(*) AS cnt FROM \`${table.name}\``,
            )
            const range = (rangeRows as Record<string, unknown>[])[0]
            if (range?.min_val) col.dateMin = String(range.min_val)
            if (range?.max_val) col.dateMax = String(range.max_val)
            if (range?.cnt != null) col.rowCount = Number(range.cnt)
          }

          // DISTINCT values for ENUM columns (and FK columns with small cardinality)
          if (DISTINCT_TYPES.has(col.dataType) || col.fkTarget) {
            const [distinctRows] = await pool.query(
              `SELECT DISTINCT \`${col.name}\` AS val FROM \`${table.name}\` WHERE \`${col.name}\` IS NOT NULL ORDER BY val LIMIT 100`,
            )
            col.distinctValues = (distinctRows as Record<string, unknown>[])
              .map(r => String(r.val))
              .filter(v => v.length > 0)
          }
        } catch (err) {
          console.warn(`[schema-metadata] Column data query failed:`, err)
        }
      }
    }

    return { tables, fkRelations }
  })
