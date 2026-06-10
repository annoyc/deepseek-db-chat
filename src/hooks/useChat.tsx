import { useState, useCallback, useRef, useEffect, createContext, useContext } from 'react'
import type { ChatMessage, ChatSession, StreamChunk, ToolCallInfo, SqlResultInfo, MessagePart, ExecutionLogEntry, FilterValue, SuggestedFilter } from '@/lib/types'
import { generateId } from '@/lib/utils'
import { maskPII } from '@/lib/masking'
import { chatStream } from '@/server/functions/chat'
import { confirmAndExecuteSql } from '@/server/functions/confirm-sql'
import { classifyHallucination } from '@/server/functions/classify-hallucination'
import { generateAiTitle } from '@/server/functions/generate-title'
import { db } from '@/lib/db'
import { PROVIDERS, AVAILABLE_MODELS } from '@/lib/constants'
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
  renameSession: (id: string, title: string) => void
  sendMessage: (content: string) => Promise<void>
  stopStreaming: () => void
  clearMessages: () => void
  confirmSql: (messageId: string) => Promise<void>
  cancelSql: (messageId: string) => void
  confirmSmartFilter: (messageId: string, filterValues: Record<number, FilterValue>) => Promise<void>
  cancelSmartFilter: (messageId: string) => void
}

const ChatContext = createContext<ChatState | null>(null)

async function* parseSSEStream(response: Response, signal?: AbortSignal): AsyncGenerator<StreamChunk> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const onAbort = () => {
    reader.cancel().catch(() => {})
  }
  signal?.addEventListener('abort', onAbort)

  try {
    while (true) {
      if (signal?.aborted) return
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
    signal?.removeEventListener('abort', onAbort)
    reader.cancel().catch(() => {})
  }
}

