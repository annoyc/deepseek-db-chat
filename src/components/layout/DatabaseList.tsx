import { useState } from 'react'
import { Pencil, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useDatabaseStore } from '@/hooks/useDatabase'

export function DatabaseList() {
  const { connections, activeConnectionId, setActiveConnection, removeConnection, setEditingConnection, connectionStatus } = useDatabaseStore()

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const dotColor = activeConnectionId
    ? connectionStatus === 'error'
      ? 'bg-red-500'
      : connectionStatus === 'testing'
        ? 'bg-yellow-500'
        : 'bg-green-500'
    : 'bg-gray-300'

  if (connections.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-gray-400 italic">
        暂无连接
      </div>
    )
  }

  const handleDelete = (id: string) => {
    removeConnection(id)
    setConfirmDeleteId(null)
  }

  return (
    <div className="space-y-0.5 mb-2">
      {connections.map((conn) => (
        <div
          key={conn.id}
          className={cn(
            'group flex items-center gap-2 px-3 py-2 text-xs rounded-lg transition-colors cursor-pointer border border-transparent',
            activeConnectionId === conn.id
              ? 'bg-green-50 text-green-800 border-green-200'
              : 'text-gray-600 hover:bg-gray-100',
          )}
          onClick={() => setActiveConnection(conn.id)}
        >
          <button
            className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer"
          >
            <div className={cn(
              'w-2 h-2 rounded-full flex-shrink-0',
              activeConnectionId === conn.id ? dotColor : 'bg-gray-300'
            )} />
            <span className="truncate font-medium">{conn.name}</span>
          </button>

          <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={(e) => { e.stopPropagation(); setEditingConnection(conn) }}
              className="p-1 hover:bg-gray-200 rounded text-gray-500 hover:text-blue-600 transition-colors"
              title="编辑连接"
            >
              <Pencil className="w-3 h-3" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(conn.id) }}
              className="p-1 hover:bg-gray-200 rounded text-gray-500 hover:text-red-600 transition-colors"
              title="删除连接"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>
      ))}

      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between p-5 pb-2">
              <h2 className="text-lg font-bold text-gray-900">确认删除</h2>
              <button onClick={() => setConfirmDeleteId(null)} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="px-5 pb-5 space-y-4">
              <p className="text-sm text-gray-600">
                删除后该数据库连接将无法恢复，确定要删除吗？
              </p>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={() => setConfirmDeleteId(null)}
                  className="px-6 py-2.5 text-sm font-medium text-gray-700 border border-gray-300 rounded-xl hover:bg-gray-50 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={() => handleDelete(confirmDeleteId)}
                  className="px-6 py-2.5 text-sm font-medium text-white bg-red-600 rounded-xl hover:bg-red-700 transition-colors"
                >
                  删除
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}