import { useState } from 'react'
import { useChatStore } from '@/hooks/useChat'
import { useDatabaseStore } from '@/hooks/useDatabase'
import { MessageList } from './MessageList'
import { MessageInput } from './MessageInput'
import { WelcomeScreen } from './WelcomeScreen'
import { DatabaseZap, Settings, PanelRight } from 'lucide-react'
import { ApiKeyDialog } from '../layout/ApiKeyDialog'

interface ChatPanelProps {
  vizPanelOpen?: boolean
  onOpenVizPanel?: () => void
  hasVisualization?: boolean
}

export function ChatPanel({ vizPanelOpen, onOpenVizPanel, hasVisualization }: ChatPanelProps) {
  const { activeSession, sendMessage, isStreaming } = useChatStore()
  const { activeConnectionId, getFullConnection, connectionStatus } = useDatabaseStore()
  const [showSettings, setShowSettings] = useState(false)
  const messages = activeSession?.messages ?? []
  const isEmptySession = messages.length === 0

  const displayConnectionId = activeConnectionId || activeSession?.connectionId || null
  const sessionConnection = displayConnectionId ? getFullConnection(displayConnectionId) : null
  const canUseSuggestions = Boolean(activeConnectionId) && !isStreaming

  const dotColor = connectionStatus === 'error'
    ? 'bg-red-500'
    : connectionStatus === 'testing'
      ? 'bg-yellow-500 animate-pulse-dot'
      : connectionStatus === 'success'
        ? 'bg-green-500'
        : 'bg-stone-300'

  return (
    <div className="app-canvas flex h-full flex-col">
      <header className="app-header flex items-center justify-between border-b px-5 py-3 backdrop-blur-sm">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-stone-200/70 bg-white/80 text-primary shadow-sm">
            <DatabaseZap className="h-4.5 w-4.5" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold tracking-tight text-stone-950">数据分析助手</div>
            <div className="flex min-w-0 items-center gap-2 text-xs text-stone-500">
              {sessionConnection ? (
                <>
                  <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
                  <span className="truncate font-medium text-stone-700">{sessionConnection.name}</span>
                  <span className="truncate text-stone-400">{sessionConnection.database}</span>
                </>
              ) : (
                <span>选择连接后开始查询</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {hasVisualization && !vizPanelOpen && (
            <button
              onClick={onOpenVizPanel}
              className="rounded-lg p-2 text-stone-400 transition-colors hover:bg-white/80 hover:text-primary"
              title="打开数据面板"
            >
              <PanelRight className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => setShowSettings(true)}
            className="rounded-lg p-2 text-stone-400 transition-colors hover:bg-white/80 hover:text-stone-700"
            title="设置"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        {isEmptySession ? (
          <WelcomeScreen
            hasConnection={Boolean(activeConnectionId)}
            connectionName={sessionConnection?.name}
            onSuggestionClick={(text) => {
              if (!canUseSuggestions) return
              void sendMessage(text)
            }}
          />
        ) : (
          <MessageList messages={messages} />
        )}
      </div>

      <MessageInput />
      <ApiKeyDialog open={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  )
}
