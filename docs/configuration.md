# Configuration Reference

This document describes all configuration options for **DBPilot** — an AI-powered MySQL assistant that uses the DeepSeek API to translate natural language into SQL queries.

Configuration is split across environment variables, in-app settings (stored in the browser), and server-side files under `data/`.

---

## Environment Variables

Create a `.env` file in the project root (copy from `.env.example`):

```bash
cp .env.example .env
```

### Full Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DEEPSEEK_API_KEY` | Yes* | — | DeepSeek API key. Can also be set via in-app settings dialog. |
| `DEEPSEEK_API_BASE_URL` | No | `https://api.deepseek.com` | Custom API base URL for proxies or alternative endpoints. |
| `DB_HOST` | No | — | Default MySQL host for initial connection. |
| `DB_PORT` | No | `3306` | Default MySQL port. |
| `DB_USER` | No | — | Default MySQL username. |
| `DB_PASSWORD` | No | — | Default MySQL password. |
| `DB_DATABASE` | No | — | Default MySQL database name. |

\* Required unless configured through the in-app settings dialog.

### Example `.env`

```env
# DeepSeek API
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
DEEPSEEK_API_BASE_URL=https://api.deepseek.com

# Optional default MySQL connection
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=secret
DB_DATABASE=myapp
```

Environment variables are read at server startup via `process.env`. The DeepSeek client resolves defaults in `src/core/model/index.ts`:

```typescript
apiKey: process.env.DEEPSEEK_API_KEY,
baseURL: process.env.DEEPSEEK_API_BASE_URL || 'https://api.deepseek.com',
```

---

## API Key Configuration

DBPilot supports two ways to provide an API key.

### Method 1: Environment Variable

Set `DEEPSEEK_API_KEY` in your `.env` file. This is the recommended approach for local development and server deployments where a single shared key is acceptable.

### Method 2: In-App Settings Dialog

Open **Settings** from the sidebar footer and enter your API key in the dialog. The key is stored in browser `IndexedDB` under the key `deepseek-api-key`.

Clearing the key in the dialog removes the stored value and reverts to the server environment variable.

### Priority

**In-app setting > Environment variable**

When a chat request is sent, the client passes the in-app key to the server. The server resolves the effective key as:

```typescript
const apiKey = options?.apiKey || process.env.DEEPSEEK_API_KEY
```

If the in-app key is set (non-empty), it is used. If the in-app key is empty or cleared, the server falls back to `DEEPSEEK_API_KEY` from the environment.

---

## Model Configuration

DBPilot supports two models:

| Model | Description |
|-------|-------------|
| `deepseek-v4-flash` (default) | Faster responses, lower cost. Good for most queries. |
| `deepseek-v4-pro` | Higher reasoning quality. Better for complex analytical queries. |

The default model is defined in `src/lib/constants.ts`:

```typescript
export const DEFAULT_MODEL = 'deepseek-v4-flash'
```

### Switching Models

Select the model from the dropdown in the chat input area. Your choice is persisted in browser `IndexedDB` under the key `deepseek-model`.

Available models are registered in `src/lib/constants.ts`:

```typescript
export const AVAILABLE_MODELS = [
  { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', description: '快速响应' },
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', description: '深度推理' },
] as const
```

The selected model is sent with each chat request and passed to the agent at runtime.

---

## Database Connection Configuration

### Adding Connections

Connections can be configured in two ways:

1. **Environment variables** — Provide `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, and `DB_DATABASE` in `.env` for a default connection at startup.
2. **In-app "Add Connection" dialog** — Click **Add Database Connection** in the sidebar to create connections interactively.

Connections added via the UI are persisted server-side in `data/connections.json`.

### Connection File Format

Each entry in `data/connections.json` follows this structure:

```json
{
  "id": "abc123",
  "name": "Production",
  "host": "db.example.com",
  "port": 3306,
  "user": "readonly",
  "password": "secret",
  "database": "analytics",
  "createdAt": "2026-05-30T12:00:00.000Z"
}
```

Passwords are stored in plain text on the server. Restrict file permissions on `data/connections.json` in production environments.

### Connection Pool Settings

MySQL connections are managed by [mysql2](https://github.com/sidorares/node-mysql2) with one connection pool per database connection ID. Pool settings are defined in `src/lib/constants.ts` and applied in `src/server/database.ts`:

| Setting | Value | Description |
|---------|-------|-------------|
| `connectionLimit` | `5` (`MAX_POOL_SIZE`) | Maximum concurrent connections in the pool |
| `connectTimeout` | `10_000` ms | Timeout when establishing a new connection |
| `waitForConnections` | `true` | Queue requests when the pool is exhausted |
| `queueLimit` | `0` | Unlimited queue size |

SQL query execution uses a separate per-query timeout of **30 seconds** (`QUERY_TIMEOUT_MS`).

```typescript
const pool = mysql.createPool({
  host: connection.host,
  port: connection.port,
  user: connection.user,
  password: connection.password,
  database: connection.database,
  connectionLimit: MAX_POOL_SIZE,  // 5
  connectTimeout: 10_000,
  waitForConnections: true,
  queueLimit: 0,
})
```

---

## Agent Configuration

The DeepSeek database agent is created in `src/server/agent.ts` with the following defaults:

| Setting | Value | Description |
|---------|-------|-------------|
| Thinking mode | `enabled` | Chain-of-thought reasoning is active by default |
| `reasoningEffort` | `'high'` | Set automatically when thinking is enabled |
| `maxSteps` | `10` | Maximum tool-call rounds per user query |
| System prompt | MySQL-optimized | Guides schema inspection before SQL generation |

### Agent Creation

```typescript
const modelConfig = {
  model: modelName,
  thinking: { type: 'enabled' },
  apiKey,  // if provided
}

