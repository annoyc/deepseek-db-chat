# Core Concepts

DeepSeek-Native DB Chat2SQL Agent is an AI-powered MySQL assistant built on an inlined copy of **deepseek-kit** (`src/core/`). This document explains the key concepts behind the agent, tools, streaming, human-in-the-loop SQL safety, thinking mode, error handling, and data visualization.

---

## Agent System

The agent is the central orchestrator. It connects a DeepSeek model to database tools and drives a multi-step **ReAct** loop — the model **Reasons** about the user's question, **Acts** by calling tools, observes the results, and repeats until it can answer or hits the step limit.

DeepSeek-Native DB Chat2SQL Agent assembles the agent from three deepseek-kit primitives:

- **`createModel`** — configures the LLM (model name, API key, thinking mode)
- **`tool`** — defines typed, executable functions the model can call
- **`createAgent`** — wires the model, tools, system prompt, and loop settings together

The system prompt in `src/server/agent.ts` is optimized for MySQL query generation. It instructs the agent to explore schema before writing SQL, call `execute_sql` at most once per turn, and respond in Chinese. `maxSteps: 10` caps how many reasoning-and-acting cycles the agent can run in a single request.

```ts
const model = createModel({
  model: 'deepseek-v4-flash',
  thinking: { type: 'enabled' },
})

const agent = createAgent({
  model,
  tools,
  system: SYSTEM_PROMPT,
  maxSteps: 10,
})

// Stream a response for a user message
const agentStream = agent.stream({
  prompt: userMessage,
  messages: conversationHistory,
})
```

`createDbAgent` in `src/server/agent.ts` wraps this setup: it loads the active database connection, creates the model with thinking enabled, registers the three database tools, and appends the current database name to the system prompt.

> **Tip:** The ReAct loop runs inside deepseek-kit's `agentLoop`. Each step streams model output, executes any tool calls, appends tool results to the message history, and loops again. If the model stops calling tools, the loop ends naturally.

> **Tip:** `maxSteps: 10` is a safety valve. Complex questions that require many schema lookups plus SQL generation should still fit within this limit; if the agent hits the cap, it returns whatever text it has produced so far.

---

## Tools

Tools give the agent structured access to the database. Each tool is defined with deepseek-kit's `tool()` helper and a **Zod schema** that validates arguments before execution. Invalid arguments are returned to the model as structured errors so it can self-correct.

DeepSeek-Native DB Chat2SQL Agent registers three database tools in `src/server/tools.ts`:

### list_tables

Lists all table names in the connected database. Use this when exploring database structure or when the user asks what tables exist.

```ts
const listTablesTool = tool({
  name: 'list_tables',
  description: 'List all table names in the current database.',
  schema: z.object({}),
  execute: async () => {
    const tables = await listTables(connection)
    return tables.join('\n')
  },
})
```

**Schema:** `z.object({})` — no arguments required.

**Returns:** Table names joined by newline.

### get_table_schema

Retrieves detailed structure for a single table: column names, types, indexes, defaults, and comments.

```ts
const getTableSchemaTool = tool({
  name: 'get_table_schema',
  description: 'Get detailed schema for a named table.',
  schema: z.object({
    table_name: z.string().describe('The table to inspect'),
  }),
  execute: async ({ table_name }) => {
    return await getTableSchema(connection, table_name)
  },
})
```

**Schema:** `z.object({ table_name: z.string() })`

**Returns:** A formatted schema string (columns, types, keys, indexes, comments).

### execute_sql

Proposes a SQL query for user confirmation. **This tool does not execute SQL against the database.**

```ts
const executeSqlTool = tool({
  name: 'execute_sql',
  description: 'Propose a SQL query for user confirmation.',
  schema: z.object({
    sql: z.string().describe('The SQL statement to run'),
    explanation: z.string().describe('Brief explanation of the query'),
  }),
  execute: async ({ sql, explanation }) => {
    return JSON.stringify({
      status: 'pending_confirmation',
      sql,
      explanation,
      message: 'Submitted for user confirmation. Stop and wait for results.',
    })
  },
})
```

**Schema:** `z.object({ sql: z.string(), explanation: z.string() })`

**Returns:** `{ status: 'pending_confirmation', sql, explanation }` as a JSON string.

> **Important:** `execute_sql` intentionally does **not** run SQL. It returns a `pending_confirmation` status that triggers the human-in-the-loop flow. Read-only exploration (`list_tables`, `get_table_schema`) runs immediately; write and query operations require explicit user approval.

> **Tip:** Tool results for `list_tables` and `get_table_schema` are stored in a per-request `resultStore` so the server can emit `tool-call-end` SSE events after each agent step. The raw `execute_sql` result is withheld from the client stream to avoid leaking the pending-confirmation payload into the chat UI.

---

