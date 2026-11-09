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

export type KnowledgeDocumentStatus = 'active' | 'expired' | 'pending'

/** One retrieved provision, numbered as the answer cites it ([1], [2], ...). */
export interface KnowledgeCitation {
  /** Citation number as written in the answer, without brackets. */
  ref: string
  chunkId: string
  docTitle: string
  docNo?: string
  /** Article or glossary entry, e.g. 第七十七条. */
  locator: string
  headings: string[]
  text: string
  status: KnowledgeDocumentStatus
  statusLabel: string
  sourceUrl?: string
  /** Which retrievers found it. */
  retrievers: ('keyword' | 'vector')[]
  /** Set once the answer is complete: whether the answer actually cites it. */
  cited?: boolean
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
  /** Knowledge-base provisions the answer may cite; absent for remote-backend answers. */
  citations?: KnowledgeCitation[]
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
      citations?: KnowledgeCitation[]
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
  /** Answer model settings, as in the database workbench; the remote backend ignores them. */
  provider?: string
  model?: string
  apiKey?: string
  baseURL?: string
}

export interface KnowledgeIndexInfo {
  documents: number
  chunks: number
  /** hybrid: keyword + vector; keyword: the index has no vectors or the server lacks the embedding key. */
  retrieval: 'hybrid' | 'keyword'
}

export interface KnowledgeHealth {
  status: 'ok' | 'offline'
  /** local: in-process RAG over the bundled index; remote: the MEMO_CHAT_API_BASE service. */
  mode?: 'local' | 'remote'
  index?: KnowledgeIndexInfo
  lmModel?: string
  webSearchAvailable?: boolean
  backendBase?: string
  error?: string
}
