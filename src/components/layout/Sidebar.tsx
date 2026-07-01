import { useState, useEffect } from 'react'
import { Database, MessageSquarePlus, PanelLeftClose, PanelLeftOpen, Plus, Settings, ChevronDown, Server } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AppModeSwitch, type AppMode } from './AppModeSwitch'
import { DatabaseList } from './DatabaseList'
import { ChatHistory } from './ChatHistory'
import { AddConnectionDialog } from './AddConnectionDialog'
import { ApiKeyDialog } from './ApiKeyDialog'
import { useChatStore } from '@/hooks/useChat'
import { useDatabaseStore } from '@/hooks/useDatabase'
import { APP_NAME } from '@/lib/constants'

interface SidebarProps {
  collapsed?: boolean
  onToggleCollapse?: () => void
  activeApp: AppMode
  onAppChange: (app: AppMode) => void
}

export function Sidebar({ collapsed = false, onToggleCollapse, activeApp, onAppChange }: SidebarProps) {
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [showApiKeyDialog, setShowApiKeyDialog] = useState(false)
  const [dbSectionCollapsed, setDbSectionCollapsed] = useState(false)
  const [chatSectionCollapsed, setChatSectionCollapsed] = useState(false)
  const { createNewSession, sessions, activeSessionId, setActiveSession } = useChatStore()
  const { editingConnection, connections, activeConnectionId } = useDatabaseStore()

  useEffect(() => {
    if (editingConnection) {
      setShowAddDialog(true)
    }
  }, [editingConnection])

  // Get active connection name for collapsed tooltip
  const activeConn = connections.find(c => c.id === activeConnectionId)

  // Get recent session titles for collapsed display
  const recentSessions = [...sessions]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 3)
    .filter(s => s.title !== '新对话' || s.messages.length > 0)

  return (
    <>
      <aside
        className={cn(
          'app-sidebar h-screen flex flex-col border-r border-sidebar-border transition-all duration-300 cursor-default select-none',
          collapsed ? 'w-15' : 'w-[272px]',
        )}
      >
        {/* Logo + Toggle */}
        <div className={cn('p-3.5', collapsed ? 'flex flex-col items-center gap-3' : 'space-y-3')}>
          <div className={cn('flex items-center', collapsed ? 'justify-center' : 'justify-between')}>
            <div className="flex min-w-0 items-center">
              <div className="h-9 w-9 rounded-xl overflow-hidden cursor-pointer shadow-sm ring-1 ring-stone-200/70" onClick={onToggleCollapse}>
                <img src={`${import.meta.env.BASE_URL}logo.svg`} alt={APP_NAME} className="w-full h-full" />
              </div>
              {!collapsed && (
                <div className="ml-2.5 min-w-0">
                  <div className="truncate text-[15px] font-semibold tracking-tight text-stone-950">{APP_NAME}</div>
                  <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-stone-400">Local data copilot</div>
                </div>
              )}
            </div>
            {!collapsed && <button
              onClick={onToggleCollapse}
              className="rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-white/70 hover:text-stone-700"
              title="收起侧边栏"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>}
          </div>

          <AppModeSwitch activeApp={activeApp} onAppChange={onAppChange} collapsed={collapsed} />

          {!collapsed && (
            <button
              onClick={() => setShowAddDialog(true)}
              className="control-chip flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-stone-700 transition-all hover:border-primary/35 hover:bg-white hover:text-primary hover:shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              添加数据库连接
            </button>
          )}
          {collapsed && (
            <button
              onClick={() => setShowAddDialog(true)}
              className="rounded-lg p-2 text-sm text-stone-500 transition-colors hover:bg-white/75 hover:text-primary"
              title="添加数据库连接"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Content area */}
        <div className={cn('subtle-scrollbar flex-1 w-full overflow-y-auto pb-3', collapsed ? 'px-2' : 'px-3')}>
          {/* Database section - collapsible */}
          <div
            className={cn('flex items-center gap-2 py-1.5 cursor-pointer select-none', collapsed ? 'justify-center' : 'px-2')}
            onClick={() => !collapsed && setDbSectionCollapsed(!dbSectionCollapsed)}
          >
            <Database className="w-4 h-4 text-stone-500" />
            {!collapsed && (
              <>
                <span className="flex-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">数据库连接</span>
                <span className="rounded-full bg-stone-200/70 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-stone-500">{connections.length}</span>
                <div className={cn(
                  'transition-transform duration-200',
                  dbSectionCollapsed ? '-rotate-90' : ''
                )}>
                  <ChevronDown className="w-3.5 h-3.5 text-stone-400" />
                </div>
              </>
            )}
          </div>
          {!collapsed && !dbSectionCollapsed && <DatabaseList />}

          {/* Collapsed: show active DB indicator */}
          {collapsed && activeConn && (
            <div
              className="flex justify-center py-1"
              title={activeConn.name}
            >
              <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shadow-sm">
                <Server className="w-3.5 h-3.5" />
              </div>
            </div>
          )}

          {/* Divider between sections */}
          {!collapsed && (
            <div className="my-3 border-t border-stone-200/70" />
          )}

          {/* Chat section - collapsible */}
          <div
            className={cn('flex items-center py-1.5', collapsed ? 'justify-center' : 'justify-between px-2 cursor-pointer select-none')}
            onClick={() => !collapsed && setChatSectionCollapsed(!chatSectionCollapsed)}
          >
            <div className="flex items-center gap-1.5">
              <MessageSquarePlus className="w-4 h-4 text-stone-500" />
              {!collapsed && (
                <>
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">对话历史</span>
                  <div className={cn(
                    'transition-transform duration-200',
                    chatSectionCollapsed ? '-rotate-90' : ''
                  )}>
                    <ChevronDown className="w-3.5 h-3.5 text-stone-400" />
                  </div>
                </>
              )}
            </div>
            {!collapsed && (
              <button
                onClick={(e) => { e.stopPropagation(); createNewSession() }}
                className="rounded-md p-0.5 text-stone-500 transition-colors hover:bg-primary/10 hover:text-primary"
                title="新对话"
              >
                <Plus className="w-4 h-4" />
              </button>
            )}
          </div>
          {!collapsed && !chatSectionCollapsed && <ChatHistory />}

          {/* Collapsed: show recent sessions as tooltips */}
          {collapsed && recentSessions.length > 0 && (
            <div className="flex flex-col items-center gap-1 mt-1">
              {recentSessions.map(session => (
                <button
                  key={session.id}
                  onClick={() => setActiveSession(session.id)}
                  className={cn(
                    'w-7 h-7 rounded-lg flex items-center justify-center text-xs font-medium transition-colors',
                    activeSessionId === session.id
                      ? 'bg-primary/10 text-primary border border-primary/20'
                      : 'bg-stone-100 text-stone-500 hover:bg-white border border-transparent'
                  )}
                  title={session.title}
                >
                  {session.title.slice(0, 1).toUpperCase()}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-stone-200/75">
          {collapsed ? (
            <div className="flex flex-col items-center gap-1 py-2">
              <button
                onClick={() => setShowApiKeyDialog(true)}
                className="p-2.5 hover:bg-white/75 rounded-lg transition-colors text-stone-500 hover:text-stone-800"
                title="设置"
              >
                <Settings className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={onToggleCollapse}
                className="p-2.5 hover:bg-white/75 rounded-lg transition-colors text-stone-500 hover:text-stone-800"
                title="展开侧边栏"
              >
                <PanelLeftOpen className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between px-3 py-2">
              <button
                onClick={() => setShowApiKeyDialog(true)}
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-stone-600 transition-colors hover:bg-white/75 hover:text-stone-900"
              >
                <Settings className="w-3.5 h-3.5" />
                设置
              </button>
            </div>
          )}
        </div>
      </aside>

      <AddConnectionDialog open={showAddDialog} onClose={() => setShowAddDialog(false)} />
      <ApiKeyDialog open={showApiKeyDialog} onClose={() => setShowApiKeyDialog(false)} />
    </>
  )
}
