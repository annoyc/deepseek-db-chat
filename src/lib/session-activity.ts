import type { ChatSession } from './types'

export type SessionActivityState = 'streaming' | 'waiting' | 'idle'

export function hasPendingUserAction(session: ChatSession): boolean {
  return session.messages.some((message) =>
    message.sqlConfirm?.status === 'pending' ||
    message.smartFilterConfirm?.status === 'pending'
  )
}

export function getChatSessionActivity(
  session: ChatSession,
  streamingSessionId: string | null,
): SessionActivityState {
  if (streamingSessionId === session.id) return 'streaming'
  if (hasPendingUserAction(session)) return 'waiting'
  return 'idle'
}

export function getSessionActivityLabel(state: SessionActivityState): string {
  if (state === 'streaming') return 'AI 正在工作'
  if (state === 'waiting') return '等待用户确认'
  return ''
}
