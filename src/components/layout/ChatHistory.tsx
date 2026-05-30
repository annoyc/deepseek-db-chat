import { MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useChatStore } from '@/hooks/useChat'

export function ChatHistory() {
  const { sessions, activeSessionId, setActiveSession } = useChatStore()

  if (sessions.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-gray-400 italic">
        暂无对话
      </div>
    )
  }

  return (
    <div className="space-y-0.5">
      {sessions.map((session) => (
        <button
          key={session.id}
          onClick={() => setActiveSession(session.id)}
          className={cn(
            'w-full flex items-center gap-2 px-3 py-2 text-xs rounded-lg transition-colors',
            activeSessionId === session.id
              ? 'bg-green-50 text-green-800 border border-green-200'
              : 'text-gray-600 hover:bg-gray-100',
          )}
        >
          <MessageSquare className="w-3 h-3 flex-shrink-0" />
          <span className="truncate">{session.title}</span>
        </button>
      ))}
    </div>
  )
}