const agent = createAgent({
  model,
  tools,
  system: SYSTEM_PROMPT + `\n\n当前连接的数据库: ${connection.database} (${connection.host}:${connection.port})`,
  maxSteps: 10,
})
```

### System Prompt Behavior

The system prompt instructs the agent to:

1. Understand the user's question
2. Call `list_tables` to discover available tables
3. Call `get_table_schema` to confirm real column names and types before writing SQL
4. Submit SQL via `execute_sql` (shown to the user for confirmation before execution)
5. Limit to one `execute_sql` call per response turn

The agent also receives the active database name and host/port appended to the system prompt for context.

### Available Tools

| Tool | Purpose |
|------|---------|
| `list_tables` | List all tables in the connected database |
| `get_table_schema` | Retrieve column definitions and indexes for a table |
| `execute_sql` | Submit SQL for user confirmation and execution |

---

## DeepSeek Cost Optimization

DBPilot includes the inlined [deepseek-kit](https://github.com/FliPPeDround/deepseek-kit) core (`src/core/`) with several built-in optimizations to reduce API cost and improve reliability.

### 1. Zero-Redundancy Request Bodies

Request bodies are built with `omitBy`, stripping all `undefined` fields before sending. No extra metadata is injected into API payloads — only the fields you explicitly configure are included.

```typescript
return omitBy({
  messages,
  model: config.model,
  thinking,
  max_tokens: config.maxTokens,
  temperature: config.temperature,
  tools: toolParameters,
  tool_choice: toolChoice,
  // ...
}, v => v === undefined)
```

This keeps request prefixes stable and avoids unnecessary token consumption from unused parameters.

### 2. Deterministic Message Construction

Messages are assembled in a fixed order via `buildMessage()` in `src/core/generate/generate-utils.ts`:

1. System prompt
2. Few-shot examples (if any)
3. Conversation history
4. Current user prompt

Because the same inputs always produce the same message prefix, DeepSeek's context caching can achieve higher cache hit rates across multi-turn agent loops.

### 3. Auto-Retry with Exponential Backoff

Failed API requests are automatically retried up to 3 times (configurable via `maxRetries`) for transient errors:

- `429` — Rate limited
- `500` — Internal server error
- `502` — Bad gateway
- `503` — Service unavailable

Retry delay uses exponential backoff with jitter, or respects the `Retry-After` header when present:

```typescript
const baseDelay = 1000 * 2 ** attempt
const jitter = baseDelay * 0.3 * Math.random()
const delay = retryAfter ? retryAfter * 1000 : baseDelay + jitter
```

### 4. Configurable Timeout

API requests default to a **60-second** timeout (`config.timeout ?? 60000`). The timeout is enforced via `AbortSignal.timeout()` and can be overridden per model instance:

```typescript
const model = createModel({
  model: 'deepseek-v4-flash',
  timeout: 90_000,  // 90 seconds
})
```

### 5. Context Compaction

When conversation context approaches token limits, the agent loop automatically compacts history:

- **Trigger threshold**: 85% of the context window (default 1M tokens)
- **Keep recent rounds**: Last 3 conversation rounds are preserved in full
- **Compaction model**: `deepseek-v4-flash` (fast, low-cost summarization)
- **Tool result compaction**: Verbose tool outputs over 1,500 characters are summarized

Compaction is handled by `CompactMessage` and `CompactTool` in `src/core/context/compact.ts`. Usage metrics track `prompt_cache_hit_tokens` and `prompt_cache_miss_tokens` to monitor cache effectiveness.

---

## Data Storage Locations

| Data | Location | Persistence |
|------|----------|-------------|
| Chat sessions | Browser `IndexedDB` (`deepseek-chat-sessions`) | Per browser |
| API key | Browser `IndexedDB` (`deepseek-api-key`) | Per browser |
| Model selection | Browser `IndexedDB` (`deepseek-model`) | Per browser |
| Database connections | `data/connections.json` | Server-side file |
| Chat history (server) | `data/chats/` | Server-side file (currently unused) |

### Browser Storage

Client-side data is scoped to the browser profile. Clearing browser data removes chat history, API keys, and model preferences. Chat sessions are capped at the **last 100 messages** per session when saved to `IndexedDB`.

### Server-Side Storage

The `data/` directory is created automatically on first use. Paths are defined in `src/lib/constants.ts`:

```typescript
export const DATA_DIR = 'data'
export const CONNECTIONS_FILE = 'data/connections.json'
export const CHATS_DIR = 'data/chats'
```

Server-side chat storage (`data/chats/`) is implemented in `src/server/store.ts` but is not currently used by the UI — all active chat history lives in the browser.

---

## Quick Reference

```bash
# Minimum setup
cp .env.example .env
# Edit .env and set DEEPSEEK_API_KEY

pnpm dev
# Open http://localhost:3000
# Add a database connection via the sidebar
# Optionally override API key or model in Settings / chat input
```

For deployment, ensure:

- `DEEPSEEK_API_KEY` is set in the server environment
- The `data/` directory is writable for connection persistence
- Network access to your MySQL host and `https://api.deepseek.com` (or your custom `DEEPSEEK_API_BASE_URL`) is available
