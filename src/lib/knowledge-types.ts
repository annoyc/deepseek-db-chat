export type KnowledgeRole = 'user' | 'assistant'

export type KnowledgeAnswerMode = 'concise' | 'standard' | 'deep'

export interface KnowledgeMemorySnippet {
  question: string
  answer: string
}

export interface KnowledgeWebResult {
  title: string
  url: string
  snippet?: string
  site_name?: string
}

export type KnowledgeToolStatus = 'running' | 'done' | 'error'

/**
 * A single node in the backend's tool-use chain (工具使用链). The backend emits
 * one of these per pipeline step (safety, query rewrite, intent analysis,
 * memory retrieval, web search, synthesis...), first as `running` and later
 * re-emitted as `done`/`error`. The UI renders them as an ordered timeline.
 */
export interface KnowledgeToolStep {
  id: string
  /** Machine name used to pick an icon/accent: guardrail, query_rewrite, ... */
  name: string
  /** Human-readable label shown in the timeline. */
  title: string
  status: KnowledgeToolStatus
  /** Optional input / context preview for the step. */
  detail?: string
  /** Optional output preview once the step completes. */
  output?: string
  durationMs?: number
}

export interface KnowledgeEvidence {
  subQuestions: string[]
  memorySnippets: KnowledgeMemorySnippet[]
  webResults: KnowledgeWebResult[]
  progress: string[]
  toolSteps: KnowledgeToolStep[]
}

export interface KnowledgeMessage {
  id: string
  role: KnowledgeRole
  content: string
  timestamp: string
  statusText?: string
  evidence?: KnowledgeEvidence
  error?: string
}

export interface KnowledgeSession {
  id: string
  title: string
  messages: KnowledgeMessage[]
  createdAt: string
  updatedAt: string
  taskStartTime?: number
  taskEndTime?: number
}

export type KnowledgeStreamChunk =
  | { type: 'status'; message: string }
  | { type: 'text'; content: string }
  | {
      type: 'tool'
      id: string
      name: string
      title: string
      status: KnowledgeToolStatus
      detail?: string
      output?: string
      durationMs?: number
    }
  | {
      type: 'evidence'
      subQuestions?: string[]
      memorySnippets?: KnowledgeMemorySnippet[]
      webResults?: KnowledgeWebResult[]
    }
  | { type: 'error'; message: string }
  | { type: 'finish' }

export interface KnowledgeHistoryTurn {
  role: KnowledgeRole
  content: string
}

export interface KnowledgeChatInput {
  message: string
  useWebSearch: boolean
  useBaseModel: boolean
  answerMode: KnowledgeAnswerMode
  history?: KnowledgeHistoryTurn[]
}

export interface KnowledgeHealth {
  status: 'ok' | 'offline'
  lmModel?: string
  webSearchAvailable?: boolean
  backendBase?: string
  error?: string
}
