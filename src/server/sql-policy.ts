import type { DatabaseConnection } from '@/lib/types'
import type { SqlPermission } from '@/lib/sql-guard'

/** A browser setting or environment label never grants write access on its own. */
export function resolveSqlPermission(
  connection: Pick<DatabaseConnection, 'host' | 'port' | 'database' | 'env'>,
  requested: SqlPermission = 'readonly',
): SqlPermission {
  if (requested !== 'write' || connection.env === 'prod' || process.env.SQL_WRITE_ENABLED !== 'true') return 'readonly'
  const allowedTargets = (process.env.SQL_WRITE_ALLOWLIST ?? '').split(',').map(value => {
    const trimmed = value.trim()
    const slash = trimmed.indexOf('/')
    return slash < 0 ? '' : `${trimmed.slice(0, slash).toLowerCase()}${trimmed.slice(slash)}`
  }).filter(Boolean)
  // MySQL schema names may be case-sensitive; never fold the database name.
  const target = `${connection.host.toLowerCase()}:${connection.port}/${connection.database}`
  return allowedTargets.includes(target) ? 'write' : 'readonly'
}
