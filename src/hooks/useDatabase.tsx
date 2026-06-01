import { useState, useCallback, useEffect, createContext, useContext } from 'react'
import type { DatabaseConnection } from '@/lib/types'
import { generateId } from '@/lib/utils'
import { testConnectionFn } from '@/server/functions/connections'
import { encryptPasswordFn } from '@/server/functions/crypto'

type StoredConnection = Omit<DatabaseConnection, 'password'> & { password: string }

type ConnectionStatus = 'idle' | 'testing' | 'success' | 'error'

interface DatabaseState {
  connections: Omit<DatabaseConnection, 'password'>[]
  activeConnectionId: string | null
  activeConnection: Omit<DatabaseConnection, 'password'> | null
  connectionStatus: ConnectionStatus
  connectionError: string | null
  editingConnection: Omit<DatabaseConnection, 'password'> | null
  setActiveConnection: (id: string) => void
  setEditingConnection: (conn: Omit<DatabaseConnection, 'password'> | null) => void
  addConnection: (data: Omit<DatabaseConnection, 'id' | 'createdAt'>) => Promise<void>
  updateConnection: (id: string, data: Omit<DatabaseConnection, 'id' | 'createdAt'>) => Promise<void>
  removeConnection: (id: string) => void
  getFullConnection: (id: string) => DatabaseConnection | null
}

const DatabaseContext = createContext<DatabaseState | null>(null)

const STORAGE_KEY = 'db-connections'

function loadConnections(): StoredConnection[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveConnections(conns: StoredConnection[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(conns))
}

export function DatabaseProvider({ children }: { children: React.ReactNode }) {
  const [connections, setConnections] = useState<Omit<DatabaseConnection, 'password'>[]>([])
  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle')
  const [connectionError, setConnectionError] = useState<string | null>(null)

  useEffect(() => {
    const stored = loadConnections()
    if (stored.length > 0) {
      setConnections(stored.map((c) => ({ ...c, password: '•••' } as Omit<DatabaseConnection, 'password'>)))
    }
  }, [])
  const [editingConnection, setEditingConnection] = useState<Omit<DatabaseConnection, 'password'> | null>(null)

  const activeConnection = connections.find((c) => c.id === activeConnectionId) ?? null

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
      createdAt: new Date().toISOString(),
    }
    const updated = [...loadConnections(), newConn]
    saveConnections(updated)
    setConnections(updated.map((c) => ({ ...c, password: '•••' } as Omit<DatabaseConnection, 'password'>)))
  }, [])

  const updateConnection = useCallback(async (id: string, data: Omit<DatabaseConnection, 'id' | 'createdAt'>) => {
    const existing = loadConnections().find((c) => c.id === id)
    if (!existing) throw new Error('连接不存在')

    let passwordToSave = existing.password

    if (data.password !== '') {
      const { encrypted } = await encryptPasswordFn({ data: { password: data.password } })
      passwordToSave = encrypted

      const testConn: DatabaseConnection = {
        ...existing,
        name: data.name,
        host: data.host,
        port: data.port,
        user: data.user,
        password: data.password,
        database: data.database,
      }
      const testResult = await testConnectionFn({ data: testConn } as any)
      if (!testResult.success) throw new Error(`连接测试失败: ${testResult.error}`)
    }

    const updatedConns = loadConnections().map((c) =>
      c.id === id
        ? { ...c, name: data.name, host: data.host, port: data.port, user: data.user, password: passwordToSave, database: data.database }
        : c
    )
    saveConnections(updatedConns)
    setConnections(updatedConns.map((c) => ({ ...c, password: '•••' } as Omit<DatabaseConnection, 'password'>)))
  }, [])

  const removeConnection = useCallback((id: string) => {
    const updatedConns = loadConnections().filter((c) => c.id !== id)
    saveConnections(updatedConns)
    setConnections(updatedConns.map((c) => ({ ...c, password: '•••' } as Omit<DatabaseConnection, 'password'>)))
    if (activeConnectionId === id) setActiveConnectionId(null)
  }, [activeConnectionId])

  const getFullConnection = useCallback((id: string): DatabaseConnection | null => {
    const stored = loadConnections().find((c) => c.id === id)
    if (!stored) return null
    return { ...stored, password: stored.password }
  }, [])

  const testConnectionById = useCallback(async (id: string) => {
    const fullConn = getFullConnection(id)
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

  const setActiveConnection = useCallback((id: string) => {
    setActiveConnectionId(id)
    setConnectionStatus('testing')
    setConnectionError(null)
    // Use setTimeout to ensure the ID is set before testing
    setTimeout(async () => {
      const result = await testConnectionById(id)
      console.log('result', result)
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