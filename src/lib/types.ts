export interface DatabaseConnection {
  id: string
  name: string
  host: string
  port: number
  user: string
  password: string
  database: string
  createdAt: string
}

export interface ChatSession {
  id: string
  connectionId: string
  title: string
  messages: ChatMessage[]
  createdAt: string
  updatedAt: string
  taskStartTime?: number
  taskEndTime?: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  thinking?: string
  toolCalls?: ToolCallInfo[]
  sqlConfirm?: SqlConfirmInfo
  sqlResult?: SqlResultInfo
  timestamp: string
  answerDuration?: number
  answerQueryCount?: number
}

export interface ToolCallInfo {
  name: string
  args: Record<string, unknown>
  result?: string
  error?: string
  status: 'calling' | 'completed' | 'error'
}

export interface SqlConfirmInfo {
  sql: string
  explanation: string
  status: 'pending' | 'confirmed' | 'cancelled' | 'executed' | 'error'
  error?: string
}

export interface SqlResultInfo {
  columns: string[]
  rows: Record<string, unknown>[]
  rowCount: number
  executionTime: number
}

export type StreamChunk =
  | { type: 'thinking'; content: string }
  | { type: 'text'; content: string }
  | { type: 'tool-call-start'; name: string; args: Record<string, unknown> }
  | { type: 'tool-call-end'; name: string; result: string; error?: string }
  | { type: 'sql-confirm'; sql: string; explanation: string }
  | { type: 'sql-result'; data: SqlResultInfo }
  | { type: 'error'; message: string }
  | { type: 'finish' }
