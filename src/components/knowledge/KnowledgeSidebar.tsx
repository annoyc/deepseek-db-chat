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
  X,
} from 'lucide-react'
import { AppModeSwitch, type AppMode } from '@/components/layout/AppModeSwitch'
import { ApiKeyDialog } from '@/components/layout/ApiKeyDialog'
import { SessionLoadingIndicator } from '@/components/layout/SessionLoadingIndicator'
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
  const { sessions, activeSessionId, streamingSessionId, setActiveSession, createNewSession, deleteSession, stopStreaming } = useKnowledgeChatStore()
  const [health, setHealth] = useState<KnowledgeHealth | null>(null)
  const [showApiKeyDialog, setShowApiKeyDialog] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

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

  const confirmDeleteSession = confirmDeleteId ? sessions.find((session) => session.id === confirmDeleteId) : null
  const online = health?.status === 'ok'

  const confirmDelete = () => {
    if (!confirmDeleteId) return
    if (confirmDeleteId === streamingSessionId) stopStreaming()
    deleteSession(confirmDeleteId)
    setConfirmDeleteId(null)
  }

  return (
    <>
      <aside
        className={cn(
          'app-sidebar flex h-screen flex-col border-r border-sidebar-border transition-all duration-300 cursor-default select-none',
          collapsed ? 'w-15' : 'w-[272px]',
        )}
      >
        <div className={cn('p-3.5', collapsed ? 'flex flex-col items-center gap-3' : 'space-y-3')}>
          <div className={cn('flex items-center', collapsed ? 'justify-center' : 'justify-between')}>
            <div className="flex min-w-0 items-center">
              <div className="h-9 w-9 overflow-hidden rounded-xl cursor-pointer shadow-sm ring-1 ring-stone-200/70" onClick={onToggleCollapse}>
                <img src={`${import.meta.env.BASE_URL}logo.svg`} alt={APP_NAME} className="h-full w-full" />
              </div>
              {!collapsed && (
                <div className="ml-2.5 min-w-0">
                  <div className="truncate text-[15px] font-semibold tracking-tight text-stone-950">{APP_NAME}</div>
                  <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-stone-400">Knowledge copilot</div>
                </div>
              )}
            </div>

            {!collapsed && (
              <button
                onClick={onToggleCollapse}
                className="rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-white/70 hover:text-stone-700"
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
              className="control-chip flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-stone-700 transition-all hover:border-primary/35 hover:bg-white hover:text-primary hover:shadow-sm"
            >
              <Plus className="h-3.5 w-3.5" />
              新建问答
            </button>
          ) : (
            <button
              onClick={createNewSession}
              className="rounded-lg p-2 text-sm text-stone-500 transition-colors hover:bg-white/75 hover:text-primary"
              title="新建问答"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className={cn('subtle-scrollbar flex-1 w-full overflow-y-auto pb-3', collapsed ? 'px-2' : 'px-3')}>
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
              <div className="border-y border-stone-200/70 py-3">
                <div className="mb-2 flex items-center justify-between px-2">
                  <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">
                    <Cpu className="h-4 w-4 text-stone-500" />
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
                <div className="space-y-2 px-2 text-xs text-stone-500">
                  <div className="flex items-center gap-2">
                    <Cpu className="h-3.5 w-3.5 text-stone-400" />
                    <span className="truncate">{health?.lmModel || 'Executive model'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Globe2 className="h-3.5 w-3.5 text-stone-400" />
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
                <div className="mb-2 flex items-center gap-1.5 px-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">
                  <MessageSquarePlus className="h-4 w-4 text-stone-500" />
                  问答历史
                </div>

                {sortedSessions.length === 0 ? (
                  <div className="px-2 py-8 text-center text-sm text-stone-400">暂无历史问答</div>
                ) : (
                  <div className="space-y-1">
                    {sortedSessions.map((session) => {
                      const active = session.id === activeSessionId
                      const isSessionStreaming = session.id === streamingSessionId
                      return (
                        <div
                          key={session.id}
                          className={cn(
                            'group flex items-center gap-2 rounded-xl px-3 py-2 transition-all duration-200',
                            active ? 'bg-white text-primary shadow-sm ring-1 ring-primary/20' : 'text-stone-600 hover:bg-white/70 hover:text-stone-900',
                            isSessionStreaming && 'bg-white text-primary shadow-[0_8px_24px_rgba(15,118,110,0.08)] ring-1 ring-primary/25',
                          )}
                          title={isSessionStreaming ? `${session.title} · AI 正在工作` : session.title}
                        >
                          <button onClick={() => setActiveSession(session.id)} className="min-w-0 flex-1 text-left">
                            <div className="flex items-center gap-2">
                              {isSessionStreaming && <SessionLoadingIndicator className="mt-px" />}
                              <span className="truncate text-sm font-medium">{session.title}</span>
                            </div>
                            <div className="text-xs text-stone-400">{getRelativeTime(session.updatedAt)}</div>
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(session.id)}
                            className="rounded-md p-1 text-stone-400 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
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

        <div className="border-t border-stone-200/75">
          {collapsed ? (
            <div className="flex flex-col items-center gap-1 py-2">
              <button
                onClick={() => setShowApiKeyDialog(true)}
                className="rounded-lg p-2.5 text-stone-500 transition-colors hover:bg-white/75 hover:text-stone-800"
                title={health?.backendBase || '设置'}
              >
                <Settings className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={onToggleCollapse}
                className="rounded-lg p-2.5 text-stone-500 transition-colors hover:bg-white/75 hover:text-stone-800"
                title="展开侧边栏"
              >
                <PanelLeftOpen className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between px-3 py-2">
              <button
                onClick={() => setShowApiKeyDialog(true)}
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-stone-600 transition-colors hover:bg-white/75 hover:text-stone-900"
                title={health?.backendBase || '设置'}
              >
                <Settings className="h-3.5 w-3.5" />
                设置
              </button>
            </div>
          )}
        </div>
      </aside>

      {confirmDeleteSession && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/35 backdrop-blur-sm"
          onClick={() => setConfirmDeleteId(null)}
        >
          <div
            className="mx-4 w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600">
                  <Trash2 className="h-4.5 w-4.5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-stone-950">删除这条问答？</h2>
                  <p className="mt-1 text-xs leading-5 text-stone-500">
                    删除后本地历史无法恢复。
                  </p>
                </div>
              </div>
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700"
                title="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mb-5 rounded-xl border border-stone-200/75 bg-stone-50 px-3 py-2 text-sm font-medium text-stone-700">
              <div className="truncate">{confirmDeleteSession.title}</div>
              <div className="mt-0.5 text-xs font-normal text-stone-400">{getRelativeTime(confirmDeleteSession.updatedAt)}</div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="rounded-xl border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-50 hover:text-stone-900"
              >
                取消
              </button>
              <button
                onClick={confirmDelete}
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-700"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}

      <ApiKeyDialog open={showApiKeyDialog} onClose={() => setShowApiKeyDialog(false)} />
    </>
  )
}
