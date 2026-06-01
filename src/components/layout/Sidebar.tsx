import { useState, useEffect } from 'react'
import { Database, MessageSquarePlus, PanelLeftClose, PanelLeftOpen, Plus, Settings } from 'lucide-react'
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
  const { createNewSession } = useChatStore()
  const { editingConnection } = useDatabaseStore()

  useEffect(() => {
    if (editingConnection) {
      setShowAddDialog(true)
    }
  }, [editingConnection])

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
                <img src="/logo.svg" alt="DB Chat2SQL" className="w-full h-full" />
              </div>
              {!collapsed && (
                <span className="font-semibold text-base text-gray-900 ml-2.5">DB Chat2SQL</span>
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
        <div className={cn('flex-1 overflow-y-auto pb-3', collapsed ? 'px-2' : 'px-3')}>
          {/* Database section */}
          <div className={cn('flex items-center gap-2 py-1.5', collapsed ? 'justify-center' : 'px-2')}>
            <Database className="w-4 h-4 text-gray-500" />
            {!collapsed && (
              <span className="text-xs font-medium text-gray-700 uppercase tracking-wider">数据库连接</span>
            )}
          </div>
          {!collapsed && <DatabaseList />}

          {/* Chat section */}
          <div className={cn('flex items-center py-1.5', collapsed ? 'justify-center' : 'justify-between px-2')}>
            <div className="flex items-center gap-1.5">
              <MessageSquarePlus className="w-4 h-4 text-gray-500" />
              {!collapsed && (
                <span className="text-xs font-medium text-gray-700 uppercase tracking-wider">对话历史</span>
              )}
            </div>
            {!collapsed && (
              <button
                onClick={createNewSession}
                className="p-1 hover:bg-gray-200 rounded text-gray-500 hover:text-green-700 transition-colors"
                title="新对话"
              >
                <Plus className="w-3 h-3" />
              </button>
            )}
          </div>
          {!collapsed && <ChatHistory />}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200">
          {collapsed ? (
            <button
              onClick={() => setShowApiKeyDialog(true)}
              className="w-full flex justify-center p-3 hover:bg-gray-100 rounded-lg transition-colors text-gray-500 hover:text-gray-700"
              title="设置"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              onClick={() => setShowApiKeyDialog(true)}
              className="w-full flex items-center gap-2 p-3 text-xs text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <Settings className="w-3.5 h-3.5" />
              设置
            </button>
          )}
        </div>
      </aside>

      <AddConnectionDialog open={showAddDialog} onClose={() => setShowAddDialog(false)} />
      <ApiKeyDialog open={showApiKeyDialog} onClose={() => setShowApiKeyDialog(false)} />
    </>
  )
}
