import { useState } from 'react'
import { Pencil, Trash2, X, Server } from 'lucide-react'
import { cn, envConfig, getDbTypeFromConnection } from '@/lib/utils'
import { useDatabaseStore } from '@/hooks/useDatabase'
import type { DbEnv } from '@/lib/types'

export function DatabaseList() {
  const { connections, activeConnectionId, setActiveConnection, removeConnection, setEditingConnection, connectionStatus } = useDatabaseStore()

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const dotColor = activeConnectionId
    ? connectionStatus === 'error'
      ? 'bg-red-500'
      : connectionStatus === 'testing'
        ? 'bg-yellow-500 animate-pulse-dot'
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
      {connections.map((conn) => {
        const isActive = activeConnectionId === conn.id
        const env: DbEnv = conn.env || 'dev'
        const envInfo = envConfig[env]
        const dbType = getDbTypeFromConnection(conn)
        const hostInfo = `${dbType} · ${conn.host}`

        return (
          <div
            key={conn.id}
            className={cn(
              'group flex items-center gap-2 px-3 py-2 text-xs rounded-lg transition-colors cursor-pointer border',
              isActive
                ? 'bg-green-50 text-green-800 border-green-200/80'
                : 'text-gray-600 hover:bg-gray-100/80 border-transparent',
            )}
            onClick={() => setActiveConnection(conn.id)}
          >
            {/* Status dot + icon */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <div className={cn(
                'w-2 h-2 rounded-full',
                isActive ? dotColor : 'bg-gray-300'
              )} />
            </div>

            {/* Name + meta */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate font-medium">{conn.name}</span>
                {envInfo.label && (
                  <span className={cn(
                    'inline-flex px-1 py-0 text-[10px] leading-[13px] rounded border font-medium flex-shrink-0',
                    envInfo.color, envInfo.bg
                  )}>
                    {envInfo.label}
                  </span>
                )}
              </div>
              <div className="text-[10px] text-gray-400 mt-0.5 truncate">
                {hostInfo}
              </div>
            </div>

            {/* Actions on hover */}
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
        )
      })}

      {/* Delete confirmation dialog */}
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