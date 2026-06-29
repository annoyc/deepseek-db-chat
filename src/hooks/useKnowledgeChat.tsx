import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { db } from '@/lib/db'
import { generateId } from '@/lib/utils'
import type {
  KnowledgeAnswerMode,
  KnowledgeChatInput,
  KnowledgeEvidence,
  KnowledgeMessage,
  KnowledgeSession,
  KnowledgeStreamChunk,
} from '@/lib/knowledge-types'
import { knowledgeChatStream } from '@/server/functions/knowledge-chat'

interface KnowledgeChatState {
  sessions: KnowledgeSession[]
  activeSessionId: string | null
  activeSession: KnowledgeSession | null
  activeEvidenceMessage: KnowledgeMessage | null
  selectedEvidenceMessageId: string | null
  isStreaming: boolean
  useWebSearch: boolean
  useBaseModel: boolean
  answerMode: KnowledgeAnswerMode
  setUseWebSearch: (value: boolean) => void
  setUseBaseModel: (value: boolean) => void
  setAnswerMode: (value: KnowledgeAnswerMode) => void
  setActiveSession: (id: string) => void
  setSelectedEvidenceMessage: (id: string | null) => void
  createNewSession: () => void
  deleteSession: (id: string) => void
  sendMessage: (content: string) => Promise<void>
  stopStreaming: () => void
  clearMessages: () => void
}

const KnowledgeChatContext = createContext<KnowledgeChatState | null>(null)

function createEmptyEvidence(): KnowledgeEvidence {
  return { subQuestions: [], memorySnippets: [], webResults: [], progress: [] }
}

function createAssistantMessage(): KnowledgeMessage {
  return {
    id: generateId(),
    role: 'assistant',
    content: '',
    timestamp: new Date().toISOString(),
    statusText: '准备知识问答任务...',
    evidence: createEmptyEvidence(),
  }
}

async function* parseSSEStream(response: Response, signal?: AbortSignal): AsyncGenerator<KnowledgeStreamChunk> {
  if (!response.body) return
  const reader = response.body.getReader()
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
        if (!line.startsWith('data: ')) continue
        const jsonStr = line.slice(6)
        if (jsonStr === '[DONE]') return
        try {
          yield JSON.parse(jsonStr) as KnowledgeStreamChunk
        } catch {}
      }
    }
  } finally {
    signal?.removeEventListener('abort', onAbort)
    reader.cancel().catch(() => {})
  }
}

async function loadSessions(): Promise<KnowledgeSession[]> {
  if (typeof window === 'undefined') return []
  try {
    const sessions = await db.knowledgeSessions.toArray()
    sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    return sessions
  } catch (err) {
    console.warn('[useKnowledgeChat] Failed to load sessions:', err)
    return []
  }
}

async function saveSessions(sessions: KnowledgeSession[]) {
  if (typeof window === 'undefined') return
  try {
    const toSave = sessions.map((s) => ({ ...s, messages: s.messages.slice(-80) }))
    await db.transaction('rw', db.knowledgeSessions, async () => {
      await db.knowledgeSessions.clear()
      if (toSave.length > 0) await db.knowledgeSessions.bulkPut(toSave)
    })
  } catch (err) {
    console.warn('[useKnowledgeChat] Failed to save sessions:', err)
  }
}

function mergeEvidence(current: KnowledgeEvidence | undefined, chunk: Extract<KnowledgeStreamChunk, { type: 'evidence' }>): KnowledgeEvidence {
  const evidence = current ? { ...current } : createEmptyEvidence()
  evidence.subQuestions = chunk.subQuestions ?? evidence.subQuestions
  evidence.memorySnippets = chunk.memorySnippets ?? evidence.memorySnippets
  evidence.webResults = chunk.webResults ?? evidence.webResults
  evidence.progress = current?.progress ?? []
  return evidence
}

function getTitle(content: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim()
  return normalized.slice(0, 24) || '新问答'
}

