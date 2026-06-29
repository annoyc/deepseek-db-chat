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

export interface KnowledgeEvidence {
  subQuestions: string[]
  memorySnippets: KnowledgeMemorySnippet[]
  webResults: KnowledgeWebResult[]
  progress: string[]
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
      type: 'evidence'
      subQuestions?: string[]
      memorySnippets?: KnowledgeMemorySnippet[]
      webResults?: KnowledgeWebResult[]
    }
  | { type: 'error'; message: string }
  | { type: 'finish' }

export interface KnowledgeChatInput {
  message: string
  useWebSearch: boolean
  useBaseModel: boolean
  answerMode: KnowledgeAnswerMode
}

export interface KnowledgeHealth {
  status: 'ok' | 'offline'
  lmModel?: string
  webSearchAvailable?: boolean
  backendBase?: string
  error?: string
}