async function loadSessionsFromStorage(): Promise<ChatSession[]> {
  if (typeof window === 'undefined') return []
  try {
    const sessions = await db.chatSessions.toArray()
    if (sessions.length > 0) {
      // 按 updatedAt 降序排列，确保最近活跃的 session 排在首位
      sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      return sessions
    }

    // IndexedDB 为空时尝试从旧版 localStorage 迁移残留数据
    const raw = window.localStorage.getItem('deepseek-chat-sessions')
    if (raw) {
      const restored: ChatSession[] = JSON.parse(raw)
      if (Array.isArray(restored) && restored.length > 0) {
        restored.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
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
        // Mark all existing sessions with messages as already having titles generated
        loaded.forEach((s) => {
          if (s.messages.length > 0) {
            titleGeneratedSessionsRef.current.add(s.id)
          }
        })
      }
      initialLoadDone.current = true
    })
  }, [])
  const [isStreaming, setIsStreaming] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  
  const { activeConnectionId, getFullConnection, setActiveConnection } = useDatabaseStore()
  const { provider, model, apiKey, baseURL, thinkingMode, sqlPermission, maxSqlExecutions } = useSettings()
  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions
  const processStreamRef = useRef<((...args: any[]) => Promise<boolean>) | null>(null)
  const titleGeneratedSessionsRef = useRef<Set<string>>(new Set())
  const loadingSessionConnIdRef = useRef<string | null | undefined>(undefined)
  const lastConfirmedSqlRef = useRef<string | null>(null)

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

  const renameSession = useCallback((id: string, title: string) => {
    setSessions((prev) => {
      const updated = prev.map((s) => s.id === id ? { ...s, title, updatedAt: new Date().toISOString() } : s)
      saveSessionsToStorage(updated)
      return updated
    })
  }, [])

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

  const processStream = useCallback(async (sessionId: string, connectionId: string, message: string, history: any[], retryCount: number = 0): Promise<boolean> => {
    let hasSqlConfirm = false
    let pendingSqlConfirm: { sql: string; explanation: string } | null = null
    let hasSmartFilterConfirm = false
    let pendingSmartFilterFilters: SuggestedFilter[] | null = null
    let hasToolCalls = false
    let assistantContent = ''

    const connection = getFullConnection(connectionId)
    if (!connection) throw new Error('数据库连接不存在')

    const currentSession = sessionsRef.current.find((s) => s.id === sessionId)
    const executionLog = currentSession?.executionLog

    const response = await chatStream({
      data: {
        connection, message, history, provider, model,
        apiKey: apiKey || undefined,
        baseURL: baseURL || undefined,
        thinkingMode, sqlPermission, executionLog,
        lastConfirmedSql: lastConfirmedSqlRef.current || undefined,
        sqlExecutedCount: executionLog?.length ?? 0,
        maxSqlExecutions,
      },
    })

    for await (const chunk of parseSSEStream(response as unknown as Response, abortControllerRef.current?.signal)) {
      if (chunk.type === 'tool-call-start' && chunk.name === 'execute_sql') {
        hasSqlConfirm = true
        pendingSqlConfirm = {
          sql: String(chunk.args?.sql ?? ''),
          explanation: String(chunk.args?.explanation ?? ''),
        }
        break
      }

      if (chunk.type === 'tool-call-start' && chunk.name === 'smart_filter') {
        // Show loading state immediately for smart_filter
        updateSession(sessionId, (s) => {
          const messages = [...s.messages]
          const lastMsg = { ...messages[messages.length - 1] }
          lastMsg.smartFilterConfirm = { suggestedFilters: [], status: 'loading' as const }
          messages[messages.length - 1] = lastMsg
          return { ...s, messages }
        })
      }

      if (chunk.type === 'smart-filter-confirm') {
        hasSmartFilterConfirm = true
        pendingSmartFilterFilters = chunk.suggestedFilters
        break
      }

      updateSession(sessionId, (s) => {
        const messages = [...s.messages]
        const lastMsg = { ...messages[messages.length - 1] }

        const parts: MessagePart[] = [...(lastMsg.parts ?? [])]
        const lastPart = parts.length > 0 ? parts[parts.length - 1] : null

        switch (chunk.type) {
          case 'thinking': {
            lastMsg.thinking = (lastMsg.thinking ?? '') + chunk.content
            if (lastPart && lastPart.type === 'thinking') {
              parts[parts.length - 1] = { ...lastPart, content: lastPart.content + chunk.content }
            } else {
              let merged = false
              for (let j = parts.length - 1; j >= 0; j--) {
                if (parts[j].type === 'thinking') {
                  parts[j] = { type: 'thinking', content: (parts[j] as { type: 'thinking'; content: string }).content + chunk.content }
                  merged = true
                  break
                }
                if (parts[j].type === 'tool-call') break
              }
              if (!merged) parts.push({ type: 'thinking', content: chunk.content })
            }
            break
          }

          case 'text': {
            lastMsg.content = (lastMsg.content ?? '') + chunk.content
            assistantContent += chunk.content
            if (lastPart && lastPart.type === 'text') {
              parts[parts.length - 1] = { ...lastPart, content: lastPart.content + chunk.content }
            } else {
              let merged = false
              for (let j = parts.length - 1; j >= 0; j--) {
                if (parts[j].type === 'text') {
                  parts[j] = { type: 'text', content: (parts[j] as { type: 'text'; content: string }).content + chunk.content }
                  merged = true
                  break
                }
                if (parts[j].type === 'tool-call') break
              }
              if (!merged) parts.push({ type: 'text', content: chunk.content })
            }
            break
          }

          case 'tool-call-start': {
            hasToolCalls = true
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

    // Clean up any tool calls still in 'calling' state
    updateSession(sessionId, (s) => {
      const messages = [...s.messages]
      const lastMsg = { ...messages[messages.length - 1] }
      if (lastMsg.toolCalls) {
        lastMsg.toolCalls = lastMsg.toolCalls.map((tc) =>
          tc.status === 'calling' ? { ...tc, status: 'error', error: '未收到执行结果' } : tc
        )
      }
      messages[messages.length - 1] = lastMsg
      return { ...s, messages }
    })

    if (pendingSqlConfirm || pendingSmartFilterFilters) {
      updateSession(sessionId, (s) => {
        const messages = [...s.messages]
        const lastMsg = { ...messages[messages.length - 1] }
        if (pendingSqlConfirm) {
          lastMsg.sqlConfirm = { ...pendingSqlConfirm, status: 'pending' as const }
        }
        if (pendingSmartFilterFilters) {
          lastMsg.smartFilterConfirm = { suggestedFilters: pendingSmartFilterFilters, status: 'pending' as const }
        }
        messages[messages.length - 1] = lastMsg
        return { ...s, messages }
      })
    }

    // Detect hallucination: check if assistant's text contains fabricated execution results
    // isContinuation: true when the model has access to real SQL execution data,
    // either from the current message (SQL result feedback) or from previous executions
    // in this session (the execution log is part of the model's system prompt context).
    const isSqlResultMessage = /^以下SQL(?:已执行完成|执行失败)/.test(message)
    const hasExecutionHistory = (executionLog?.length ?? 0) > 0
    const isContinuation = isSqlResultMessage || hasExecutionHistory
    if (retryCount < 1 && !hasSqlConfirm && !hasSmartFilterConfirm && assistantContent.length > 30) {
      try {
        const classification = await classifyHallucination({
          data: {
            assistantContent,
            hasToolCalls,
            isContinuation,
            provider,
            model,
            apiKey: apiKey || undefined,
            baseURL: baseURL || undefined,
          },
        })

        if (classification.hasFakeResult) {
          // Clear hallucinated content so user doesn't see it
          updateSession(sessionId, (s) => {
            const messages = [...s.messages]
            const lastMsg = { ...messages[messages.length - 1] }
            lastMsg.content = ''
            lastMsg.parts = []
            lastMsg.toolCalls = []
            messages[messages.length - 1] = lastMsg
            return { ...s, messages }
          })

          const correctiveMessage = '你刚才的回复中包含了编造的执行结果。你没有直接执行SQL的能力，所有SQL必须通过 execute_sql 工具提交给用户确认后才能执行。请重新分析用户需求，正确使用 execute_sql 工具提交SQL，调用后立即停止回复。如果需要了解表结构，可以先调用 list_tables 和 get_table_schema。绝对禁止编造执行结果（如"删除成功"、"影响了N行"、具体返回数据等）。'
          const newHistory = [
            ...history,
            { role: 'assistant' as const, content: assistantContent },
            { role: 'user' as const, content: correctiveMessage },
          ]
          await processStreamRef.current!(sessionId, connectionId, correctiveMessage, newHistory, retryCount + 1)
          return hasSqlConfirm
        }
      } catch {
        // Classification failed, skip retry — fail safe
      }
    }

    return hasSqlConfirm || hasSmartFilterConfirm
  }, [updateSession, model, apiKey, thinkingMode, sqlPermission, maxSqlExecutions, getFullConnection])

  processStreamRef.current = processStream

  const generateAiTitleForSession = useCallback(async (sessionId: string) => {
    if (titleGeneratedSessionsRef.current.has(sessionId)) return

    const session = sessionsRef.current.find((s) => s.id === sessionId)
    if (!session || session.messages.length < 2) return

    titleGeneratedSessionsRef.current.add(sessionId)

    const userMsg = session.messages.find((m) => m.role === 'user')
    const assistantMsg = session.messages.find((m) => m.role === 'assistant')
    if (!userMsg || !assistantMsg) return

    try {
      const title = await generateAiTitle({
        data: {
          userMessage: userMsg.content,
          assistantContent: assistantMsg.content || '数据库查询操作',
          provider,
          model,
          apiKey: apiKey || undefined,
          baseURL: baseURL || undefined,
        },
      })
      updateSession(sessionId, (s) => {
        // Only overwrite if the title hasn't been manually renamed
        if (s.title !== userMsg.content.slice(0, 20)) return s
        return { ...s, title, updatedAt: new Date().toISOString() }
      })
    } catch {
      // Title generation failed, keep the initial truncated title
    }
  }, [updateSession, model, apiKey])

  const markTaskComplete = useCallback((sessionId: string) => {
    const providerName = PROVIDERS.find((p) => p.id === provider)?.name ?? provider
    const modelEntry = AVAILABLE_MODELS.find((m) => m.id === model && m.provider === provider)
    const modelLabel = modelEntry ? `${providerName} / ${modelEntry.name}` : model

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
            answerModel: modelLabel,
          }
          break
        }
      }

      return { ...s, messages, taskEndTime: Date.now() }
    })
  }, [updateSession, provider, model])

  const sendMessage = useCallback(async (content: string) => {
    if (!activeConnectionId || isStreaming) return

    setIsStreaming(true)
    abortControllerRef.current = new AbortController()
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
      const currentSession = sessionsRef.current.find((s) => s.id === sessionId)
      const history = buildApiHistory(currentSession?.messages ?? [])

      const connection = getFullConnection(activeConnectionId)
      if (!connection) return

      const hasSqlConfirm = await processStream(sessionId, activeConnectionId, content, history)

      if (!hasSqlConfirm) {
        markTaskComplete(sessionId)
        generateAiTitleForSession(sessionId)
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
  }, [activeConnectionId, isStreaming, getOrCreateSession, updateSession, processStream, markTaskComplete, generateAiTitleForSession, getFullConnection])

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

    const currentSession = sessionsRef.current.find((s) => s.id === sessionId)
    const history = buildApiHistory(currentSession?.messages ?? [])

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
      '【请按以下步骤自纠错】：',
      '1. 分析错误类型：',
      '   - "Unknown column" → 字段名错误，调用 get_table_schema 确认正确字段名',
      '   - "Table doesn\'t exist" → 表名错误，调用 get_database_overview 确认表名',
      '   - "You have an error in your SQL syntax" → 语法错误，检查 SQL 语法',
      '   - "Column count doesn\'t match" → INSERT 列数不匹配，重新核对列',
      '   - 其他错误 → 根据错误信息推理修复方案',
      '2. 根据分析结果修正 SQL',
      '3. 调用 execute_sql 提交修正后的 SQL',
      '重要：禁止盲目重试相同的 SQL，必须基于错误分析做出有针对性的修改。',
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

    const currentSession = sessionsRef.current.find((s) => s.id === sessionId)
    const history = buildApiHistory(currentSession?.messages ?? [])
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
        sqlPermission,
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
          const logEntry: ExecutionLogEntry = {
            sql: message.sqlConfirm!.sql,
            success: false,
            summary: `执行失败: ${execResult.error}`,
            timestamp: new Date().toISOString(),
          }
          const executionLog = [...(s.executionLog ?? []), logEntry]
          return { ...s, messages, executionLog }
        })

        setIsStreaming(true)
        abortControllerRef.current = new AbortController()
        try {
          const hasSqlConfirm = await continueWithSqlError(activeSessionId, activeConnectionId, message.sqlConfirm.sql, execResult.error)
          if (!hasSqlConfirm) {
            markTaskComplete(activeSessionId)
            generateAiTitleForSession(activeSessionId)
          }
        } finally {
          setIsStreaming(false)
        }
        return
      }

      const result = execResult.data

      // Track last confirmed SQL for cross-round dedup
      lastConfirmedSqlRef.current = message.sqlConfirm!.sql

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
        const logEntry: ExecutionLogEntry = {
          sql: message.sqlConfirm!.sql,
          success: true,
          summary: summarizeSqlResult(result),
          timestamp: new Date().toISOString(),
        }
        const executionLog = [...(s.executionLog ?? []), logEntry]
        return { ...s, messages, executionLog }
      })

      setIsStreaming(true)
      abortControllerRef.current = new AbortController()
      try {
        const hasSqlConfirm = await continueWithSqlResult(activeSessionId, activeConnectionId, message.sqlConfirm.sql, result)
        if (!hasSqlConfirm) {
          markTaskComplete(activeSessionId)
          generateAiTitleForSession(activeSessionId)
        }
      } finally {
        setIsStreaming(false)
      }
    } catch (err) {
      console.error('[confirmSql] Unexpected error:', err)
      setIsStreaming(false)
      updateSession(activeSessionId, (s) => {
        const messages = s.messages.map((m) => {
          if (m.id === messageId && m.sqlConfirm) {
            return { ...m, sqlConfirm: { ...m.sqlConfirm, status: 'error' as const, error: err instanceof Error ? err.message : 'SQL 执行过程中发生未知错误' } }
          }
          return m
        })
        return { ...s, messages }
      })
    }
  }, [activeSessionId, activeConnectionId, updateSession, continueWithSqlResult, continueWithSqlError, markTaskComplete, generateAiTitleForSession, getFullConnection, confirmAndExecuteSql, sqlPermission])

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

  // ── Smart Filter confirm/cancel ──
  const confirmSmartFilter = useCallback(async (messageId: string, filterValues: Record<number, FilterValue>) => {
    if (!activeSessionId || !activeConnectionId) return

    const session = sessionsRef.current.find((s) => s.id === activeSessionId)
    const message = session?.messages.find((m) => m.id === messageId)
    if (!message?.smartFilterConfirm) return

    const msgIndex = session?.messages.findIndex((m) => m.id === messageId) ?? -1
    const userMsg = msgIndex > 0 ? session?.messages[msgIndex - 1] : null
    const originalQuery = userMsg?.role === 'user' ? userMsg.content : ''

    // Update status to confirmed and store values
    updateSession(activeSessionId, (s) => {
      const messages = s.messages.map((m) => {
        if (m.id === messageId && m.smartFilterConfirm) {
          return { ...m, smartFilterConfirm: { ...m.smartFilterConfirm, status: 'confirmed' as const }, smartFilterValues: filterValues }
        }
        return m
      })
      return { ...s, messages }
    })

    // Build enhanced prompt from filter values
    const enhancedPrompt = buildEnhancedPrompt(originalQuery, message.smartFilterConfirm.suggestedFilters, filterValues)

    const assistantMessage: ChatMessage = {
      id: generateId(),
      role: 'assistant',
      content: '',
      thinking: '',
      toolCalls: [],
      timestamp: new Date().toISOString(),
    }

    updateSession(activeSessionId, (s) => ({
      ...s,
      messages: [...s.messages, assistantMessage],
      updatedAt: new Date().toISOString(),
    }))

    setIsStreaming(true)
    abortControllerRef.current = new AbortController()

    updateSession(activeSessionId, (s) => {
      const messages = s.messages.map((m) => {
        if (m.id === messageId && m.smartFilterConfirm?.status === 'confirmed') {
          return { ...m, smartFilterConfirm: { ...m.smartFilterConfirm, status: 'done' as const } }
        }
        return m
      })
      return { ...s, messages }
    })

    try {
      const currentSession = sessionsRef.current.find((s) => s.id === activeSessionId)
      const history = buildApiHistory(currentSession?.messages ?? [])
      const connection = getFullConnection(activeConnectionId)
      if (!connection) return

      const hasSqlConfirm = await processStream(activeSessionId, activeConnectionId, enhancedPrompt, history)
      if (!hasSqlConfirm) {
        markTaskComplete(activeSessionId)
        generateAiTitleForSession(activeSessionId)
      }
    } finally {
      setIsStreaming(false)
    }
  }, [activeSessionId, activeConnectionId, updateSession, processStream, markTaskComplete, generateAiTitleForSession, getFullConnection])

  const cancelSmartFilter = useCallback(async (messageId: string) => {
    if (!activeSessionId || !activeConnectionId) return

    // Update status to cancelled
    updateSession(activeSessionId, (s) => {
      const messages = s.messages.map((m) => {
        if (m.id === messageId && m.smartFilterConfirm) {
          return { ...m, smartFilterConfirm: { ...m.smartFilterConfirm, status: 'cancelled' as const } }
        }
        return m
      })
      return { ...s, messages }
    })

    // Continue conversation without filter parameters
    const assistantMessage: ChatMessage = {
      id: generateId(),
      role: 'assistant',
      content: '',
      thinking: '',
      toolCalls: [],
      timestamp: new Date().toISOString(),
    }

    updateSession(activeSessionId, (s) => ({
      ...s,
      messages: [...s.messages, assistantMessage],
      updatedAt: new Date().toISOString(),
    }))

    setIsStreaming(true)
    abortControllerRef.current = new AbortController()

    try {
      const currentSession = sessionsRef.current.find((s) => s.id === activeSessionId)
      const history = buildApiHistory(currentSession?.messages ?? [])
      const connection = getFullConnection(activeConnectionId)
      if (!connection) return

      const hasSqlConfirm = await processStream(activeSessionId, activeConnectionId, '请继续帮我查询，不需要调整筛选参数。', history)
      if (!hasSqlConfirm) {
        markTaskComplete(activeSessionId)
        generateAiTitleForSession(activeSessionId)
      }
    } finally {
      setIsStreaming(false)
    }
  }, [activeSessionId, activeConnectionId, updateSession, processStream, markTaskComplete, generateAiTitleForSession, getFullConnection])

  const stopStreaming = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null

    const sessionId = activeSessionId
    if (!sessionId) return

    updateSession(sessionId, (s) => {
      const messages = [...s.messages]
      const lastMsg = { ...messages[messages.length - 1] }
      if (lastMsg.role !== 'assistant') return s

      if (lastMsg.toolCalls) {
        lastMsg.toolCalls = lastMsg.toolCalls.map((tc) =>
          tc.status === 'calling' ? { ...tc, status: 'error', error: '已取消' } : tc
        )
      }

      const stopNote = '\n\n*已停止生成*'
      lastMsg.content = (lastMsg.content ?? '') + stopNote
      if (lastMsg.parts && lastMsg.parts.length > 0) {
        const parts = [...lastMsg.parts]
        const lastPart = parts[parts.length - 1]
        if (lastPart.type === 'text') {
          parts[parts.length - 1] = { ...lastPart, content: lastPart.content + stopNote }
        } else {
          parts.push({ type: 'text', content: stopNote })
        }
        lastMsg.parts = parts
      } else {
        lastMsg.parts = [{ type: 'text', content: stopNote }]
      }

      messages[messages.length - 1] = lastMsg
      return { ...s, messages, taskEndTime: Date.now() }
    })

    setIsStreaming(false)
  }, [activeSessionId, updateSession])

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
    renameSession,
    sendMessage,
    stopStreaming,
    clearMessages,
    confirmSql,
    cancelSql,
    confirmSmartFilter,
    cancelSmartFilter,
  }

  return (
    <ChatContext.Provider value={value}>
      {children}
    </ChatContext.Provider>
  )
}