export function KnowledgeChatProvider({ children }: { children: React.ReactNode }) {
  const [sessions, setSessions] = useState<KnowledgeSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [selectedEvidenceMessageId, setSelectedEvidenceMessageId] = useState<string | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)
  const [useWebSearch, setUseWebSearchState] = useState(false)
  const [useBaseModel, setUseBaseModelState] = useState(true)
  const [answerMode, setAnswerMode] = useState<KnowledgeAnswerMode>('standard')
  const loadedRef = useRef(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sessionsRef = useRef(sessions)
  const abortControllerRef = useRef<AbortController | null>(null)

  sessionsRef.current = sessions

  useEffect(() => {
    loadSessions().then((loaded) => {
      setSessions(loaded)
      setActiveSessionId(loaded[0]?.id ?? null)
      loadedRef.current = true
    })
  }, [])

  useEffect(() => {
    if (!loadedRef.current) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => saveSessions(sessions), 700)
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [sessions])

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null

  const activeEvidenceMessage = useMemo(() => {
    if (!activeSession) return null
    if (selectedEvidenceMessageId) {
      return activeSession.messages.find((m) => m.id === selectedEvidenceMessageId) ?? null
    }
    for (let i = activeSession.messages.length - 1; i >= 0; i--) {
      const msg = activeSession.messages[i]
      if (msg.role === 'assistant' && msg.evidence) return msg
    }
    return null
  }, [activeSession, selectedEvidenceMessageId])

  const updateSession = useCallback((sessionId: string, updater: (session: KnowledgeSession) => KnowledgeSession) => {
    setSessions((prev) => prev.map((s) => (s.id === sessionId ? updater(s) : s)))
  }, [])

  const getOrCreateSession = useCallback(() => {
    if (activeSessionId && sessionsRef.current.some((s) => s.id === activeSessionId)) return activeSessionId

    const now = new Date().toISOString()
    const newSession: KnowledgeSession = {
      id: generateId(),
      title: '新问答',
      messages: [],
      createdAt: now,
      updatedAt: now,
    }
    setSessions((prev) => [newSession, ...prev])
    setActiveSessionId(newSession.id)
    return newSession.id
  }, [activeSessionId])

  const createNewSession = useCallback(() => {
    const current = sessionsRef.current.find((s) => s.id === activeSessionId)
    if (current && current.messages.length === 0) return

    const now = new Date().toISOString()
    const session: KnowledgeSession = {
      id: generateId(),
      title: '新问答',
      messages: [],
      createdAt: now,
      updatedAt: now,
    }
    setSessions((prev) => [session, ...prev])
    setActiveSessionId(session.id)
    setSelectedEvidenceMessageId(null)
  }, [activeSessionId])

  const deleteSession = useCallback((id: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== id))
    if (activeSessionId === id) {
      const next = sessionsRef.current.find((s) => s.id !== id)
      setActiveSessionId(next?.id ?? null)
      setSelectedEvidenceMessageId(null)
    }
  }, [activeSessionId])

  const setActiveSession = useCallback((id: string) => {
    setActiveSessionId(id)
    setSelectedEvidenceMessageId(null)
  }, [])

  const setUseBaseModel = useCallback((value: boolean) => {
    setUseBaseModelState(value)
    if (!value) setUseWebSearchState(false)
  }, [])

  const setUseWebSearch = useCallback((value: boolean) => {
    if (!useBaseModel && value) return
    setUseWebSearchState(value)
  }, [useBaseModel])

  const sendMessage = useCallback(async (content: string) => {
    const trimmed = content.trim()
    if (!trimmed || isStreaming) return

    const sessionId = getOrCreateSession()
    const now = new Date().toISOString()
    const userMessage: KnowledgeMessage = {
      id: generateId(),
      role: 'user',
      content: trimmed,
      timestamp: now,
    }
    const assistantMessage = createAssistantMessage()

    setIsStreaming(true)
    abortControllerRef.current = new AbortController()
    setSelectedEvidenceMessageId(assistantMessage.id)

    updateSession(sessionId, (s) => ({
      ...s,
      title: s.messages.length === 0 ? getTitle(trimmed) : s.title,
      messages: [...s.messages, userMessage, assistantMessage],
      updatedAt: now,
      taskStartTime: Date.now(),
      taskEndTime: undefined,
    }))

    const input: KnowledgeChatInput = {
      message: trimmed,
      useWebSearch,
      useBaseModel,
      answerMode,
    }

    try {
      const response = await knowledgeChatStream({ data: input })
      for await (const chunk of parseSSEStream(response as unknown as Response, abortControllerRef.current.signal)) {
        updateSession(sessionId, (s) => {
          const messages = [...s.messages]
          const last = { ...messages[messages.length - 1] }
          const evidence = last.evidence ?? createEmptyEvidence()

          if (chunk.type === 'status') {
            last.statusText = chunk.message
            last.evidence = {
              ...evidence,
              progress: evidence.progress.includes(chunk.message)
                ? evidence.progress
                : [...evidence.progress, chunk.message],
            }
          }

          if (chunk.type === 'text') {
            last.content += chunk.content
          }

          if (chunk.type === 'evidence') {
            last.evidence = mergeEvidence(last.evidence, chunk)
          }

          if (chunk.type === 'error') {
            last.error = chunk.message
            last.content = last.content || `请求失败: ${chunk.message}`
          }

          if (chunk.type === 'finish') {
            last.statusText = undefined
          }

          messages[messages.length - 1] = last
          return { ...s, messages, updatedAt: new Date().toISOString() }
        })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '知识库问答请求失败'
      updateSession(sessionId, (s) => {
        const messages = [...s.messages]
        const last = { ...messages[messages.length - 1] }
        last.error = message
        last.content = last.content || `请求失败: ${message}`
        last.statusText = undefined
        messages[messages.length - 1] = last
        return { ...s, messages }
      })
    } finally {
      setIsStreaming(false)
      updateSession(sessionId, (s) => ({ ...s, taskEndTime: Date.now() }))
    }
  }, [answerMode, getOrCreateSession, isStreaming, updateSession, useBaseModel, useWebSearch])

  const stopStreaming = useCallback(() => {
    abortControllerRef.current?.abort()
    setIsStreaming(false)
    const sessionId = activeSessionId
    if (!sessionId) return
    updateSession(sessionId, (s) => {
      const messages = [...s.messages]
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'assistant') {
          messages[i] = { ...messages[i], statusText: undefined, error: messages[i].content ? undefined : '已停止生成' }
          break
        }
      }
      return { ...s, messages, taskEndTime: Date.now() }
    })
  }, [activeSessionId, updateSession])

  const clearMessages = useCallback(() => {
    if (!activeSessionId) return
    updateSession(activeSessionId, (s) => ({ ...s, messages: [], updatedAt: new Date().toISOString() }))
    setSelectedEvidenceMessageId(null)
  }, [activeSessionId, updateSession])

  const value: KnowledgeChatState = {
    sessions,
    activeSessionId,
    activeSession,
    activeEvidenceMessage,
    selectedEvidenceMessageId,
    isStreaming,
    useWebSearch,
    useBaseModel,
    answerMode,
    setUseWebSearch,
    setUseBaseModel,
    setAnswerMode,
    setActiveSession,
    setSelectedEvidenceMessage: setSelectedEvidenceMessageId,
    createNewSession,
    deleteSession,
    sendMessage,
    stopStreaming,
    clearMessages,
  }

  return <KnowledgeChatContext.Provider value={value}>{children}</KnowledgeChatContext.Provider>
}

export function useKnowledgeChatStore(): KnowledgeChatState {
  const ctx = useContext(KnowledgeChatContext)
  if (!ctx) throw new Error('useKnowledgeChatStore must be used within KnowledgeChatProvider')
  return ctx
}
