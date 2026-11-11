import { useState } from 'react'
import { Pencil, Trash2, LockKeyhole } from 'lucide-react'
import { ConfirmDialog } from '@/components/ui/modal'
import { cn, envConfig, getDbTypeFromConnection } from '@/lib/utils'
import { useDatabaseStore } from '@/hooks/useDatabase'
import { isDemoConnectionId } from '@/lib/demo-connection'
import type { DbEnv } from '@/lib/types'

export function DatabaseList() {
  const { connections, connectionsLoaded, connectionsLoadError, activeConnectionId, setActiveConnection, removeConnection, setEditingConnection, connectionStatus, connectionError } = useDatabaseStore()

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const dotColor = activeConnectionId
    ? connectionStatus === 'error'
      ? 'bg-red-500'
      : connectionStatus === 'testing'
        ? 'bg-yellow-500 animate-pulse-dot'
        : connectionStatus === 'success'
          ? 'bg-green-500'
          : 'bg-stone-300'
    : 'bg-stone-300'

  if (connections.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-stone-400 italic">
        {connectionsLoaded ? '暂无连接' : '正在加载连接...'}
        {connectionsLoadError && <p role="alert" className="mt-2 not-italic leading-relaxed text-amber-700">{connectionsLoadError}</p>}
      </div>
    )
  }

  const handleDelete = (id: string) => {
    if (isDemoConnectionId(id)) return
    removeConnection(id)
    setConfirmDeleteId(null)
  }

  return (
    <div className="space-y-0.5 mb-2">
      {connections.map((conn) => {
        const isActive = activeConnectionId === conn.id
        const isDemo = isDemoConnectionId(conn.id)
        const env: DbEnv = conn.env || 'dev'
        const envInfo = envConfig[env] ?? envConfig.dev
        const dbType = getDbTypeFromConnection(conn)
        const subInfo = `${dbType} · ${conn.database}`

        return (
          <div
            key={conn.id}
            className={cn(
              'group relative flex items-center px-3 py-2.5 text-xs rounded-xl transition-all duration-200 cursor-pointer border focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary',
              isActive
                ? 'bg-white text-primary border-primary/25 shadow-sm'
                : 'text-stone-600 hover:bg-white/70 hover:text-stone-900 border-transparent',
            )}
            role="button"
            tabIndex={0}
            aria-current={isActive ? 'true' : undefined}
            onClick={() => setActiveConnection(conn.id)}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setActiveConnection(conn.id)
              }
            }}
          >
            {/* Main content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-0.5">
                <div className={cn(
                  'w-2 h-2 rounded-full flex-shrink-0',
                  isActive ? dotColor : 'bg-stone-300'
                )} />
                  <span className="truncate font-semibold">{conn.name}</span>
                {isDemo && <LockKeyhole className="h-3 w-3 shrink-0 text-primary/70" aria-label="内置演示连接，不可编辑或删除" />}
                {!isDemo && envInfo.label && (
                  <span className={cn(
                    'inline-flex px-1 py-0 text-[11px] leading-[13px] rounded border font-medium flex-shrink-0',
                    envInfo.color, envInfo.bg
                  )}>
                    {envInfo.label}
                  </span>
                )}
              </div>
              <div className="text-[11px] text-stone-400 truncate ml-[14px]">
                {subInfo}
              </div>
              {isDemo && <div className="ml-[14px] mt-1 text-[11px] font-medium text-primary/75">内置演示 · 只读</div>}
            </div>

            {/* Actions on hover — positioned absolutely to not occupy layout space */}
            {!isDemo && <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5 rounded-lg bg-white/95 p-0.5 opacity-0 shadow-sm ring-1 ring-stone-200/80 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
              <button
                onClick={(e) => { e.stopPropagation(); setEditingConnection(conn) }}
                className="p-1 hover:bg-stone-100 rounded text-stone-500 hover:text-primary transition-colors focus-visible:outline-2 focus-visible:outline-primary"
                title="编辑连接"
                aria-label={`编辑连接：${conn.name}`}
              >
                <Pencil className="w-3 h-3" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(conn.id) }}
                className="p-1 hover:bg-stone-100 rounded text-stone-500 hover:text-red-600 transition-colors focus-visible:outline-2 focus-visible:outline-primary"
                title="删除连接"
                aria-label={`删除连接：${conn.name}`}
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>}
          </div>
        )
      })}

      {connectionsLoadError && <p role="alert" className="px-3 py-2 text-[11px] leading-relaxed text-amber-700">{connectionsLoadError}</p>}
      {connectionStatus === 'error' && connectionError && <p role="alert" className="px-3 py-2 text-[11px] leading-relaxed text-red-600">{connectionError}</p>}

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        open={confirmDeleteId !== null && !isDemoConnectionId(confirmDeleteId)}
        title="确认删除"
        description="删除后该数据库连接将无法恢复，确定要删除吗？"
        confirmLabel="删除"
        onConfirm={() => { if (confirmDeleteId) handleDelete(confirmDeleteId) }}
        onClose={() => setConfirmDeleteId(null)}
      />
    </div>
  )
}