## Streaming

The agent produces a stream of typed events via `agent.stream()`. The server consumes these events, maps them to client-facing SSE chunks, and the client renders them incrementally in the chat UI.

### Event types

| Agent event | Description |
|-------------|-------------|
| `reasoning-delta` | Incremental thinking content from DeepSeek's reasoning mode |
| `text-delta` | Incremental response text |
| `tool-call` | Model invoked one or more tools |
| `step` | An agent loop step completed (tools executed, history updated) |
| `finish` | Stream complete |

The server maps agent events to `StreamChunk` types and writes them as SSE frames (`data: {...}\n\n`):

| Agent event | SSE chunk | UI component |
|-------------|-----------|--------------|
| `reasoning-delta` | `{ type: 'thinking', content }` | `ThinkingBlock` |
| `text-delta` | `{ type: 'text', content }` | `MarkdownContent` |
| `tool-call` | `{ type: 'tool-call-start', name, args }` | `ToolCallStatus` |
| `step` | `{ type: 'tool-call-end', name, result }` | `ToolCallStatus` |
| Loop end | `{ type: 'finish' }` | Finalizes in-progress tool calls |

```ts
for await (const event of agentStream) {
  switch (event.type) {
    case 'reasoning-delta':
      // AI thinking process — append to message.thinking
      break
    case 'text-delta':
      // AI response text — append to message.content
      break
    case 'tool-call':
      // Tool invocation — emit tool-call-start for each call
      break
    case 'step':
      // Step completion — emit tool-call-end with results
      break
    case 'finish':
      // Done — close the stream
      break
  }
}
```

The client parses SSE in `useChat.tsx` via `parseSSEStream()`, which reads the response body with a `ReadableStream` reader and yields parsed JSON chunks.

> **Tip:** When `execute_sql` is detected during streaming, the server sets `executeSqlDetected = true` and breaks out of the event loop after emitting `tool-call-start`. This stops the stream before any SQL runs and lets the client show the confirmation UI.

> **Tip:** Streaming uses HTTP Server-Sent Events over a standard POST response — no WebSocket upgrade required. This keeps infrastructure simple and works cleanly with TanStack Start's `createServerFn({ response: 'raw' })`.

---

## Human-in-the-Loop

SQL execution is deliberately separated from the agent stream. The agent **proposes** SQL; the user **confirms** before anything touches MySQL. This is the primary safety mechanism for an LLM-driven database assistant.

### Flow

1. **Agent calls `execute_sql`** — The model submits `{ sql, explanation }` via the tool.
2. **Tool returns `pending_confirmation`** — SQL is **not** executed. The tool responds with a JSON payload containing the proposed SQL and explanation.
3. **Stream stops** — The server detects `execute_sql` and breaks the stream (`executeSqlDetected` flag).
4. **Client renders `SqlConfirmBlock`** — The user sees the SQL, the explanation, and Confirm / Cancel buttons.
5. **User decides** — Confirm runs the query; Cancel marks the proposal as cancelled.
6. **Confirmed execution** — `confirmAndExecuteSql` runs the SQL via mysql2's connection pool.
7. **Results fed back to the agent** — On success, `continueWithSqlResult` sends a formatted summary (SQL, row count, up to 50 rows) back through `chatStream` for analysis. On failure, `continueWithSqlError` sends the error so the agent can revise the SQL.
8. **Follow-up queries** — The agent can propose additional SQL in subsequent turns if the current data is insufficient.

```ts
// Server: detect execute_sql and break early
if (name === 'execute_sql') {
  executeSqlDetected = true
}
// ...
if (executeSqlDetected) break

// Client: user confirms
const execResult = await confirmAndExecuteSql({
  data: { connectionId, sql: message.sqlConfirm.sql },
})

if (execResult.success) {
  await continueWithSqlResult(sessionId, connectionId, sql, execResult.data)
} else {
  await continueWithSqlError(sessionId, connectionId, sql, execResult.error)
}
```

> **Important:** Destructive or incorrect SQL never runs without explicit user approval. The system prompt also instructs the agent to warn about INSERT, UPDATE, DELETE, and DROP operations in the `explanation` field.

> **Tip:** The agent is instructed to call `execute_sql` at most **once per turn** and wait for execution results before proposing the next query. Multi-step analysis happens across multiple agent streams, not in a single loop.

> **Tip:** Confirmation state is tracked on each message: `pending` → `confirmed` → `executed` (or `cancelled` / `error`). This gives a clear audit trail in the chat history.

---

## Thinking Mode

DeepSeek models support an extended **thinking** mode that exposes the model's chain-of-thought as `reasoning_content` in streaming deltas. DeepSeek-Native DB Chat2SQL Agent enables this by default.

```ts
const model = createModel({
  model: 'deepseek-v4-flash',
  thinking: { type: 'enabled' },
})
```

