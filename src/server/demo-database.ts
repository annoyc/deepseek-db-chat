import type { DatabaseConnection } from '@/lib/types'
import { DEMO_CONNECTION_ID, isDemoConnectionId } from '@/lib/demo-connection'
import { databaseConnectionOptions } from './database-connection'

const unavailable = () => new Error('内置演示库暂不可用，请联系部署者检查服务端配置')
const normalizeHost = (host: string) => host.trim().toLowerCase().replace(/\.$/, '')

/** Only server environment variables supply credentials for the built-in connection. */
export function getDemoDatabaseConnection(): DatabaseConnection | null {
  if (process.env.DEMO_DB_ENABLED !== 'true') return null
  const host = process.env.DEMO_DB_HOST?.trim()
  const user = process.env.DEMO_DB_USER?.trim()
  const password = process.env.DEMO_DB_PASSWORD
  const database = process.env.DEMO_DB_DATABASE?.trim()
  const port = Number(process.env.DEMO_DB_PORT ?? '3306')
  if (!host || !user || !password || !database || !Number.isInteger(port) || port < 1 || port > 65535
    || host.includes('/') || host.includes('@')) throw unavailable()

  const connection: DatabaseConnection = {
    id: DEMO_CONNECTION_ID,
    name: process.env.DEMO_DB_NAME?.trim() || '电商演示库',
    host, port, user, password, database,
    ssl: {}, env: 'prod', managed: 'demo', readOnly: true,
    createdAt: '1970-01-01T00:00:00.000Z',
  }
  try { databaseConnectionOptions(connection) } catch { throw unavailable() }
  return connection
}

/** Return a reference, never a password, encrypted credential, host, or account. */
export function getPublicDemoConnection(): Omit<DatabaseConnection, 'password'> | null {
  const connection = getDemoDatabaseConnection()
  if (!connection) return null
  return {
    id: DEMO_CONNECTION_ID, name: connection.name, database: connection.database,
    host: '', port: 0, user: '', env: 'prod', managed: 'demo', readOnly: true,
    createdAt: connection.createdAt,
  }
}

/** Enforce the reserved reference again at the final database boundary. */
export function resolveManagedDatabaseConnection(connection: DatabaseConnection): DatabaseConnection {
  if (!isDemoConnectionId(connection?.id)) return connection
  const demo = getDemoDatabaseConnection()
  if (!demo) throw unavailable()
  return demo
}

/** Protect the demo target even when reached through a visitor's own connection ID. */
export function isDemoDatabaseTarget(connection: Pick<DatabaseConnection, 'host' | 'port' | 'database'>): boolean {
  if (process.env.DEMO_DB_ENABLED !== 'true') return false
  const host = process.env.DEMO_DB_HOST?.trim()
  const database = process.env.DEMO_DB_DATABASE?.trim()
  return Boolean(host && database && typeof connection.host === 'string'
    && normalizeHost(connection.host) === normalizeHost(host)
    && Number(connection.port) === Number(process.env.DEMO_DB_PORT ?? '3306')
    && connection.database === database)
}
