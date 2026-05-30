export const APP_NAME = 'DeepSeek DB Agent'
export const DEFAULT_MODEL = 'deepseek-v4-flash'
export const QUERY_TIMEOUT_MS = 30_000
export const MAX_POOL_SIZE = 5
export const DATA_DIR = 'data'
export const CONNECTIONS_FILE = 'data/connections.json'
export const CHATS_DIR = 'data/chats'

export const AVAILABLE_MODELS = [
  { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', description: '快速响应' },
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', description: '深度推理' },
] as const