When thinking is enabled:

- The model emits `reasoning-delta` events during each agent step.
- `reasoning_content` is automatically preserved in multi-turn conversations by deepseek-kit's generate loop, so context carries across tool calls and follow-up turns.
- The server maps `reasoning-delta` events to `{ type: 'thinking', content }` SSE chunks.
- The `ThinkingBlock` component renders the chain of thought in real time as the model streams.

```tsx
<ThinkingBlock content={message.thinking} round={thinkingRound} />
```

The thinking block is **collapsible** — users can expand or collapse it to focus on the final answer while still having access to the reasoning process.

> **Tip:** Thinking content is stored on the assistant message as `message.thinking` and accumulates across deltas within a single stream. Each agent step may produce a new thinking round.

> **Tip:** The inlined deepseek-kit core maps DeepSeek's native `reasoning_content` field to `reasoning-delta` events without adapter layers, which is one reason the SDK is vendored directly into this project.

---

## Retry & Error Handling

DeepSeek-Native DB Chat2SQL Agent inherits resilience mechanisms from the inlined deepseek-kit core. These operate at both the HTTP layer (API calls) and the tool layer (database operations).

### HTTP auto-retry

API requests retry automatically on transient failures:

- **Retryable status codes:** 429, 500, 502, 503
- **Backoff:** Exponential backoff with jitter (`1000 * 2^attempt + random jitter`)
- **Retry-After:** Respects the `Retry-After` response header when present

```ts
// src/core/client/retry.ts
const baseDelay = 1000 * 2 ** attempt
const jitter = baseDelay * 0.3 * Math.random()
const delay = retryAfter ? retryAfter * 1000 : baseDelay + jitter
```

### Tool execution

Each tool supports configurable resilience:

- **Timeout:** Default 60 seconds per tool execution
- **Retries:** Per-tool `retries` option (default 0 for DB tools)
- **Abort support:** Tools respect `AbortSignal` for cancellation

```ts
tool({
  name: 'get_table_schema',
  timeout: 60000,  // default
  retries: 0,      // default
  // ...
})
```

### JSON parse recovery

When the model produces malformed tool call arguments, deepseek-kit attempts recovery:

1. Try standard `JSON.parse`
2. Fall back to **jsonrepair** for auto-fixing common JSON errors
3. Validate against the Zod schema
4. Return structured validation errors to the model if recovery fails

```ts
// src/core/utils/json-parse.ts
const repaired = repair(raw)
return { success: true, data: JSON.parse(repaired) }
```

### UI error display

Errors surface gracefully in the chat:

- Stream errors emit `{ type: 'error', message }` SSE chunks
- Network failures append an error message to the assistant bubble
- SQL execution errors trigger `continueWithSqlError`, letting the agent analyze and revise

> **Tip:** Tool argument validation errors are returned to the model as `{ success: false, error: "..." }` JSON, allowing the agent to self-correct without crashing the stream.

> **Tip:** SQL queries executed after user confirmation have a separate 30-second timeout in `executeQuery()`, independent of the tool execution timeout.

---

## Data Visualization

After a user confirms and executes SQL, query results are displayed in the chat. The `ResultTable` component handles both tabular and chart views.

### ResultTable

Renders query results as a formatted HTML table with:

- Column headers from the result set
- Up to 100 rows displayed (with total row count shown)
- Toggle between **Table** and **Chart** view modes

### ResultChart

Auto-detects the best chart type based on data shape:

| Chart type | Condition |
|------------|-----------|
| **Pie chart** | ≤ 6 rows and a single numeric value column |
| **Line chart** | > 10 rows (time-series or trend data) |
| **Bar chart** | Default for categorical x-axis + numeric y-axis (≤ 10 rows) |

Detection logic in `ResultChart.tsx`:

- **Numeric columns:** > 50% of values parse as numbers (excluding dates)
- **Date columns:** > 30% of values match date patterns
- **Label column:** First non-numeric column (or date column for the x-axis)
- **Value columns:** All numeric, non-date columns

```tsx
<ResultTable result={sqlResult} />
// Internally toggles between:
<ResultChart result={sqlResult} />  // Recharts: Bar, Line, or Pie
// and a standard HTML table
```

Charts are built with **Recharts** and include:

- Hover tooltips
- Responsive container sizing
- Color-coded series (bar/line) or slices (pie)
- Legend for multi-series data
- Up to 30 data points per chart

> **Tip:** If the data shape is not suitable for charting (fewer than 2 columns, no numeric values), `ResultChart` shows a fallback message instead of rendering an empty chart.

> **Tip:** Date values on the x-axis are formatted as `M/D` for readability. Strict numeric detection excludes date-like strings to avoid misclassifying timestamps as numbers.
