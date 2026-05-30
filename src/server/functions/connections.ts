import { createServerFn } from '@tanstack/react-start'
import { generateId } from '@/lib/utils'
import { getConnections, addConnection, removeConnection } from '@/server/store'
import { testConnection, closePool } from '@/server/database'
import type { DatabaseConnection } from '@/lib/types'

export const listConnections = createServerFn({ method: 'GET' }).handler(async () => {
  const connections = getConnections()
  return connections.map(({ password, ...rest }) => ({ ...rest, password: '***' }))
})

export const createConnection = createServerFn({ method: 'POST' }).handler(
  async ({ data }: { data: { name: string; host: string; port: number; user: string; password: string; database: string } }) => {
    const conn: DatabaseConnection = {
      id: generateId(),
      name: data.name,
      host: data.host,
      port: data.port,
      user: data.user,
      password: data.password,
      database: data.database,
      createdAt: new Date().toISOString(),
    }

    const testResult = await testConnection(conn)
    if (!testResult.success) {
      throw new Error(`连接测试失败: ${testResult.error}`)
    }

    addConnection(conn)
    return { id: conn.id, name: conn.name }
  }
)

export const deleteConnection = createServerFn({ method: 'POST' }).handler(
  async ({ data }: { data: { id: string } }) => {
    await closePool(data.id)
    removeConnection(data.id)
    return { success: true }
  }
)

export const testDbConnection = createServerFn({ method: 'POST' }).handler(
  async ({ data }: { data: { host: string; port: number; user: string; password: string; database: string } }) => {
    const conn: DatabaseConnection = {
      id: 'test-' + Date.now(),
      name: 'test',
      host: data.host,
      port: data.port,
      user: data.user,
      password: data.password,
      database: data.database,
      createdAt: new Date().toISOString(),
    }
    const result = await testConnection(conn)
    await closePool(conn.id)
    return result
  }
)
