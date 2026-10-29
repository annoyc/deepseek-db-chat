import { useState, useCallback, useEffect, useRef, createContext, useContext } from 'react'
import type { DatabaseConnection } from '@/lib/types'
import { isDemoConnectionId } from '@/lib/demo-connection'
import { generateId } from '@/lib/utils'
import { getDemoConnectionFn, testConnectionFn, closePoolFn } from '@/server/functions/connections'
import { encryptPasswordFn } from '@/server/functions/crypto'
import { db } from '@/lib/db'

type StoredConnection = DatabaseConnection
type PublicConnection = Omit<DatabaseConnection, 'password'>
type ConnectionStatus = 'idle' | 'testing' | 'success' | 'error'

function publicConnection(connection: StoredConnection): PublicConnection {
  const { password: _password, ...metadata } = connection
  return metadata
}

interface DatabaseState {
  connections: PublicConnection[]
  connectionsLoaded: boolean
  connectionsLoadError: string | null
  activeConnectionId: string | null
  activeConnection: PublicConnection | null
  connectionStatus: ConnectionStatus
  connectionError: string | null
  editingConnection: PublicConnection | null
  setActiveConnection: (id: string | null) => void
  setEditingConnection: (conn: PublicConnection | null) => void
  addConnection: (data: Omit<DatabaseConnection, 'id' | 'createdAt'>) => Promise<void>
  updateConnection: (id: string, data: Omit<DatabaseConnection, 'id' | 'createdAt'>) => Promise<void>
  removeConnection: (id: string) => void
  getFullConnection: (id: string) => DatabaseConnection | null
}

const DatabaseContext = createContext<DatabaseState | null>(null)

