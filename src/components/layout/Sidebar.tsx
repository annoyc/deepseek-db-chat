import { useState, useEffect } from 'react'
import { Database, MessageSquarePlus, Plus, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DatabaseList } from './DatabaseList'
import { ChatHistory } from './ChatHistory'
import { AddConnectionDialog } from './AddConnectionDialog'
import { ApiKeyDialog } from './ApiKeyDialog'
import { useChatStore } from '@/hooks/useChat'
import { useDatabaseStore } from '@/hooks/useDatabase'

export function Sidebar() {
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
      <aside className="w-56 h-screen flex flex-col border-r border-gray-200 bg-slate-50/80">
        <div className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-green-800 flex items-center justify-center text-xs font-bold text-white">
              DB
            </div>
            <span className="font-semibold text-sm text-gray-900">DeepSeek DB Agent</span>
          </div>

          <button
            onClick={() => setShowAddDialog(true)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 border border-dashed border-gray-300 text-gray-600 rounded-lg hover:border-green-500 hover:text-green-700 hover:bg-green-50/50 transition-colors text-xs font-medium"
          >
            <Plus className="w-3.5 h-3.5" />
            添加数据库连接
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-4">
          <div>
            <div className="flex items-center gap-2 px-2 py-1.5 text-xs font-medium text-gray-500 uppercase tracking-wider">
              <Database className="w-3 h-3" />
              数据库连接
            </div>
            <DatabaseList />
          </div>

          <div>
            <div className="flex items-center justify-between px-2 py-1.5">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                <MessageSquarePlus className="w-3 h-3" />
                对话记录
              </span>
              <button
                onClick={createNewSession}
                className="p-1 hover:bg-gray-200 rounded text-gray-500 hover:text-green-700 transition-colors"
                title="新对话"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>
            <ChatHistory />
          </div>
        </div>

        <div className="p-3 border-t border-gray-200">
          <button
            onClick={() => setShowApiKeyDialog(true)}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <Settings className="w-3.5 h-3.5" />
            设置
          </button>
        </div>
      </aside>

      <AddConnectionDialog open={showAddDialog} onClose={() => setShowAddDialog(false)} />
      <ApiKeyDialog open={showApiKeyDialog} onClose={() => setShowApiKeyDialog(false)} />
    </>
  )
}
