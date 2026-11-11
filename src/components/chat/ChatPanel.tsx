import { useState } from 'react'
import { PersistenceNotice } from '../layout/PersistenceNotice'
import { useChatStore } from '@/hooks/useChat'
import { useDatabaseStore } from '@/hooks/useDatabase'
import { MessageList } from './MessageList'
import { MessageInput } from './MessageInput'
import { WelcomeScreen } from './WelcomeScreen'
import { DatabaseZap, Menu, Settings, PanelRight } from 'lucide-react'
import { ApiKeyDialog } from '../layout/ApiKeyDialog'

interface ChatPanelProps {
  vizPanelOpen?: boolean
  onOpenVizPanel?: () => void
  /** Number of query results available in the data panel. */
  vizCount?: number
  /** Set on phones, where the sidebar is a drawer opened from the header. */
  onOpenSidebar?: () => void
}

export function ChatPanel({ vizPanelOpen, onOpenVizPanel, vizCount = 0, onOpenSidebar }: ChatPanelProps) {
  const { activeSession, draftMessage, isStreaming, persistenceState, retrySave } = useChatStore()
  const { activeConnectionId, getFullConnection, connectionStatus } = useDatabaseStore()
  const [showSettings, setShowSettings] = useState(false)
  const messages = activeSession?.messages ?? []
  const isEmptySession = messages.length === 0

  const displayConnectionId = activeConnectionId || activeSession?.connectionId || null
  const sessionConnection = displayConnectionId ? getFullConnection(displayConnectionId) : null
  const historyReady = persistenceState !== 'loading' && persistenceState !== 'load-error'
  const canUseSuggestions = historyReady && Boolean(activeConnectionId) && !isStreaming

  const dotColor = connectionStatus === 'error'
    ? 'bg-red-500'
    : connectionStatus === 'testing'
      ? 'bg-yellow-500 animate-pulse-dot'
      : connectionStatus === 'success'
        ? 'bg-green-500'
        : 'bg-stone-300'

  return (
    <div className="app-canvas flex h-full flex-col">
      <header className="app-header flex items-center justify-between gap-2 border-b px-3 py-3 backdrop-blur-sm sm:px-5">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          {onOpenSidebar && (
            <button
              onClick={onOpenSidebar}
              aria-label="打开侧边栏"
              title="打开侧边栏"
              className="rounded-lg p-2 text-stone-500 transition-colors hover:bg-white/80 hover:text-stone-800"
            >
              <Menu className="h-5 w-5" />
            </button>
          )}
          <div className="hidden h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl sm:flex border border-stone-200/70 bg-white/80 text-primary shadow-sm">
            <DatabaseZap className="h-4.5 w-4.5" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold tracking-tight text-stone-950">数据分析助手</div>
            <div className="flex min-w-0 items-center gap-2 text-xs text-stone-500">
              {sessionConnection ? (
                <>
                  <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${dotColor}`} />
                  <span className="truncate font-medium text-stone-700">{sessionConnection.name}</span>
                  <span className="truncate text-stone-400">{sessionConnection.database}</span>
                </>
              ) : (
                <span className="truncate">选择连接后开始查询</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1.5">
          {vizCount > 0 && !vizPanelOpen && (
            <button
              onClick={onOpenVizPanel}
              className="flex items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/5 px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
              title="打开数据面板"
              aria-label={`打开数据面板，共 ${vizCount} 个查询结果`}
            >
              <PanelRight className="w-4 h-4" />
              <span>数据面板</span>
              <span className="rounded-full bg-primary px-1.5 text-xs leading-4 text-white">{vizCount}</span>
            </button>
          )}
          <button
            onClick={() => setShowSettings(true)}
            className="rounded-lg p-2 text-stone-400 transition-colors hover:bg-white/80 hover:text-stone-700"
            title="设置"
            aria-label="设置"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      <PersistenceNotice state={persistenceState} onRetry={retrySave} />
      <div className="min-h-0 flex-1 overflow-hidden">
        {isEmptySession ? (
          <WelcomeScreen
            hasConnection={canUseSuggestions}
            connectionName={sessionConnection?.name}
            onSuggestionClick={(text) => {
              if (!canUseSuggestions) return
              draftMessage(text)
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
