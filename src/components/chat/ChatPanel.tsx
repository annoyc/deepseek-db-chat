import { useState } from 'react'
import { useChatStore } from '@/hooks/useChat'
import { useDatabaseStore } from '@/hooks/useDatabase'
import { MessageList } from './MessageList'
import { MessageInput } from './MessageInput'
import { Settings } from 'lucide-react'
import { ApiKeyDialog } from '../layout/ApiKeyDialog'

export function ChatPanel() {
  const { activeSession } = useChatStore()
  const { activeConnectionId, getFullConnection, connectionStatus } = useDatabaseStore()
  const [showSettings, setShowSettings] = useState(false)

  const displayConnectionId = activeConnectionId || activeSession?.connectionId || null
  const sessionConnection = displayConnectionId ? getFullConnection(displayConnectionId) : null

  const dotColor = connectionStatus === 'error'
    ? 'bg-red-500'
    : connectionStatus === 'testing'
      ? 'bg-yellow-500'
      : 'bg-green-500'

  return (
    <div className="flex flex-col h-full bg-[#f5f5f0]">
      <header className="flex items-center justify-between px-5 py-2.5 border-b border-gray-200 bg-white/80 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          {sessionConnection && (
            <>
              <div className={`w-2 h-2 rounded-full ${dotColor}`} />
              <span className="text-sm font-medium text-gray-800">
                {sessionConnection.name}
              </span>
              <span className="text-xs text-gray-400">
                ({sessionConnection.database})
              </span>
            </>
          )}
        </div>
        <button
          onClick={() => setShowSettings(true)}
          className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <Settings className="w-4 h-4" />
        </button>
      </header>

      <div className="flex-1 overflow-hidden">
        <MessageList
          messages={activeSession?.messages ?? []}
        />
      </div>

      <MessageInput />
      <ApiKeyDialog open={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  )
}
