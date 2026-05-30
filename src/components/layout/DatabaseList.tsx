import { cn } from '@/lib/utils'
import { useDatabaseStore } from '@/hooks/useDatabase'

export function DatabaseList() {
  const { connections, activeConnectionId, setActiveConnection } = useDatabaseStore()

  if (connections.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-gray-400 italic">
        暂无连接
      </div>
    )
  }

  return (
    <div className="space-y-0.5">
      {connections.map((conn) => (
        <button
          key={conn.id}
          onClick={() => setActiveConnection(conn.id)}
          className={cn(
            'w-full flex items-center gap-2 px-3 py-2 text-xs rounded-lg transition-colors',
            activeConnectionId === conn.id
              ? 'bg-green-50 text-green-800 border border-green-200'
              : 'text-gray-600 hover:bg-gray-100',
          )}
        >
          <div className={cn(
            'w-2 h-2 rounded-full flex-shrink-0',
            activeConnectionId === conn.id ? 'bg-green-500' : 'bg-gray-300'
          )} />
          <span className="truncate font-medium">{conn.name}</span>
        </button>
      ))}
    </div>
  )
}
