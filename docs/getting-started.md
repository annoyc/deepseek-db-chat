# Getting Started

Welcome to **DeepSeek-Native DB Chat2SQL Agent** — an AI-powered MySQL assistant that turns natural language into SQL, with real-time thinking visualization and human-in-the-loop safety.

---

## Overview

DeepSeek-Native DB Chat2SQL Agent lets you talk to your MySQL databases in plain language. Ask questions like *"What tables are in this database?"* or *"Show me the top 10 users by signup date"*, and the AI will explore your schema, generate SQL, and present results as interactive tables or charts.

Unlike generic database tools, DeepSeek-Native DB Chat2SQL Agent is built on **deepseek-kit** internals (inlined in `src/core/`, MIT). It natively handles DeepSeek's thinking mode (`reasoning_content`) and tool-calling loop — so you see the AI reason step by step, and every SQL query requires your explicit confirmation before it runs.

**Tech stack at a glance:**

| Layer | Technology |
|-------|------------|
| Framework | [TanStack Start](https://tanstack.com/start) (full-stack React) |
| AI Core | deepseek-kit (inlined in `src/core/`) |
| Database | [mysql2](https://github.com/sidorares/node-mysql2) |
| UI | React 19 + Tailwind CSS v4 |
| Build | [Vite](https://vite.dev/) |
| Package manager | pnpm |

---

## Prerequisites

Before you begin, make sure you have:

| Requirement | Notes |
|-------------|-------|
| **Node.js >= 18.0.0** | [Download Node.js](https://nodejs.org/) |
| **pnpm** | Install with `npm install -g pnpm` |
| **MySQL database** | Any reachable MySQL 5.7+ or 8.x instance |
| **DeepSeek API key** | [Get one at platform.deepseek.com](https://platform.deepseek.com/api_keys) |

> **Tip:** You only need network access to your MySQL host and the DeepSeek API. No cloud account or registration is required to use the app itself.

---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/annoyc/deepseek-db-chat.git
cd deepseek-db-chat
```

### 2. Install dependencies

DeepSeek-Native DB Chat2SQL Agent uses **pnpm** as its package manager. Install all dependencies with:

```bash
pnpm install
```

### 3. Configure environment variables

Copy the example environment file and edit it with your credentials:

```bash
cp .env.example .env
```

Open `.env` and set at minimum your DeepSeek API key:

```env
# DeepSeek API Key (required)
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Default MySQL Connection (optional, can also add via UI)
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_DATABASE=
```

The `DB_*` variables are optional — you can add database connections through the UI instead. The API key can also be configured later in the in-app settings dialog.

> **Tip:** Never commit your `.env` file. It is listed in `.gitignore` by default. Keep your API key and database passwords out of version control.

---

## First Run

Start the development server:

```bash
pnpm dev
```

Vite starts the app on port **3000**. Open your browser at:

**[http://localhost:3000](http://localhost:3000)**

You should see the DeepSeek-Native DB Chat2SQL Agent interface with an empty sidebar and a chat panel. Before sending your first message, add a database connection and configure your API key (if you did not set it in `.env`).

> **Tip:** For production builds, run `pnpm build` followed by `pnpm start`. The preview server (`pnpm preview`) is useful for testing the built output locally.

---

## Adding Your First Database

Database connections are managed from the sidebar. Each connection is stored locally on the server in `data/connections.json`.

### Step-by-step

1. **Open the add-connection dialog** — Click the **"添加数据库连接"** button (with the **+** icon) at the top of the sidebar.

2. **Fill in MySQL connection details:**

   | Field | Example | Description |
   |-------|---------|-------------|
   | Connection name | `Local Dev` | A friendly label shown in the sidebar |
   | Host | `localhost` | MySQL server hostname or IP |
   | Port | `3306` | MySQL port (default: 3306) |
   | Username | `root` | MySQL user |
   | Password | `secret` | MySQL password (leave empty if none) |
   | Database | `my_app` | The database schema to query |

3. **Test the connection** — When you click **"添加连接"** (Add Connection), the server automatically pings MySQL before saving. If the connection fails, you will see an error message and the connection will not be saved.

4. **Save** — On a successful test, the connection appears under **数据库连接** (Database Connections) in the sidebar. Click it to make it the active connection for chat.

```bash
# Optional: pre-seed a default connection via .env instead of the UI
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_DATABASE=your_database
```

> **Tip:** You can manage multiple databases from the sidebar and switch between them at any time. Each connection maintains its own connection pool on the server (up to 5 concurrent connections per database).

> **Tip:** Ensure your MySQL user has `SELECT` privileges (and `INSERT`/`UPDATE`/`DELETE` only if you intend to run write queries). The AI will always ask for confirmation before executing any SQL.

---

## Your First Query

Once a database is selected, you are ready to chat.

### Step-by-step

1. **Select a database** — Click a connection name in the sidebar. The chat header shows the active database with a green status dot.

2. **Type a natural language question** — Use English or Chinese. Examples:
   - `这个数据库有哪些表？`
   - `Show me the top 10 users by created date`
   - `What is the average order value last month?`

3. **Watch the AI thinking process** — DeepSeek's thinking mode streams in real time. You will see:
   - **Thinking blocks** — the model's chain of reasoning
   - **Tool call status** — when the agent calls `list_tables`, `get_table_schema`, or `execute_sql`
   - **Final answer** — a natural language summary

4. **Review the generated SQL** — When the agent is ready to query data, it presents the SQL in a confirmation block. Read the query carefully. Write operations (`INSERT`, `UPDATE`, `DELETE`, `DROP`) are flagged in the agent's explanation.

5. **Confirm execution** — Click **"确认执行"** (Confirm) to run the SQL, or **"取消"** (Cancel) to skip it. Confirmations time out after 30 seconds if no action is taken.

6. **View results** — After execution, results appear below the SQL block. Toggle between:
   - **表格** (Table) — scrollable data grid (up to 100 rows displayed)
   - **图表** (Chart) — automatic bar, line, or pie chart via Recharts

```
You: Show me the top 10 users

AI:  [Thinking] Let me explore the database schema first...
     [Tool] list_tables → users, orders, products
     [Tool] get_table_schema → users (id, name, email, created_at, ...)
     [SQL Confirm]
       SELECT id, name, email, created_at
       FROM users
       ORDER BY created_at DESC
       LIMIT 10
     [You click Confirm]
     [Results: table with 10 rows + optional chart]
```

> **Tip:** Press **Enter** to send a message, **Shift + Enter** for a new line. You must have an active database selected before the input field accepts messages.

> **Tip:** The agent follows a ReAct loop — it explores schema before writing SQL. If a query fails due to a wrong column name, ask a follow-up question; the agent will re-inspect the schema.

---

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DEEPSEEK_API_KEY` | Yes* | — | Your DeepSeek API key |
| `DEEPSEEK_API_BASE_URL` | No | `https://api.deepseek.com` | Custom API endpoint (for proxies or self-hosted gateways) |
| `DB_HOST` | No | — | Default MySQL host (optional UI alternative) |
| `DB_PORT` | No | `3306` | Default MySQL port |
| `DB_USER` | No | — | Default MySQL username |
| `DB_PASSWORD` | No | — | Default MySQL password |
| `DB_DATABASE` | No | — | Default MySQL database name |

\* Can be omitted from `.env` if you configure the key through the in-app settings dialog instead.

Example full `.env`:

```env
DEEPSEEK_API_KEY=sk-your-key-here
DEEPSEEK_API_BASE_URL=https://api.deepseek.com

DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=readonly_user
DB_PASSWORD=secure_password
DB_DATABASE=analytics
```

### API Key Configuration

There are two ways to provide your DeepSeek API key:

**Option A — Environment variable (recommended for local development)**

Set `DEEPSEEK_API_KEY` in your `.env` file. The server reads it at startup. Restart `pnpm dev` after changing `.env`.

**Option B — In-app settings dialog**

1. Click **设置** (Settings) at the bottom of the sidebar, **or** click the gear icon in the chat panel header.
2. Enter your API key in the dialog and click **保存** (Save).
3. The key is stored in browser `IndexedDB` under `deepseek-api-key` and sent with each chat request.

If both are set, the in-app key takes precedence over the server `.env` value for that browser session.

> **Tip:** Leave the in-app key field empty and save to fall back to the server-side `DEEPSEEK_API_KEY` from `.env`. Click **清除** (Clear) to remove a stored browser key.

### Model Selection

Choose between two DeepSeek models from the dropdown in the **message input area** (bottom-left of the chat panel):

| Model | ID | Best for |
|-------|----|----------|
| **DeepSeek V4 Flash** | `deepseek-v4-flash` | Fast responses, lower cost — **default** |
| **DeepSeek V4 Pro** | `deepseek-v4-pro` | Deeper reasoning, complex multi-step queries |

Your selection is persisted in `IndexedDB` (`deepseek-model`) and applies to all new messages in that browser.

> **Tip:** Start with **Flash** for schema exploration and simple queries. Switch to **Pro** when you need multi-table joins, complex aggregations, or nuanced business logic.

---

## Privacy & Security

DeepSeek-Native DB Chat2SQL Agent is designed with a local-first, privacy-conscious architecture:

| Aspect | Behavior |
|--------|----------|
| **Chat history** | Stored in browser `IndexedDB` only (`deepseek-chat-sessions`). Never sent to a third-party server except as part of DeepSeek API requests. |
| **Authentication** | No login or registration required. |
| **Server-side data** | No user accounts, no chat persistence on the server. |
| **SQL execution** | Every query requires explicit user confirmation. Nothing runs automatically. |
| **Database credentials** | Stored locally in `data/connections.json` on the machine running the server. Passwords are never returned to the client API (masked as `***`). |
| **API keys** | Server key in `.env`; optional per-browser key in `IndexedDB`. |

> **Tip:** Because credentials live in `data/connections.json`, treat that file like a secret. Add `data/` to your backup exclusions if you deploy on a shared machine, or restrict filesystem permissions.

> **Tip:** Use a read-only MySQL user for everyday exploration. Grant write privileges only when you intentionally need `INSERT`/`UPDATE`/`DELETE` operations.

---

## Troubleshooting

### API key errors

**Symptom:** Chat fails immediately with `DEEPSEEK_API_KEY is required` or `DeepSeek API error 401`.

**Solutions:**

1. Verify your key in `.env` starts with `sk-` and has no extra whitespace.
2. Restart the dev server after editing `.env` (`Ctrl+C`, then `pnpm dev`).
3. Check the in-app settings dialog — a stale or invalid browser-stored key overrides `.env`. Clear it and try again.
4. Confirm your key is active at [platform.deepseek.com/api_keys](https://platform.deepseek.com/api_keys).

### Connection failures

**Symptom:** `连接测试失败` (Connection test failed) when adding a database.

**Solutions:**

1. Confirm MySQL is running: `mysql -h localhost -u root -p`.
2. Check host, port, username, password, and database name for typos.
3. Ensure the MySQL user can connect from the app's host (check `bind-address` and user `@host` grants).
4. For remote databases, verify firewall rules allow inbound traffic on port 3306.
5. If using Docker MySQL, use `host.docker.internal` or the container IP instead of `localhost` when the app runs outside the container.

### "Please select a database first"

**Symptom:** The message input is disabled with placeholder *"请先选择一个数据库连接"*.

**Solution:** Click a connection in the sidebar under **数据库连接** to activate it before sending messages.

### SQL confirmation timed out

**Symptom:** The SQL block shows **已取消** (Cancelled) without executing.

**Solution:** Confirm or cancel within 30 seconds. Send a follow-up message to regenerate the query if needed.

### Query timeout or slow results

**Symptom:** SQL execution fails or hangs.

**Solutions:**

1. Queries time out after **30 seconds** (`QUERY_TIMEOUT_MS`). Add `LIMIT` clauses or optimize indexes.
2. Large result sets display up to 100 rows in the UI. The full row count is still reported.
3. Check MySQL server load and network latency for remote connections.

### Rate limiting (HTTP 429)

**Symptom:** `DeepSeek API error 429` during chat.

**Solution:** The client auto-retries with exponential backoff for 429, 500, 502, and 503 responses. Wait a moment and retry. Consider switching to **Flash** to reduce token usage, or check your DeepSeek account quota.

### Port already in use

**Symptom:** `pnpm dev` fails because port 3000 is occupied.

**Solution:** Stop the other process using port 3000, or change the port in `vite.config.ts`:

```ts
export default defineConfig({
  server: {
    port: 3001,
  },
  // ...
})
```

---

## Next Steps

- Read the [README](../README.md) for architecture details, the agent loop diagram, and the full project structure.
- Explore `src/server/agent.ts` to customize the system prompt.
- Check the [roadmap](../README.md#roadmap) for upcoming features like PostgreSQL support, query history, and Docker deployment.

Happy querying!
