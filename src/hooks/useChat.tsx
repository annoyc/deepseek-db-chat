import { useState, useCallback, useRef, useEffect, createContext, useContext } from 'react'
import type { ChatMessage, ChatSession, StreamChunk, ToolCallInfo, SqlResultInfo, MessagePart } from '@/lib/types'
import { generateId } from '@/lib/utils'
import { maskPII } from '@/lib/masking'
import { chatStream } from '@/server/functions/chat'
import { confirmAndExecuteSql } from '@/server/functions/confirm-sql'
import { db } from '@/lib/db'
import { useDatabaseStore } from './useDatabase'
import { useSettings } from './useSettings'

interface ChatState {
  sessions: ChatSession[]
  activeSessionId: string | null
  activeSession: ChatSession | null
  isStreaming: boolean
  setActiveSession: (id: string) => void
  createNewSession: () => void
  deleteSession: (id: string) => void
  sendMessage: (content: string) => Promise<void>
  clearMessages: () => void
  confirmSql: (messageId: string) => Promise<void>
  cancelSql: (messageId: string) => void
}

const ChatContext = createContext<ChatState | null>(null)

async function* parseSSEStream(response: Response): AsyncGenerator<StreamChunk> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const jsonStr = line.slice(6)
          if (jsonStr === '[DONE]') return
          try {
            yield JSON.parse(jsonStr) as StreamChunk
          } catch {}
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {})
  }
}

async function loadSessionsFromStorage(): Promise<ChatSession[]> {
  if (typeof window === 'undefined') return []
  try {
    const sessions = await db.chatSessions.toArray()
    if (sessions.length > 0) return sessions

    // IndexedDB 为空时尝试从 localStorage 恢复残留数据
    const raw = window.localStorage.getItem('deepseek-chat-sessions')
    if (raw) {
      const restored: ChatSession[] = JSON.parse(raw)
      if (Array.isArray(restored) && restored.length > 0) {
        await db.chatSessions.bulkPut(restored)
        return restored
      }
    }
    return []
  } catch {
    return []
  }
}

