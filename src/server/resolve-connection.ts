import type { DatabaseConnection } from '@/lib/types'
import { isDemoConnectionId } from '@/lib/demo-connection'
import { decrypt } from './crypto'
import { resolveManagedDatabaseConnection } from './demo-database'

/** RPC boundary: resolve managed references before looking at any client credentials. */
export function resolveDatabaseConnection(connection: DatabaseConnection): DatabaseConnection {
  if (!connection || typeof connection !== 'object') throw new Error('数据库连接参数无效')
  if (isDemoConnectionId(connection.id)) return resolveManagedDatabaseConnection(connection)
  if (typeof connection.password !== 'string') throw new Error('数据库密码无效，请重新输入')
  const password = decrypt(connection.password)
  if (password === '' && connection.password !== '') throw new Error('密码解密失败，请重新输入数据库密码')
  // Browser-supplied display flags never grant access to the server preset.
  const { managed: _managed, readOnly: _readOnly, ...personalConnection } = connection
  return { ...personalConnection, password }
}
