import { useEffect, useMemo, useState } from 'react'
import {
  BookOpenText,
  CheckCircle2,
  CircleAlert,
  Cpu,
  Globe2,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  Trash2,
  WifiOff,
} from 'lucide-react'
import { AppModeSwitch, type AppMode } from '@/components/layout/AppModeSwitch'
import { ApiKeyDialog } from '@/components/layout/ApiKeyDialog'
import { cn, getRelativeTime } from '@/lib/utils'
import type { KnowledgeHealth } from '@/lib/knowledge-types'
import { useKnowledgeChatStore } from '@/hooks/useKnowledgeChat'
import { knowledgeHealth } from '@/server/functions/knowledge-chat'
import { APP_NAME } from '@/lib/constants'

interface KnowledgeSidebarProps {
  activeApp: AppMode
  onAppChange: (app: AppMode) => void
  collapsed?: boolean
  onToggleCollapse?: () => void
}

export function KnowledgeSidebar({
  activeApp,
  onAppChange,
  collapsed = false,
  onToggleCollapse,
}: KnowledgeSidebarProps) {
  const { sessions, activeSessionId, setActiveSession, createNewSession, deleteSession } = useKnowledgeChatStore()
  const [health, setHealth] = useState<KnowledgeHealth | null>(null)
  const [showApiKeyDialog, setShowApiKeyDialog] = useState(false)

  useEffect(() => {
    let cancelled = false
    knowledgeHealth().then((result) => {
      if (!cancelled) setHealth(result)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const sortedSessions = useMemo(() => {
    return [...sessions].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }, [sessions])

  const online = health?.status === 'ok'

  return (
    <>
      <aside
        className={cn(
          'flex h-screen flex-col border-r border-gray-200 bg-slate-50/80 transition-all duration-300 cursor-default select-none',
          collapsed ? 'w-14' : 'w-64',
        )}
      >
        <div className={cn('p-4', collapsed ? 'flex flex-col items-center gap-3' : 'space-y-3')}>
          <div className={cn('flex items-center', collapsed ? 'justify-center' : 'justify-between')}>
            <div className="flex items-center">
              <div className="h-8 w-8 overflow-hidden rounded-lg cursor-pointer" onClick={onToggleCollapse}>
                <img src={`${import.meta.env.BASE_URL}logo.svg`} alt={APP_NAME} className="h-full w-full" />
              </div>
              {!collapsed && <span className="ml-2.5 text-[15px] font-semibold tracking-tight text-gray-900">{APP_NAME}</span>}
            </div>

            {!collapsed && (
              <button
                onClick={onToggleCollapse}
                className="rounded p-1.5 text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-700"
                title="收起侧边栏"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            )}
          </div>

          <AppModeSwitch activeApp={activeApp} onAppChange={onAppChange} collapsed={collapsed} />

          {!collapsed ? (
            <button
              onClick={createNewSession}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-xs font-medium text-gray-600 transition-colors hover:border-primary/60 hover:bg-primary/5 hover:text-primary"
            >
              <Plus className="h-3.5 w-3.5" />
              新建问答
            </button>
          ) : (
            <button
              onClick={createNewSession}
              className="rounded p-2 text-sm text-gray-500 transition-colors hover:bg-gray-200 hover:text-primary"
              title="新建问答"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className={cn('flex-1 w-full overflow-y-auto pb-3', collapsed ? 'px-2' : 'px-3')}>
          {collapsed ? (
            <div className="flex flex-col items-center gap-1 pt-1">
              <div
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-lg border',
                  online
                    ? 'border-primary/20 bg-primary/10 text-primary'
                    : 'border-amber-200 bg-amber-50 text-amber-700',
                )}
                title={online ? '知识库服务在线' : '知识库服务待连接'}
              >
                <BookOpenText className="h-3.5 w-3.5" />
              </div>
            </div>
          ) : (
            <>
              <div className="border-y border-gray-200/60 py-3">
                <div className="mb-2 flex items-center justify-between px-2">
                  <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-gray-700">
                    <Cpu className="h-4 w-4 text-gray-500" />
                    知识库服务
                  </span>
                  {online ? (
                    <span className="flex items-center gap-1 text-xs text-primary">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      在线
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-amber-700">
                      <WifiOff className="h-3.5 w-3.5" />
                      待连接
                    </span>
                  )}
                </div>
                <div className="space-y-2 px-2 text-xs text-gray-500">
                  <div className="flex items-center gap-2">
                    <Cpu className="h-3.5 w-3.5 text-gray-400" />
                    <span className="truncate">{health?.lmModel || 'Executive model'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Globe2 className="h-3.5 w-3.5 text-gray-400" />
                    <span>{health?.webSearchAvailable ? '联网搜索可用' : '联网搜索未配置或未知'}</span>
                  </div>
                  {health?.error && (
                    <div className="flex items-start gap-2 rounded-lg bg-amber-50/70 px-2 py-1.5 text-amber-700">
                      <CircleAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                      <span className="line-clamp-2">{health.error}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="py-3">
                <div className="mb-2 flex items-center gap-1.5 px-2 text-xs font-medium uppercase tracking-wider text-gray-700">
                  <MessageSquarePlus className="h-4 w-4 text-gray-500" />
                  问答历史
                </div>

                {sortedSessions.length === 0 ? (
                  <div className="px-2 py-8 text-center text-sm text-gray-400">暂无历史问答</div>
                ) : (
                  <div className="space-y-1">
                    {sortedSessions.map((session) => {
                      const active = session.id === activeSessionId
                      return (
                        <div
                          key={session.id}
                          className={cn(
                            'group flex items-center gap-2 rounded-lg px-3 py-2 transition-colors',
                            active ? 'bg-primary/10 text-primary ring-1 ring-primary/20' : 'text-gray-600 hover:bg-gray-100',
                          )}
                        >
                          <button onClick={() => setActiveSession(session.id)} className="min-w-0 flex-1 text-left">
                            <div className="truncate text-sm font-medium">{session.title}</div>
                            <div className="text-xs text-gray-400">{getRelativeTime(session.updatedAt)}</div>
                          </button>
                          <button
                            onClick={() => deleteSession(session.id)}
                            className="rounded-md p-1 text-gray-400 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
                            title="删除问答"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="border-t border-gray-200">
          {collapsed ? (
            <div className="flex flex-col items-center gap-1 py-2">
              <button
                onClick={() => setShowApiKeyDialog(true)}
                className="rounded-lg p-2.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
                title={health?.backendBase || '设置'}
              >
                <Settings className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={onToggleCollapse}
                className="rounded-lg p-2.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
                title="展开侧边栏"
              >
                <PanelLeftOpen className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between px-3">
              <button
                onClick={() => setShowApiKeyDialog(true)}
                className="flex items-center gap-2 rounded-lg p-3 text-xs text-gray-600 transition-colors hover:bg-gray-100"
                title={health?.backendBase || '设置'}
              >
                <Settings className="h-3.5 w-3.5" />
                设置
              </button>
            </div>
          )}
        </div>
      </aside>

      <ApiKeyDialog open={showApiKeyDialog} onClose={() => setShowApiKeyDialog(false)} />
    </>
  )
}
