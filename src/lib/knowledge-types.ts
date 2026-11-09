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

/** unverified: a document the user uploaded, whose dates and authority are unknown. */
export type KnowledgeDocumentStatus = 'active' | 'expired' | 'pending' | 'unverified'

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
  /** builtin: the bundled regulation corpus; upload: a document from the user's browser. */
  source?: 'builtin' | 'upload'
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
  /** Candidate chunks from the user's uploaded documents, pre-selected in the browser. */
  userChunks?: KnowledgeUserChunkCandidate[]
  /** Default (built-in) documents the user removed from their knowledge base. */
  excludedDefaultIds?: string[]
  /** Answer model settings, as in the database workbench; the remote backend ignores them. */
  provider?: string
  model?: string
  apiKey?: string
  baseURL?: string
}

export type KnowledgeUploadKind = 'pdf' | 'docx' | 'md' | 'txt'

export interface KnowledgeUploadChunk {
  id: string
  headings: string[]
  label: string
  text: string
  /** Base64 unit-length Float32 vector, when the server embedded the upload. */
  vector?: string
}

/** A document uploaded by the user; parsed on the server, stored only in this browser. */
export interface KnowledgeUploadedDocument {
  id: string
  name: string
  title: string
  kind: KnowledgeUploadKind
  size: number
  charCount: number
  uploadedAt: string
  chunks: KnowledgeUploadChunk[]
  /** `provider:model:dimensions` of the chunk vectors; absent for keyword-only documents. */
  embeddingKey?: string
  warning?: string
}

export interface KnowledgeUserChunkCandidate {
  id: string
  docId: string
  docTitle: string
  headings: string[]
  label: string
  text: string
  vector?: string
  embeddingKey?: string
}

export interface KnowledgeUploadLimits {
  /** Largest accepted file, in bytes. */
  maxBytes: number
  /** Most characters of extracted text per document. */
  maxChars: number
  /** Most documents kept per browser. */
  maxDocuments: number
}

/** A document of the built-in knowledge base, as listed in the sidebar. */
export interface KnowledgeDefaultDocument {
  id: string
  title: string
  docNo?: string
  issuer?: string
  chunks: number
  status: KnowledgeDocumentStatus
  statusLabel: string
  sourceUrl?: string
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
  /** Present when the local knowledge base accepts uploads. */
  uploadLimits?: KnowledgeUploadLimits
  /** The built-in documents every user starts with; each user may remove them. */
  defaultDocuments?: KnowledgeDefaultDocument[]
  lmModel?: string
  webSearchAvailable?: boolean
  backendBase?: string
  error?: string
}