async function saveSessionsToStorage(sessions: ChatSession[]) {
  if (typeof window === 'undefined') return
  try {
    const toSave = sessions.map((s) => ({
      ...s,
      messages: s.messages.slice(-100),
    }))
    await db.transaction('rw', db.chatSessions, async () => {
      await db.chatSessions.clear()
      if (toSave.length > 0) {
        await db.chatSessions.bulkPut(toSave)
      }
    })
  } catch {}
}

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const initialLoadDone = useRef(false)

  useEffect(() => {
    loadSessionsFromStorage().then((loaded) => {
      if (loaded.length > 0) {
        setSessions(loaded)
        setActiveSessionId(loaded[0].id)
        if (loaded[0].connectionId) {
          loadingSessionConnIdRef.current = loaded[0].connectionId
          setActiveConnection(loaded[0].connectionId)
        }
      }
      initialLoadDone.current = true
    })
  }, [])
  const [isStreaming, setIsStreaming] = useState(false)
  const { activeConnectionId, getFullConnection, setActiveConnection } = useDatabaseStore()
  const { model, apiKey } = useSettings()
  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions
  const loadingSessionConnIdRef = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    if (!initialLoadDone.current) return
    saveSessionsToStorage(sessions)
  }, [sessions])

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null

  const updateSession = useCallback((sessionId: string, updater: (session: ChatSession) => ChatSession) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? updater(s) : s))
    )
  }, [])

  const getOrCreateSession = useCallback((): string => {
    if (activeSessionId && sessions.find((s) => s.id === activeSessionId)) {
      return activeSessionId
    }
    const newSession: ChatSession = {
      id: generateId(),
      connectionId: activeConnectionId ?? '',
      title: '新对话',
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    setSessions((prev) => [newSession, ...prev])
    setActiveSessionId(newSession.id)
    return newSession.id
  }, [activeSessionId, sessions, activeConnectionId])

  const prevConnectionIdRef = useRef<string | null>(null)

  useEffect(() => {
    const shouldSkip = loadingSessionConnIdRef.current !== undefined && loadingSessionConnIdRef.current === activeConnectionId
    loadingSessionConnIdRef.current = undefined

    if (activeConnectionId !== null && activeConnectionId !== prevConnectionIdRef.current && !shouldSkip) {
      const currentSession = sessionsRef.current.find((s) => s.id === activeSessionId)
      const isEmptySession = currentSession && currentSession.messages.length === 0

      if (isEmptySession) {
        setSessions((prev) => {
          const updated = prev.map((s) =>
            s.id === currentSession.id ? { ...s, connectionId: activeConnectionId, updatedAt: new Date().toISOString() } : s
          )
          saveSessionsToStorage(updated)
          return updated
        })
      } else {
        const newSession: ChatSession = {
          id: generateId(),
          connectionId: activeConnectionId,
          title: '新对话',
          messages: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
        setSessions((prev) => {
          const updated = [newSession, ...prev]
          saveSessionsToStorage(updated)
          return updated
        })
        setActiveSessionId(newSession.id)
      }
    }
    prevConnectionIdRef.current = activeConnectionId
  }, [activeConnectionId, activeSessionId])

  const deleteSession = useCallback((id: string) => {
    setSessions((prev) => {
      const updated = prev.filter((s) => s.id !== id)
      saveSessionsToStorage(updated)
      return updated
    })
    if (activeSessionId === id) {
      setActiveSessionId(null)
    }
  }, [activeSessionId])

  const handleSetActiveSession = useCallback((id: string) => {
    const session = sessions.find((s) => s.id === id)
    if (!session) return

    if (session.connectionId) {
      const conn = getFullConnection(session.connectionId)
      if (conn) {
        loadingSessionConnIdRef.current = session.connectionId
        setActiveConnection(session.connectionId)
      } else {
        setActiveConnection(null)
      }
    } else {
      setActiveConnection(null)
    }

    setActiveSessionId(id)
  }, [sessions, getFullConnection, setActiveConnection])

  const createNewSession = useCallback(() => {
    const currentSession = sessions.find((s) => s.id === activeSessionId)
    if (currentSession && currentSession.messages.length === 0) {
      return
    }
    const newSession: ChatSession = {
      id: generateId(),
      connectionId: activeConnectionId ?? '',
      title: '新对话',
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    setSessions((prev) => [newSession, ...prev])
    setActiveSessionId(newSession.id)
  }, [activeConnectionId, sessions, activeSessionId])

  const processStream = useCallback(async (sessionId: string, connectionId: string, message: string, history: { role: 'user' | 'assistant'; content: string }[]): Promise<boolean> => {
    let hasSqlConfirm = false
    let pendingSqlConfirm: { sql: string; explanation: string } | null = null

    const connection = getFullConnection(connectionId)
    if (!connection) throw new Error('数据库连接不存在')

    const response = await chatStream({
      data: { connection, message, history, model, apiKey: apiKey || undefined },
    })

    for await (const chunk of parseSSEStream(response as unknown as Response)) {
      if (chunk.type === 'tool-call-start' && chunk.name === 'execute_sql') {
        hasSqlConfirm = true
        pendingSqlConfirm = {
          sql: String(chunk.args?.sql ?? ''),
          explanation: String(chunk.args?.explanation ?? ''),
        }
        break
      }

      updateSession(sessionId, (s) => {
        const messages = [...s.messages]
        const lastMsg = { ...messages[messages.length - 1] }

        const parts: MessagePart[] = [...(lastMsg.parts ?? [])]
        const lastPart = parts.length > 0 ? parts[parts.length - 1] : null

        switch (chunk.type) {
          case 'thinking':
            lastMsg.thinking = (lastMsg.thinking ?? '') + chunk.content
            if (lastPart && lastPart.type === 'thinking') {
              parts[parts.length - 1] = { ...lastPart, content: lastPart.content + chunk.content }
            } else {
              parts.push({ type: 'thinking', content: chunk.content })
            }
            break

          case 'text':
            lastMsg.content = (lastMsg.content ?? '') + chunk.content
            if (lastPart && lastPart.type === 'text') {
              parts[parts.length - 1] = { ...lastPart, content: lastPart.content + chunk.content }
            } else {
              parts.push({ type: 'text', content: chunk.content })
            }
            break

          case 'tool-call-start': {
            const tc: ToolCallInfo = {
              name: chunk.name,
              args: chunk.args,
              status: 'calling',
            }
            const newToolCalls = [...(lastMsg.toolCalls ?? []), tc]
            lastMsg.toolCalls = newToolCalls
            parts.push({ type: 'tool-call', toolCallIndex: newToolCalls.length - 1 })
            break
          }

          case 'tool-call-end': {
            const toolCalls = [...(lastMsg.toolCalls ?? [])]
            let idx = -1
            for (let i = toolCalls.length - 1; i >= 0; i--) {
              if (toolCalls[i].name === chunk.name && toolCalls[i].status === 'calling') {
                idx = i
                break
              }
            }
            if (idx >= 0) {
              if (chunk.error) {
                toolCalls[idx] = { ...toolCalls[idx], status: 'error', error: chunk.error }
              } else {
                toolCalls[idx] = { ...toolCalls[idx], status: 'completed', result: chunk.result }
              }
            }
            lastMsg.toolCalls = toolCalls
            break
          }

          case 'error':
            lastMsg.content = (lastMsg.content ?? '') + `\n\n错误: ${chunk.message}`
            if (lastPart && lastPart.type === 'text') {
              parts[parts.length - 1] = { ...lastPart, content: lastPart.content + `\n\n错误: ${chunk.message}` }
            } else {
              parts.push({ type: 'text', content: `\n\n错误: ${chunk.message}` })
            }
            break

          case 'finish': {
            if (lastMsg.toolCalls) {
              lastMsg.toolCalls = lastMsg.toolCalls.map((tc) =>
                tc.status === 'calling' ? { ...tc, status: 'error', error: '未收到执行结果' } : tc
              )
            }
            break
          }
        }

        lastMsg.parts = parts

        messages[messages.length - 1] = lastMsg
        return { ...s, messages }
      })
    }

    updateSession(sessionId, (s) => {
      const messages = [...s.messages]
      const lastMsg = { ...messages[messages.length - 1] }
      if (lastMsg.toolCalls) {
        lastMsg.toolCalls = lastMsg.toolCalls.map((tc) =>
          tc.status === 'calling' ? { ...tc, status: 'error', error: '未收到执行结果' } : tc
        )
      }
      if (pendingSqlConfirm) {
        lastMsg.sqlConfirm = { ...pendingSqlConfirm, status: 'pending' as const }
      }
      messages[messages.length - 1] = lastMsg
      return { ...s, messages }
    })

    return hasSqlConfirm
  }, [updateSession, model, apiKey, getFullConnection])

  const markTaskComplete = useCallback((sessionId: string) => {
    updateSession(sessionId, (s) => {
      const messages = [...s.messages]
      const duration = Date.now() - (s.taskStartTime ?? Date.now())

      let lastUserIdx = -1
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user') {
          lastUserIdx = i
          break
        }
      }

      let queryCount = 0
      for (let i = lastUserIdx + 1; i < messages.length; i++) {
        if (messages[i].role === 'assistant') {
          queryCount += messages[i].toolCalls?.length ?? 0
        }
      }

      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'assistant') {
          messages[i] = {
            ...messages[i],
            answerDuration: duration,
            answerQueryCount: queryCount,
          }
          break
        }
      }

      return { ...s, messages, taskEndTime: Date.now() }
    })
  }, [updateSession])

  const sendMessage = useCallback(async (content: string) => {
    if (!activeConnectionId || isStreaming) return

    setIsStreaming(true)
    const sessionId = getOrCreateSession()

    const userMessage: ChatMessage = {
      id: generateId(),
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
    }

    const assistantMessage: ChatMessage = {
      id: generateId(),
      role: 'assistant',
      content: '',
      thinking: '',
      toolCalls: [],
      timestamp: new Date().toISOString(),
    }

    updateSession(sessionId, (s) => ({
      ...s,
      messages: [...s.messages, userMessage, assistantMessage],
      title: s.messages.length === 0 ? content.slice(0, 20) : s.title,
      updatedAt: new Date().toISOString(),
      taskStartTime: Date.now(),
      taskEndTime: undefined,
    }))

    try {
      const history = sessionsRef.current.find((s) => s.id === sessionId)?.messages
        .filter((m) => m.content)
        .map((m) => ({ role: m.role, content: m.content })) ?? []

      const connection = getFullConnection(activeConnectionId)
      if (!connection) return

      const hasSqlConfirm = await processStream(sessionId, activeConnectionId, content, history)

      if (!hasSqlConfirm) {
        markTaskComplete(sessionId)
      }
    } catch (err) {
      updateSession(sessionId, (s) => {
        const messages = [...s.messages]
        const lastMsg = { ...messages[messages.length - 1] }
        lastMsg.content = `请求失败: ${err instanceof Error ? err.message : '未知错误'}`
        messages[messages.length - 1] = lastMsg
        return { ...s, messages }
      })
    } finally {
      setIsStreaming(false)
    }
  }, [activeConnectionId, isStreaming, getOrCreateSession, updateSession, processStream, markTaskComplete, getFullConnection])

  const continueWithSqlResult = useCallback(async (sessionId: string, connectionId: string, sql: string, result: SqlResultInfo): Promise<boolean> => {
    const resultSummary = formatSqlResultForAI(sql, result)

    const assistantMessage: ChatMessage = {
      id: generateId(),
      role: 'assistant',
      content: '',
      thinking: '',
      toolCalls: [],
      timestamp: new Date().toISOString(),
    }

    updateSession(sessionId, (s) => ({
      ...s,
      messages: [...s.messages, assistantMessage],
      updatedAt: new Date().toISOString(),
    }))

    const history = sessionsRef.current.find((s) => s.id === sessionId)?.messages
      .filter((m) => m.content)
      .map((m) => ({ role: m.role, content: m.content })) ?? []

    return await processStream(sessionId, connectionId, resultSummary, history)
  }, [updateSession, processStream])

  const continueWithSqlError = useCallback(async (sessionId: string, connectionId: string, sql: string, errorMsg: string): Promise<boolean> => {
    const errorSummary = [
      `以下SQL执行失败：`,
      '```sql',
      sql,
      '```',
      '',
      `错误信息: ${errorMsg}`,
      '',
      '请分析错误原因，修正SQL后重新生成。如果是字段名不存在，请先用 get_table_schema 确认正确的字段名。',
    ].join('\n')

    const assistantMessage: ChatMessage = {
      id: generateId(),
      role: 'assistant',
      content: '',
      thinking: '',
      toolCalls: [],
      timestamp: new Date().toISOString(),
    }

    updateSession(sessionId, (s) => ({
      ...s,
      messages: [...s.messages, assistantMessage],
      updatedAt: new Date().toISOString(),
    }))

    const history = sessionsRef.current.find((s) => s.id === sessionId)?.messages
      .filter((m) => m.content)
      .map((m) => ({ role: m.role, content: m.content })) ?? []

    return await processStream(sessionId, connectionId, errorSummary, history)
  }, [updateSession, processStream])

  const confirmSql = useCallback(async (messageId: string) => {
    if (!activeSessionId || !activeConnectionId) return

    const session = sessionsRef.current.find((s) => s.id === activeSessionId)
    const message = session?.messages.find((m) => m.id === messageId)
    if (!message?.sqlConfirm) return

    updateSession(activeSessionId, (s) => {
      const messages = s.messages.map((m) => {
        if (m.id === messageId && m.sqlConfirm) {
          return { ...m, sqlConfirm: { ...m.sqlConfirm, status: 'confirmed' as const } }
        }
        return m
      })
      return { ...s, messages }
    })

    try {
    const connection = getFullConnection(activeConnectionId)
    if (!connection) return

    const execResult = await confirmAndExecuteSql({
      data: {
        connection,
        sql: message.sqlConfirm.sql,
      },
    })

    if (!execResult.success) {
        updateSession(activeSessionId, (s) => {
          const messages = s.messages.map((m) => {
            if (m.id === messageId && m.sqlConfirm) {
              return { ...m, sqlConfirm: { ...m.sqlConfirm, status: 'error' as const, error: execResult.error } }
            }
            return m
          })
          return { ...s, messages }
        })

        setIsStreaming(true)
        try {
          const hasSqlConfirm = await continueWithSqlError(activeSessionId, activeConnectionId, message.sqlConfirm.sql, execResult.error)
          if (!hasSqlConfirm) {
            markTaskComplete(activeSessionId)
          }
        } finally {
          setIsStreaming(false)
        }
        return
      }

      const result = execResult.data

      updateSession(activeSessionId, (s) => {
        const messages = s.messages.map((m) => {
          if (m.id === messageId) {
            return {
              ...m,
              sqlConfirm: { ...m.sqlConfirm!, status: 'executed' as const },
              sqlResult: result,
            }
          }
          return m
        })
        return { ...s, messages }
      })

      setIsStreaming(true)
      try {
        const hasSqlConfirm = await continueWithSqlResult(activeSessionId, activeConnectionId, message.sqlConfirm.sql, result)
        if (!hasSqlConfirm) {
          markTaskComplete(activeSessionId)
        }
      } finally {
        setIsStreaming(false)
      }
    } catch {
      updateSession(activeSessionId, (s) => {
        const messages = s.messages.map((m) => {
          if (m.id === messageId && m.sqlConfirm) {
            return { ...m, sqlConfirm: { ...m.sqlConfirm, status: 'pending' as const } }
          }
          return m
        })
        return { ...s, messages }
      })
    }
  }, [activeSessionId, activeConnectionId, updateSession, continueWithSqlResult, continueWithSqlError, markTaskComplete, getFullConnection, confirmAndExecuteSql])

  const cancelSql = useCallback((messageId: string) => {
    if (!activeSessionId) return
    updateSession(activeSessionId, (s) => {
      const messages = s.messages.map((m) => {
        if (m.id === messageId && m.sqlConfirm) {
          return { ...m, sqlConfirm: { ...m.sqlConfirm, status: 'cancelled' as const } }
        }
        return m
      })
      return { ...s, messages }
    })
    markTaskComplete(activeSessionId)
  }, [activeSessionId, updateSession, markTaskComplete])

  const clearMessages = useCallback(() => {
    if (!activeSessionId) return
    updateSession(activeSessionId, (s) => ({ ...s, messages: [], taskStartTime: undefined, taskEndTime: undefined }))
  }, [activeSessionId, updateSession])

  const value: ChatState = {
    sessions,
    activeSessionId,
    activeSession,
    isStreaming,
    setActiveSession: handleSetActiveSession,
    createNewSession,
    deleteSession,
    sendMessage,
    clearMessages,
    confirmSql,
    cancelSql,
  }

  return (
    <ChatContext.Provider value={value}>
      {children}
    </ChatContext.Provider>
  )
}

function formatSqlResultForAI(sql: string, result: SqlResultInfo): string {
  const lines: string[] = [`以下SQL已执行完成：`, '```sql', sql, '```', '']
  lines.push(`执行耗时: ${result.executionTime}ms，返回 ${result.rowCount} 行`)
  lines.push('')

  if (result.rows.length > 0) {
    lines.push('结果数据：')
    const header = result.columns.join(' | ')
    lines.push(header)
    lines.push(result.columns.map(() => '---').join(' | '))
    for (const row of result.rows.slice(0, 50)) {
      lines.push(result.columns.map((col) => maskPII(String(row[col] ?? 'NULL'))).join(' | '))
    }
    if (result.rows.length > 50) {
      lines.push(`... 还有 ${result.rows.length - 50} 行未展示`)
    }
  } else {
    lines.push('查询无返回数据。')
  }

  lines.push('')
  lines.push('请基于以上执行结果分析并回答用户的问题。如果已有足够信息回答，请直接给出最终答案。如果确实还需要更多数据才能回答，可以继续生成SQL。')
  return lines.join('\n')
}

export function useChatStore(): ChatState {
  const ctx = useContext(ChatContext)
  if (!ctx) throw new Error('useChatStore must be used within ChatProvider')
  return ctx
}
