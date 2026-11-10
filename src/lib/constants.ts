export const APP_NAME = '数问'
export const APP_TAGLINE = '数据查询 · 知识问答'
export const APP_TITLE = `${APP_NAME} · 数据与知识工作台`
export const DEFAULT_MODEL = 'deepseek-flash'
export const DEFAULT_PROVIDER = 'deepseek'
export const QUERY_TIMEOUT_MS = 30_000
export const MAX_POOL_SIZE = 5
export const DATA_DIR = 'data'
export const CHATS_DIR = 'data/chats'

/** Hard limit on SELECT result rows — auto-injected if SQL lacks LIMIT */
export const MAX_RESULT_ROWS = 500

/** Max execution log entries appended to system prompt (oldest are trimmed) */
export const MAX_EXECUTION_LOG_ENTRIES = 10

// 允许执行的 SQL 关键字白名单（仅查询类）
export const ALLOWED_SQL_KEYWORDS = ['SELECT', 'SHOW', 'DESCRIBE', 'EXPLAIN', 'WITH', 'DESC'] as const

// 写操作关键字（需要用户显式开启"可写入"模式才允许）
export const WRITE_SQL_KEYWORDS = ['INSERT', 'UPDATE', 'DELETE', 'REPLACE'] as const

// 危险 SQL 模式黑名单（正则匹配，不区分大小写）
export const BLOCKED_SQL_PATTERNS: RegExp[] = [
  /\b(ALTER|CREATE|DROP|TRUNCATE|RENAME)\b/i,             // DDL
  /\b(GRANT|REVOKE)\b/i,                                    // DCL
  /\b(LOCK|UNLOCK|FLUSH|RESET)\b/i,                         // 管理命令
  /\b(INTO\s+OUTFILE|INTO\s+DUMPFILE|LOAD\s+DATA)\b/i,     // 文件操作
  /\b(PROCEDURE|FUNCTION|TRIGGER|VIEW)\b/i,                 // 对象定义
  /\b(LOAD_FILE|BENCHMARK|SLEEP)\s*\(/i,                    // 危险函数调用
  /\bEXEC(UTE)?\s*\(/i,                                     // 存储过程调用
  /\bSET\s+@@/i,                                            // 会话变量修改
  /\bCALL\b/i,                                               // 存储过程调用
  /\bDO\b/i,                                                 // DO 语句（可执行任意表达式）
  /\bHANDLER\b/i,                                            // HANDLER 绕过权限读取
  /\b(OPTIMIZE|ANALYZE|CHECK|REPAIR)\s+TABLE\b/i,            // 表维护命令
  /\bKILL\b/i,                                               // 终止连接/查询
  /\bPURGE\b/i,                                              // PURGE BINARY LOGS
  /\bINSTALL\b/i,                                            // INSTALL PLUGIN
  /\bUNINSTALL\b/i,                                          // UNINSTALL PLUGIN
  /\bSHUTDOWN\b/i,                                           // 关闭服务器
  /\bCHANGE\b/i,                                             // CHANGE MASTER/REPLICATION
  /\bSTART\s+(SLAVE|REPLICA|TRANSACTION)\b/i,                // 复制/事务控制
  /\bSTOP\s+(SLAVE|REPLICA)\b/i,                             // 停止复制
]
