import { useState, useCallback, useEffect, createContext, useContext } from 'react'
import type { DatabaseConnection } from '@/lib/types'
import { listConnections, createConnection, deleteConnection } from '@/server/functions/connections'

interface DatabaseState {
  connections: Omit<DatabaseConnection, 'password'>[]
  activeConnectionId: string | null
  activeConnection: Omit<DatabaseConnection, 'password'> | null
  setActiveConnection: (id: string) => void
  addConnection: (data: Omit<DatabaseConnection, 'id' | 'createdAt'>) => Promise<void>
  removeConnection: (id: string) => Promise<void>
  refreshConnections: () => Promise<void>
}

const DatabaseContext = createContext<DatabaseState | null>(null)

export function DatabaseProvider({ children }: { children: React.ReactNode }) {
  const [connections, setConnections] = useState<Omit<DatabaseConnection, 'password'>[]>([])
  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(null)

  const refreshConnections = useCallback(async () => {
    try {
      const data = await listConnections()
      setConnections(data as Omit<DatabaseConnection, 'password'>[])
      if (data.length > 0 && !activeConnectionId) {
        setActiveConnectionId(data[0].id)
      }
    } catch (err) {
      console.error('Failed to fetch connections:', err)
    }
  }, [activeConnectionId])

  useEffect(() => {
    refreshConnections()
  }, [])

  const activeConnection = connections.find((c) => c.id === activeConnectionId) ?? null

  const handleAddConnection = useCallback(async (data: Omit<DatabaseConnection, 'id' | 'createdAt'>) => {
    await createConnection({ data } as any)
    await refreshConnections()
  }, [refreshConnections])

  const handleRemoveConnection = useCallback(async (id: string) => {
    await deleteConnection({ data: { id } })
    if (activeConnectionId === id) {
      setActiveConnectionId(connections.find((c) => c.id !== id)?.id ?? null)
    }
    await refreshConnections()
  }, [activeConnectionId, connections, refreshConnections])

  const value: DatabaseState = {
    connections,
    activeConnectionId,
    activeConnection,
    setActiveConnection: setActiveConnectionId,
    addConnection: handleAddConnection,
    removeConnection: handleRemoveConnection,
    refreshConnections,
  }

  return (
    <DatabaseContext.Provider value={value}>
      {children}
    </DatabaseContext.Provider>
  )
}

export function useDatabaseStore(): DatabaseState {
  const ctx = useContext(DatabaseContext)
  if (!ctx) throw new Error('useDatabaseStore must be used within DatabaseProvider')
  return ctx
}