/**
 * Convert app ChatMessage[] into API-format history messages that
 * include tool_calls and tool result messages.
 * Execution log is injected via system prompt in agent.ts, not here.
 */
function buildApiHistory(
  messages: ChatMessage[],
): Array<Record<string, unknown>> {
  const apiMessages: Array<Record<string, unknown>> = []
  let callIdCounter = 0

  for (const msg of messages) {
    if (msg.role === 'user') {
      if (msg.content) {
        apiMessages.push({ role: 'user', content: msg.content })
      }
      continue
    }

    if (msg.role === 'assistant') {
      const toolCalls = msg.toolCalls ?? []
      const hasVisibleToolCalls = toolCalls.filter((tc) => tc.name !== 'execute_sql' && tc.name !== 'smart_filter').length > 0

      if (hasVisibleToolCalls) {
        // Assistant message with tool calls (excluding execute_sql and smart_filter which have special flows)
        const visibleCalls = toolCalls.filter((tc) => tc.name !== 'execute_sql' && tc.name !== 'smart_filter')
        const syntheticToolCalls = visibleCalls.map((tc) => ({
          id: `call_${++callIdCounter}`,
          type: 'function',
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.args),
          },
        }))

        apiMessages.push({
          role: 'assistant',
          content: msg.content || null,
          tool_calls: syntheticToolCalls,
        })

        // Tool result messages
        for (let i = 0; i < visibleCalls.length; i++) {
          const tc = visibleCalls[i]
          apiMessages.push({
            role: 'tool',
            content: tc.result || tc.error || '工具调用完成',
            tool_call_id: syntheticToolCalls[i].id,
          })
        }
      } else if (msg.content) {
        // Regular assistant message (text only, or execute_sql-only which follows a different flow)
        apiMessages.push({ role: 'assistant', content: msg.content })
      }
    }
  }

  return apiMessages
}

