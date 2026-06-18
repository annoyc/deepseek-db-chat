import { useState, useCallback, useEffect, useRef, createContext, useContext } from 'react'
import type { DatabaseConnection } from '@/lib/types'
import { generateId } from '@/lib/utils'
import { testConnectionFn, closePoolFn } from '@/server/functions/connections'
import { encryptPasswordFn, validatePasswordFn } from '@/server/functions/crypto'
import { db } from '@/lib/db'

type StoredConnection = Omit<DatabaseConnection, 'password'> & { password: string }

type ConnectionStatus = 'idle' | 'testing' | 'success' | 'error'

interface DatabaseState {
  connections: Omit<DatabaseConnection, 'password'>[]
  activeConnectionId: string | null
  activeConnection: Omit<DatabaseConnection, 'password'> | null
  connectionStatus: ConnectionStatus
  connectionError: string | null
  editingConnection: Omit<DatabaseConnection, 'password'> | null
  setActiveConnection: (id: string | null) => void
  setEditingConnection: (conn: Omit<DatabaseConnection, 'password'> | null) => void
  addConnection: (data: Omit<DatabaseConnection, 'id' | 'createdAt'>) => Promise<void>
  updateConnection: (id: string, data: Omit<DatabaseConnection, 'id' | 'createdAt'>) => Promise<void>
  removeConnection: (id: string) => void
  getFullConnection: (id: string) => DatabaseConnection | null
}

const DatabaseContext = createContext<DatabaseState | null>(null)

