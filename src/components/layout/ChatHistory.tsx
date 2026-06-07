import { useState, useRef } from 'react'
import { MessageSquare, Trash2, X, Search, PencilLine, Check } from 'lucide-react'
import { cn, getRelativeTime, getTimeGroup, timeGroupLabels, timeGroupOrder, envConfig, type TimeGroup } from '@/lib/utils'
import { useChatStore } from '@/hooks/useChat'
import { useDatabaseStore } from '@/hooks/useDatabase'
import type { DbEnv } from '@/lib/types'

export function ChatHistory() {
  const { sessions, activeSessionId, setActiveSession, deleteSession, renameSession } = useChatStore()
  const { connections } = useDatabaseStore()
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)

  // Helper: get connection info by id
  const getConnectionInfo = (connectionId: string) => {
    const conn = connections.find(c => c.id === connectionId)
    return conn ? { name: conn.name, env: conn.env || 'dev' } : { name: '', env: 'dev' }
  }

  // Filter out empty sessions (title === '新对话' with no messages) unless they're the active one
  const visibleSessions = sessions.filter(s => {
    if (s.title === '新对话' && s.messages.length === 0 && s.id !== activeSessionId) return false
    return true
  })

  // Apply search filter
  const filtered = searchQuery.trim()
    ? visibleSessions.filter(s => s.title.toLowerCase().includes(searchQuery.toLowerCase()))
    : visibleSessions

  // Sort by updatedAt descending
  const sorted = [...filtered].sort((a, b) =>
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  )

  // Group by time
  const groups: Partial<Record<TimeGroup, typeof sorted>> = {}
  for (const session of sorted) {
    const group = getTimeGroup(session.updatedAt)
    if (!groups[group]) groups[group] = []
    groups[group]!.push(session)
  }

  const handleDelete = (id: string) => {
    deleteSession(id)
    setConfirmDeleteId(null)
  }

  const startRename = (session: typeof sessions[0]) => {
    setRenamingId(session.id)
    setRenameValue(session.title)
    // Focus the input after state update
    setTimeout(() => renameInputRef.current?.focus(), 0)
  }

  const confirmRename = (id: string) => {
    if (renameValue.trim()) {
      renameSession(id, renameValue.trim())
    }
    setRenamingId(null)
    setRenameValue('')
  }

  const cancelRename = () => {
    setRenamingId(null)
    setRenameValue('')
  }

  if (sorted.length === 0 && !searchQuery.trim()) {
    return (
      <div className="px-3 py-2 text-xs text-gray-400 italic">
        暂无对话
      </div>
    )
  }

  const showSearch = sessions.length >= 8

  return (
    <div className="space-y-1">
      {/* Search box */}
      {showSearch && (
        <div className="px-2 pb-1">
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-100/80 rounded-lg border border-gray-200/60">
            <Search className="w-3 h-3 text-gray-400 flex-shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索对话..."
              className="flex-1 bg-transparent text-xs text-gray-700 placeholder:text-gray-400 outline-none min-w-0"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="p-0.5 hover:bg-gray-200 rounded text-gray-400 hover:text-gray-600"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Empty search result */}
      {sorted.length === 0 && searchQuery.trim() && (
        <div className="px-3 py-2 text-xs text-gray-400 italic">
          未找到匹配的对话
        </div>
      )}

      {/* Time-grouped sessions */}
      {timeGroupOrder.map(group => {
        const groupSessions = groups[group]
        if (!groupSessions || groupSessions.length === 0) return null
        return (
          <div key={group}>
            <div className="px-3 pt-2 pb-0.5 text-[10px] font-medium text-gray-400 uppercase tracking-wider">
              {timeGroupLabels[group]}
            </div>
            <div className="space-y-0.5">
              {groupSessions.map(session => {
                const isActive = activeSessionId === session.id
                const connInfo = getConnectionInfo(session.connectionId)
                const isRenaming = renamingId === session.id

                return (
                  <div
                    key={session.id}
                    className={cn(
                      'group relative flex items-center px-3 py-1.5 text-xs rounded-lg transition-colors cursor-pointer border',
                      isActive
                        ? 'bg-green-50 text-green-800 border-green-200/80'
                        : 'text-gray-600 hover:bg-gray-100/80 border-transparent',
                    )}
                    onClick={() => {
                      if (!isRenaming) setActiveSession(session.id)
                    }}
                  >
                    {/* Main content */}
                    <div className="flex-1 min-w-0">
                      {isRenaming ? (
                        <div className="flex items-center gap-1">
                          <input
                            ref={renameInputRef}
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') confirmRename(session.id)
                              if (e.key === 'Escape') cancelRename()
                            }}
                            className="flex-1 bg-white px-1.5 py-0.5 text-xs text-gray-800 rounded border border-green-300 outline-none min-w-0"
                          />
                          <button
                            onClick={(e) => { e.stopPropagation(); confirmRename(session.id) }}
                            className="p-0.5 hover:bg-green-100 rounded text-green-600"
                          >
                            <Check className="w-3 h-3" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); cancelRename() }}
                            className="p-0.5 hover:bg-gray-200 rounded text-gray-500"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 mb-1">
                          <MessageSquare className="w-3 h-3 flex-shrink-0" />
                          <span className="truncate">{session.title}</span>
                        </div>
                      )}
                      {/* Meta row: env badge + connection name on left, time pushed to right */}
                      <div className="flex items-center justify-between gap-1.5 mt-0.5 ml-5 min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {connInfo.name && (
                            <span className={cn(
                              'inline-flex px-1 py-0 text-[10px] leading-[14px] rounded border font-semibold flex-shrink-0',
                              envConfig[connInfo.env as DbEnv]?.color,
                              envConfig[connInfo.env as DbEnv]?.bg,
                            )}>
                              {envConfig[connInfo.env as DbEnv]?.label}
                            </span>
                          )}
                          {connInfo.name && (
                            <span className="text-[10px] text-gray-400 truncate min-w-0" title={connInfo.name}>
                              {connInfo.name}
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-gray-400 flex-shrink-0">
                          {getRelativeTime(session.updatedAt)}
                        </span>
                      </div>
                    </div>

                    {/* Actions on hover — positioned absolutely to not occupy layout space */}
                    {!isRenaming && (
                      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => { e.stopPropagation(); startRename(session) }}
                          className="p-1 hover:bg-gray-200/80 rounded text-gray-500 hover:text-blue-600 transition-colors"
                          title="重命名"
                        >
                          <PencilLine className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(session.id) }}
                          className="p-1 hover:bg-gray-200/80 rounded text-gray-500 hover:text-red-600 transition-colors"
                          title="删除对话"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
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
                删除后该对话记录将无法恢复，确定要删除吗？
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