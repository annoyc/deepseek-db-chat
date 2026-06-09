/** Deepseek API base URL */
export const DEEPSEEK_API_BASE_URL = 'https://api.deepseek.com'

/** Deepseek API beta mode base URL */
export const DEEPSEEK_API_BETA_MODE_BASE_URL = 'https://api.deepseek.com/beta'

/** Deepseek models */
export const DEEPSEEK_MODELS = ['deepseek-v4-flash', 'deepseek-v4-pro'] as const

/** Bailian (DashScope) API base URL */
export const BAILIAN_API_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'

/** Bailian available models */
export const BAILIAN_MODELS = ['kimi-k2.6', 'qwen3.7-plus', 'glm-5.1', 'deepseek-v4-pro', 'deepseek-v4-flash'] as const

/** Bailian default model */
export const BAILIAN_DEFAULT_MODEL = 'kimi-k2.6'

/** Agent Loop Max Steps */
export const AGENT_LOOP_MAX_STEPS = 50

/** Max SQL executions per session before blocking */
export const SESSION_MAX_SQL_EXECUTIONS = 20
