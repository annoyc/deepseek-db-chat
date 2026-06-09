export type DbEnv = 'dev' | 'test' | 'staging' | 'prod'

export interface DatabaseConnection {
  id: string
  name: string
  host: string
  port: number
  user: string
  password: string
  database: string
  env: DbEnv
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
  executionLog?: ExecutionLogEntry[]
}

export interface ExecutionLogEntry {
  sql: string
  success: boolean
  summary: string
  timestamp: string
}

export type MessagePart =
  | { type: 'thinking'; content: string }
  | { type: 'tool-call'; toolCallIndex: number }
  | { type: 'text'; content: string }

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  thinking?: string
  toolCalls?: ToolCallInfo[]
  parts?: MessagePart[]
  sqlConfirm?: SqlConfirmInfo
  sqlResult?: SqlResultInfo
  smartFilterConfirm?: SmartFilterConfirmInfo
  smartFilterValues?: Record<number, FilterValue>
  timestamp: string
  answerDuration?: number
  answerQueryCount?: number
}

export interface ToolCallInfo {
  id?: string
  name: string
  args: Record<string, unknown>
  result?: string
  error?: string
  status: 'calling' | 'completed' | 'error'
}

export interface SmartFilterConfirmInfo {
  suggestedFilters: SuggestedFilter[]
  status: 'pending' | 'confirmed' | 'done' | 'cancelled'
  error?: string
}

export interface SuggestedFilter {
  type: 'date_range' | 'enum_select' | 'option_select' | 'aggregation'
  table: string
  column: string
  label: string
  dataType: string
  enumValues?: string[]
  options?: string[]
  dateMin?: string
  dateMax?: string
  rowCount?: number
  fkRelatedTable?: string
  fkRelatedValues?: string[]
  defaultRange?: string
  aggregationOptions?: string[]
  defaultValue?: string
}

export interface FilterValue {
  dateRange?: { start: string; end: string }
  enumValue?: string
  optionValue?: string
  aggregation?: string
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
  | { type: 'smart-filter-confirm'; suggestedFilters: SuggestedFilter[] }
  | { type: 'error'; message: string }
  | { type: 'finish' }
