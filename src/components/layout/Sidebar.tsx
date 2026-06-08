import { useState, useEffect } from 'react'
import { Database, MessageSquarePlus, PanelLeftClose, PanelLeftOpen, Plus, Settings, ChevronDown, ChevronRight, Server } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DatabaseList } from './DatabaseList'
import { ChatHistory } from './ChatHistory'
import { AddConnectionDialog } from './AddConnectionDialog'
import { ApiKeyDialog } from './ApiKeyDialog'
import { useChatStore } from '@/hooks/useChat'
import { useDatabaseStore } from '@/hooks/useDatabase'

interface SidebarProps {
  collapsed?: boolean
  onToggleCollapse?: () => void
}

export function Sidebar({ collapsed = false, onToggleCollapse }: SidebarProps) {
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
          'h-screen flex flex-col border-r border-gray-200 bg-slate-50/80 transition-all duration-300',
          collapsed ? 'w-14' : 'w-64',
        )}
      >
        {/* Logo + Toggle */}
        <div className={cn('p-4', collapsed ? 'flex flex-col items-center gap-3' : 'space-y-3')}>
          <div className={cn('flex items-center', collapsed ? 'justify-center' : 'justify-between')}>
            <div className="flex items-center">
              <div className="w-8 h-8 rounded-lg overflow-hidden cursor-pointer" onClick={onToggleCollapse}>
                <img src="/logo.svg" alt="DBPilot" className="w-full h-full" />
              </div>
              {!collapsed && (
                <span className="font-semibold text-base text-gray-900 ml-2.5">DBPilot</span>
              )}
            </div>
            {!collapsed && <button
              onClick={onToggleCollapse}
              className="p-1.5 hover:bg-gray-200 rounded text-gray-500 hover:text-gray-700 transition-colors"
              title="收起侧边栏"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>}
          </div>

          {!collapsed && (
            <button
              onClick={() => setShowAddDialog(true)}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 border border-dashed border-gray-300 text-gray-600 rounded-lg hover:border-green-500 hover:text-green-700 hover:bg-green-50/50 transition-colors text-xs font-medium"
            >
              <Plus className="w-3.5 h-3.5" />
              添加数据库连接
            </button>
          )}
          {collapsed && (
            <button
              onClick={() => setShowAddDialog(true)}
              className="p-2 hover:bg-gray-200 rounded text-sm text-gray-500 hover:text-green-700 transition-colors"
              title="添加数据库连接"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Content area */}
        <div className={cn('flex-1 w-full overflow-y-auto pb-3', collapsed ? 'px-2' : 'px-3')}>
          {/* Database section - collapsible */}
          <div
            className={cn('flex items-center gap-2 py-1.5 cursor-pointer select-none', collapsed ? 'justify-center' : 'px-2')}
            onClick={() => !collapsed && setDbSectionCollapsed(!dbSectionCollapsed)}
          >
            <Database className="w-4 h-4 text-gray-500" />
            {!collapsed && (
              <>
                <span className="text-xs font-medium text-gray-700 uppercase tracking-wider flex-1">数据库连接</span>
                <div className={cn(
                  'transition-transform duration-200',
                  dbSectionCollapsed ? '-rotate-90' : ''
                )}>
                  <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
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
              <div className="w-7 h-7 rounded-lg bg-green-50 border border-green-200 flex items-center justify-center text-green-700">
                <Server className="w-3.5 h-3.5" />
              </div>
            </div>
          )}

          {/* Divider between sections */}
          {!collapsed && (
            <div className="my-2 border-t border-gray-200/60" />
          )}

          {/* Chat section - collapsible */}
          <div
            className={cn('flex items-center py-1.5', collapsed ? 'justify-center' : 'justify-between px-2 cursor-pointer select-none')}
            onClick={() => !collapsed && setChatSectionCollapsed(!chatSectionCollapsed)}
          >
            <div className="flex items-center gap-1.5">
              <MessageSquarePlus className="w-4 h-4 text-gray-500" />
              {!collapsed && (
                <>
                  <span className="text-xs font-medium text-gray-700 uppercase tracking-wider">对话历史</span>
                  <div className={cn(
                    'transition-transform duration-200',
                    chatSectionCollapsed ? '-rotate-90' : ''
                  )}>
                    <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                  </div>
                </>
              )}
            </div>
            {!collapsed && (
              <button
                onClick={(e) => { e.stopPropagation(); createNewSession() }}
                className="p-0.5 hover:bg-green-100 rounded text-gray-500 hover:text-green-700 transition-colors"
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
                      ? 'bg-green-50 text-green-700 border border-green-200'
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200 border border-transparent'
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
        <div className="border-t border-gray-200">
          {collapsed ? (
            <div className="flex flex-col items-center gap-1 py-2">
              <button
                onClick={() => setShowApiKeyDialog(true)}
                className="p-2.5 hover:bg-gray-100 rounded-lg transition-colors text-gray-500 hover:text-gray-700"
                title="设置"
              >
                <Settings className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={onToggleCollapse}
                className="p-2.5 hover:bg-gray-100 rounded-lg transition-colors text-gray-500 hover:text-gray-700"
                title="展开侧边栏"
              >
                <PanelLeftOpen className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between px-3">
              <button
                onClick={() => setShowApiKeyDialog(true)}
                className="flex items-center gap-2 p-3 text-xs text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
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