export function DatabaseProvider({ children }: { children: React.ReactNode }) {
  const [connections, setConnections] = useState<Omit<DatabaseConnection, 'password'>[]>([])
  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle')
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const storedRef = useRef<StoredConnection[]>([])

  useEffect(() => {
    (async () => {
      let stored = await db.dbConnections.toArray()

      // IndexedDB 为空时尝试从旧版 localStorage 迁移残留数据
      if (stored.length === 0) {
        try {
          const raw = window.localStorage.getItem('db-connections')
          if (raw) {
            const restored: StoredConnection[] = JSON.parse(raw)
            if (Array.isArray(restored) && restored.length > 0) {
              await db.dbConnections.bulkPut(restored)
              stored = restored
            }
          }
        } catch (err) { console.warn('[useDatabase] localStorage migration failed:', err) }
      }
      if (stored.length === 0) return

      const validConns: StoredConnection[] = []
      for (const conn of stored) {
        const { valid } = await validatePasswordFn({ data: { encrypted: conn.password } })
        if (valid) validConns.push(conn)
      }
      if (validConns.length !== stored.length) {
        await db.transaction('rw', db.dbConnections, async () => {
          await db.dbConnections.clear()
          if (validConns.length > 0) {
            await db.dbConnections.bulkPut(validConns)
          }
        })
      }
      storedRef.current = validConns
      setConnections(validConns.map((c) => ({ ...c, password: '•••' } as Omit<DatabaseConnection, 'password'>)))
    })()
  }, [])

  const [editingConnection, setEditingConnection] = useState<Omit<DatabaseConnection, 'password'> | null>(null)

  const activeConnection = connections.find((c) => c.id === activeConnectionId) ?? null

  const syncToDb = useCallback(async (conns: StoredConnection[]) => {
    storedRef.current = conns
    await db.transaction('rw', db.dbConnections, async () => {
      await db.dbConnections.clear()
      if (conns.length > 0) {
        await db.dbConnections.bulkPut(conns)
      }
    })
    setConnections(conns.map((c) => ({ ...c, password: '•••' } as Omit<DatabaseConnection, 'password'>)))
  }, [])

  const addConnection = useCallback(async (data: Omit<DatabaseConnection, 'id' | 'createdAt'>) => {
    const testResult = await testConnectionFn({ data } as any)
    if (!testResult.success) throw new Error(`连接测试失败: ${testResult.error}`)

    const { encrypted } = await encryptPasswordFn({ data: { password: data.password } })
    console.log('encrypted', encrypted)

    const newConn: StoredConnection = {
      id: generateId(),
      name: data.name,
      host: data.host,
      port: data.port,
      user: data.user,
      password: encrypted,
      database: data.database,
      env: data.env ?? 'unknown',
      createdAt: new Date().toISOString(),
    }
    await syncToDb([...storedRef.current, newConn])
  }, [syncToDb])

  const updateConnection = useCallback(async (id: string, data: Omit<DatabaseConnection, 'id' | 'createdAt'>) => {
    const existing = storedRef.current.find((c) => c.id === id)
    if (!existing) throw new Error('连接不存在')

    let passwordToSave = existing.password
    let testPassword: string

    if (data.password !== '') {
      const { encrypted } = await encryptPasswordFn({ data: { password: data.password } })
      passwordToSave = encrypted
      testPassword = data.password
    } else {
      testPassword = existing.password
    }

    const testConn: DatabaseConnection = {
      id: existing.id,
      name: data.name,
      host: data.host,
      port: data.port,
      user: data.user,
      password: testPassword,
      database: data.database,
      env: data.env ?? existing.env ?? 'unknown',
      createdAt: existing.createdAt,
    }
    const testResult = await testConnectionFn({ data: testConn } as any)
    if (!testResult.success) throw new Error(`连接测试失败: ${testResult.error}`)

    const updatedConns = storedRef.current.map((c) =>
      c.id === id
        ? { ...c, name: data.name, host: data.host, port: data.port, user: data.user, password: passwordToSave, database: data.database, env: data.env ?? existing.env ?? 'unknown' }
        : c
    )
    await syncToDb(updatedConns)
  }, [syncToDb])

  const removeConnection = useCallback((id: string) => {
    const updatedConns = storedRef.current.filter((c) => c.id !== id)
    syncToDb(updatedConns)
    closePoolFn({ data: { connectionId: id } }).catch((err) => console.warn('[useDatabase] closePool failed:', err))
    if (activeConnectionId === id) setActiveConnectionId(null)
  }, [activeConnectionId, syncToDb])

  const getFullConnection = useCallback((id: string): DatabaseConnection | null => {
    const stored = storedRef.current.find((c) => c.id === id)
    if (!stored) return null
    return { ...stored, password: stored.password }
  }, [])

  const testConnectionById = useCallback(async (id: string) => {
    let fullConn = getFullConnection(id)
    if (!fullConn) {
      // storedRef 可能尚未从 IndexedDB 加载完成，直接从 DB 回退读取
      const stored = await db.dbConnections.get(id)
      if (stored) fullConn = { ...stored }
    }
    if (!fullConn) {
      return { success: false, error: '连接不存在' }
    }
    try {
      const result = await testConnectionFn({ data: fullConn } as any)
      return result
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : '连接失败' }
    }
  }, [getFullConnection])

  const setActiveConnection = useCallback((id: string | null) => {
    setActiveConnectionId(id)
    if (id === null) {
      setConnectionStatus('idle')
      setConnectionError(null)
      return
    }
    setConnectionStatus('testing')
    setConnectionError(null)
    setTimeout(async () => {
      const result = await testConnectionById(id)
      if (result.success) {
        setConnectionStatus('success')
        setConnectionError(null)
      } else {
        setConnectionStatus('error')
        setConnectionError(result.error || '连接失败')
      }
    }, 0)
  }, [setActiveConnectionId, testConnectionById])

  const value: DatabaseState = {
    connections,
    activeConnectionId,
    activeConnection,
    connectionStatus,
    connectionError,
    editingConnection,
    setActiveConnection,
    setEditingConnection,
    addConnection,
    updateConnection,
    removeConnection,
    getFullConnection,
  }

  return <DatabaseContext.Provider value={value}>{children}</DatabaseContext.Provider>
}

export function useDatabaseStore(): DatabaseState {
  const ctx = useContext(DatabaseContext)
  if (!ctx) throw new Error('useDatabaseStore must be used within DatabaseProvider')
  return ctx
}