function summarizeSqlResult(result: SqlResultInfo): string {
  if (result.rows.length > 0) {
    const row = result.rows[0]
    if (row.insertId !== undefined) {
      const affectedRows = Number(row.affectedRows ?? 0)
      const insertId = Number(row.insertId ?? 0)
      let summary = `影响了 ${affectedRows} 行`
      if (insertId > 0) summary += `，新记录 insertId = ${insertId}`
      return summary
    }
    return `返回 ${result.rowCount} 行，耗时 ${result.executionTime}ms`
  }
  return '查询无返回数据'
}

/**
 * Build an enhanced prompt from smart filter values.
 * Formats user-adjusted filter parameters as structured text
 * that the AI agent can use to generate more precise SQL.
 */
function buildEnhancedPrompt(originalQuery: string, filters: SuggestedFilter[], values: Record<number, FilterValue>): string {
  const paramLines: string[] = []

  for (const [index, filter] of filters.entries()) {
    const fv = values[index]
    if (!fv) continue

    switch (filter.type) {
      case 'date_range':
        if (fv.dateRange) {
          paramLines.push(`- 时间范围: ${filter.table}.${filter.column} BETWEEN '${fv.dateRange.start}' AND '${fv.dateRange.end}'`)
        }
        break
      case 'enum_select':
        if (fv.enumValue) {
          paramLines.push(`- 筛选条件: ${filter.table}.${filter.column} = '${fv.enumValue}'`)
        }
        break
      case 'option_select':
        if (fv.optionValue) {
          paramLines.push(`- ${filter.label}: ${fv.optionValue}`)
        }
        break
      case 'aggregation':
        if (fv.aggregation) {
          const groupByHint: Record<string, string> = {
            '按日': `DATE(${filter.table}.${filter.column})`,
            '按周': `YEARWEEK(${filter.table}.${filter.column})`,
            '按月': `DATE_FORMAT(${filter.table}.${filter.column}, '%Y-%m')`,
            '按季度': `CONCAT(YEAR(${filter.table}.${filter.column}), '-Q', QUARTER(${filter.table}.${filter.column}))`,
            '按年': `YEAR(${filter.table}.${filter.column})`,
          }
          const groupExpr = groupByHint[fv.aggregation] ?? fv.aggregation
          paramLines.push(`- 聚合方式: ${fv.aggregation} (GROUP BY ${groupExpr})`)
        }
        break
    }
  }

  if (paramLines.length === 0) return '请继续帮我查询。'

  return `用户已确认筛选参数，请基于以下结构化参数生成精确的 SQL 查询：\n\n原始查询: ${originalQuery}\n\n[筛选参数]\n${paramLines.join('\n')}`
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

    // Explicitly surface insertId for write operations (not masked, always reliable)
    const insertId = Number(result.rows[0]?.insertId ?? 0)
    if (insertId > 0) {
      lines.push('')
      lines.push(`⚠️ 本次 INSERT 的真实 insertId = ${insertId}。后续如需 UPDATE/DELETE/SELECT 该记录，请使用此 ID。`)
    }
  } else {
    lines.push('查询无返回数据。')
  }

  lines.push('')

  const isWriteOperation = /^\s*(INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|CREATE|TRUNCATE)\s/i.test(sql.trim())
  if (isWriteOperation) {
    lines.push('以上写操作已成功执行。请直接基于此结果给出最终回复，告知用户操作结果。除非用户明确要求执行更多操作，否则不要再生成新的SQL。')
  } else {
    lines.push('请基于以上执行结果分析并回答用户的问题。如果已有足够信息回答，请直接给出最终答案。如果确实还需要更多数据才能回答，可以继续生成SQL。')
  }

  return lines.join('\n')
}

export function useChatStore(): ChatState {
  const ctx = useContext(ChatContext)
  if (!ctx) throw new Error('useChatStore must be used within ChatProvider')
  return ctx
}