export function DatabaseProvider({ children }: { children: React.ReactNode }) {
  const [connections, setConnections] = useState<PublicConnection[]>([])
  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle')
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [connectionsLoaded, setConnectionsLoaded] = useState(false)
  const [connectionsLoadError, setConnectionsLoadError] = useState<string | null>(null)
  const [editingConnection, setEditingConnectionState] = useState<PublicConnection | null>(null)
  const [probeRevision, setProbeRevision] = useState(0)
  const storedRef = useRef<StoredConnection[]>([])
  const demoRef = useRef<PublicConnection | null>(null)
  const initializationRef = useRef<Promise<void> | null>(null)
  const selectionMadeRef = useRef(false)
  const activeIdRef = useRef<string | null>(null)
  const probeGenerationRef = useRef(0)
  const probeAbortRef = useRef<AbortController | null>(null)

  const publishConnections = useCallback(() => {
    setConnections([
      ...(demoRef.current ? [demoRef.current] : []),
      ...storedRef.current.filter(connection => !isDemoConnectionId(connection.id)).map(publicConnection),
    ])
  }, [])

  useEffect(() => {
    let cancelled = false
    const demoAbort = new AbortController()
    const demoDeadline = setTimeout(() => demoAbort.abort(), 10_000)
    const errors: string[] = []

    const loadPersonalConnections = async (): Promise<StoredConnection[]> => {
      try {
        let stored = (await db.dbConnections.toArray()).filter(connection => !isDemoConnectionId(connection.id))
        if (stored.length === 0) {
          try {
            const raw = window.localStorage.getItem('db-connections')
            const restored = raw ? JSON.parse(raw) : null
            if (Array.isArray(restored)) {
              stored = restored.filter((connection): connection is StoredConnection => (
                connection && typeof connection.id === 'string' && !isDemoConnectionId(connection.id)
              ))
              if (stored.length > 0 && !cancelled) await db.dbConnections.bulkPut(stored)
            }
          } catch {
            errors.push('旧版本地连接读取失败，原有数据已保留。')
          }
        }
        // Connection tests validate credentials when selected. A failed RPC or
        // rotated encryption key must not delete someone's saved connection.
        return stored
      } catch {
        errors.push('本地连接读取失败，请刷新页面重试，原有数据已保留。')
        return []
      }
    }

    const loadDemoConnection = async (): Promise<PublicConnection | null> => {
      try {
        return await getDemoConnectionFn({ signal: demoAbort.signal })
      } catch {
        if (!cancelled) errors.push('演示库暂时无法加载，请稍后刷新重试。')
        return null
      } finally {
        clearTimeout(demoDeadline)
      }
    }

    initializationRef.current = Promise.all([loadPersonalConnections(), loadDemoConnection()]).then(([stored, demo]) => {
      if (cancelled) return
      storedRef.current = stored
      demoRef.current = demo
      publishConnections()
      setConnectionsLoadError(errors.length ? errors.join(' ') : null)
      setConnectionsLoaded(true)
      if (demo && !selectionMadeRef.current && activeIdRef.current === null) {
        activeIdRef.current = demo.id
        setActiveConnectionId(demo.id)
      }
    })

    return () => {
      cancelled = true
      clearTimeout(demoDeadline)
      demoAbort.abort()
    }
  }, [publishConnections])

  const getFullConnection = useCallback((id: string): DatabaseConnection | null => {
    if (isDemoConnectionId(id)) {
      // The browser carries only a public reference. The server supplies all
      // connection credentials afresh for this reserved id on every request.
      return demoRef.current ? { ...demoRef.current, password: '' } : null
    }
    const stored = storedRef.current.find(connection => connection.id === id)
    return stored ? { ...stored } : null
  }, [])

  const setActiveConnection = useCallback((id: string | null) => {
    if (id !== null && !getFullConnection(id)) return
    selectionMadeRef.current = true
    ++probeGenerationRef.current
    probeAbortRef.current?.abort()
    activeIdRef.current = id
    setActiveConnectionId(id)
    setConnectionStatus(id === null ? 'idle' : 'testing')
    setConnectionError(null)
    // Clicking an already-selected connection also retries a failed test.
    setProbeRevision(revision => revision + 1)
  }, [getFullConnection])

  useEffect(() => {
    if (!connectionsLoaded) return
    const generation = ++probeGenerationRef.current
    probeAbortRef.current?.abort()
    const controller = new AbortController()
    probeAbortRef.current = controller
    if (activeConnectionId === null) {
      setConnectionStatus('idle')
      setConnectionError(null)
      return
    }
    const connection = getFullConnection(activeConnectionId)
    if (!connection) {
      setConnectionStatus('error')
      setConnectionError('连接不存在，请重新选择数据库连接。')
      return
    }
    setConnectionStatus('testing')
    setConnectionError(null)
    testConnectionFn({ data: connection, signal: controller.signal }).then(result => {
      if (controller.signal.aborted || generation !== probeGenerationRef.current || activeIdRef.current !== connection.id) return
      setConnectionStatus(result.success ? 'success' : 'error')
      setConnectionError(result.success ? null : result.error || '连接失败')
    }).catch(() => {
      if (controller.signal.aborted || generation !== probeGenerationRef.current || activeIdRef.current !== connection.id) return
      setConnectionStatus('error')
      setConnectionError('无法连接应用服务器，请检查网络后重新选择该连接。')
    })
    return () => controller.abort()
  }, [activeConnectionId, connectionsLoaded, getFullConnection, probeRevision])

  const setEditingConnection = useCallback((connection: PublicConnection | null) => {
    if (connection && isDemoConnectionId(connection.id)) return
    setEditingConnectionState(connection)
  }, [])

  const addConnection = useCallback(async (data: Omit<DatabaseConnection, 'id' | 'createdAt'>) => {
    await initializationRef.current
    const testResult = await testConnectionFn({ data } as any)
    if (!testResult.success) throw new Error(`连接测试失败: ${testResult.error}`)
    const { encrypted } = await encryptPasswordFn({ data: { password: data.password } })
    const newConnection: StoredConnection = {
      id: generateId(), name: data.name, host: data.host, port: data.port,
      user: data.user, password: encrypted, database: data.database, ssl: data.ssl,
      env: data.env, createdAt: new Date().toISOString(),
    }
    await db.dbConnections.add(newConnection)
    storedRef.current = [...storedRef.current, newConnection]
    publishConnections()
  }, [publishConnections])

  const updateConnection = useCallback(async (id: string, data: Omit<DatabaseConnection, 'id' | 'createdAt'>) => {
    if (isDemoConnectionId(id)) throw new Error('内置演示库由服务端管理，无法编辑。')
    await initializationRef.current
    const existing = storedRef.current.find(connection => connection.id === id)
    if (!existing) throw new Error('连接不存在')
    let passwordToSave = existing.password
    let testPassword = existing.password
    if (data.password !== '') {
      const { encrypted } = await encryptPasswordFn({ data: { password: data.password } })
      passwordToSave = encrypted
      testPassword = data.password
    }
    const testConnectionData: DatabaseConnection = {
      id, name: data.name, host: data.host, port: data.port, user: data.user,
      password: testPassword, database: data.database, ssl: data.ssl,
      env: data.env ?? existing.env, createdAt: existing.createdAt,
    }
    const result = await testConnectionFn({ data: testConnectionData })
    if (!result.success) throw new Error(`连接测试失败: ${result.error}`)
    const updated = { ...testConnectionData, password: passwordToSave }
    await db.dbConnections.put(updated)
    storedRef.current = storedRef.current.map(connection => connection.id === id ? updated : connection)
    publishConnections()
    if (activeIdRef.current === id) {
      ++probeGenerationRef.current
      probeAbortRef.current?.abort()
      setConnectionStatus('success')
      setConnectionError(null)
    }
  }, [publishConnections])

  const removeConnection = useCallback((id: string) => {
    if (isDemoConnectionId(id)) return
    void (async () => {
      await initializationRef.current
      await db.dbConnections.delete(id)
      storedRef.current = storedRef.current.filter(connection => connection.id !== id)
      publishConnections()
      closePoolFn({ data: { connectionId: id } }).catch(() => {})
      if (activeIdRef.current === id) {
        ++probeGenerationRef.current
        probeAbortRef.current?.abort()
        activeIdRef.current = demoRef.current?.id ?? null
        setActiveConnectionId(activeIdRef.current)
      }
    })().catch(() => {
      setConnectionsLoadError('本地连接删除失败，请刷新页面后重试。')
    })
  }, [publishConnections])

  const activeConnection = connections.find(connection => connection.id === activeConnectionId) ?? null
  const value: DatabaseState = {
    connections, connectionsLoaded, connectionsLoadError, activeConnectionId, activeConnection,
    connectionStatus, connectionError, editingConnection, setActiveConnection, setEditingConnection,
    addConnection, updateConnection, removeConnection, getFullConnection,
  }
  return <DatabaseContext.Provider value={value}>{children}</DatabaseContext.Provider>
}

export function useDatabaseStore(): DatabaseState {
  const context = useContext(DatabaseContext)
  if (!context) throw new Error('useDatabaseStore must be used within DatabaseProvider')
  return context
}
