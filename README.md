<p align="center">
  <h1 align="center">DBPilot</h1>
</p>

<p align="center">
  A DeepSeek-native AI database pilot — natural language to SQL, real-time thinking visualization, human-in-the-loop safety, and automatic data visualization.
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat&colorA=080f12&colorB=1fa669" alt="License"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D18.0.0-green.svg?style=flat&colorA=080f12&colorB=1fa669" alt="Node">
  <img src="https://img.shields.io/badge/TypeScript-5.8-blue.svg?style=flat&colorA=080f12&colorB=1fa669" alt="TypeScript">
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat&colorA=080f12&colorB=1fa669" alt="PRs Welcome">
</p>

<p align="center">
  <b><a href="./README.zh-CN.md">中文文档</a></b> · <b><a href="./docs/getting-started.md">Documentation</a></b>
</p>

---

## Why DBPilot?

General-purpose AI database tools rely on universal LLM SDKs that ignore DeepSeek's unique thinking mode and caching mechanisms. DBPilot is purpose-built for DeepSeek, solving problems other tools cannot.

### Ultimate Cost Efficiency

Built on DeepSeek prefix caching optimization, context reuse minimizes API call overhead. Deterministic message construction and zero-redundancy request bodies ensure maximum cache hit rates — intelligent token control at the lowest possible cost.

### Rock-Solid Security

Database passwords and model apiKey are encrypted with AES-256-GCM before storage. Every generated SQL query passes **triple-layer validation** — regex blacklist for known-dangerous patterns, AST-based deep analysis via `node-sql-parser` for precise function and table extraction, then presented to you for review before execution. Dangerous operations (INSERT / UPDATE / DELETE / DROP) are strictly blocked at all gates — only safe read queries are allowed. SELECT results are automatically capped at 500 rows to prevent runaway queries. PII data (phone numbers, ID cards, emails, bank card numbers) in query results is automatically masked before being sent to the AI model — your sensitive data never leaves your control. Your database is never at risk.

### ️ Full Transparency

The AI's entire thinking process and tool calls are fully visible — every reasoning step and SQL generation is traceable and auditable. No black box operations: **what you see is exactly what the AI thinks**.

###  Complete Privacy

All data and conversation history are stored entirely on your local machine. No cloud interactions, no server-side data collection — **your data always belongs to you**.

---

## Features

- ️ **Cost Optimization** — DeepSeek prefix caching with context reuse, deterministic messages, maximum cache hit rate
-  **Security** — AES-256 encrypted passwords, triple-layer SQL validation (regex blacklist + AST analysis + human confirmation), dangerous operations blocked at all gates, PII auto-masking before AI transmission
-  **Database Overview** — One-click full database structure scan with table row counts, comments, and foreign key relationship mapping for accurate JOIN queries
-  **Foreign Key Awareness** — Schema inspection includes FK relationships extracted from `INFORMATION_SCHEMA`, enabling the AI to generate correct multi-table JOINs
-  **EXPLAIN Pre-Analysis** — Optional query plan inspection with full table scan warnings before execution
-  **SQL Self-Correction** — Structured error classification on failure (unknown column, missing table, syntax error) guides the AI to fix SQL intelligently instead of blind retries
- ️ **Transparency** — Real-time visualization of AI thinking and tool execution, fully auditable
-  **Privacy** — 100% client-side IndexedDB storage, no cloud interaction, no server-side data collection
-  **Beautiful Data Visualization** — Query results automatically rendered as interactive tables and charts (bar / line / pie)
-  **Resilient Execution** — Auto-retry with exponential backoff, configurable timeouts, and smart error recovery
-  **Multi-Database Management** — Add, switch, and manage multiple MySQL connections from the sidebar
-  **Intelligent Agent Loop** — Multi-step reasoning with few-shot JOIN examples: overview DB → inspect schema → generate SQL → confirm → execute → self-correct on error
-  **Thinking Mode by Default** — `reasoning_content` properly managed across multi-turn tool calls — zero configuration
-  **SSE Streaming** — Real-time response delivery via Server-Sent Events for instant feedback

---

## Quick Start

```bash
# Clone the repository
git clone https://github.com/annoyc/deepseek-db-chat.git
cd deepseek-db-chat

# Install dependencies
npm install

# Set environment variables
cp .env.example .env
# Edit .env and fill in your DeepSeek API key

# Start development server
npm run dev

# Build for production
npm run build
npm run start
```

---

## Screenshots

> Add screenshots here to showcase the UI

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Framework** | [TanStack Start](https://tanstack.com/start) + [TanStack Router](https://tanstack.com/router) |
| **AI Core** | DeepSeek Agent Engine (based on [deepseek-kit](https://github.com/FliPPeDround/deepseek-kit)) |
| **Database** | [mysql2](https://github.com/sidorares/node-mysql2) |
| **UI** | React 19 + [Tailwind CSS v4](https://tailwindcss.com/) + [Lucide Icons](https://lucide.dev/) |
| **Charts** | [Recharts](https://recharts.org/) |
| **Markdown** | [react-markdown](https://github.com/remarkjs/react-markdown) + [remark-gfm](https://github.com/remarkjs/remark-gfm) |
| **Validation** | [Zod](https://zod.dev/) + [node-sql-parser](https://github.com/taozhi8833998/node-sql-parser) (AST-based SQL analysis) |
| **Streaming** | Server-Sent Events (SSE) |
| **Build** | [Vite](https://vite.dev/) |

---

## Project Structure

```
src/
├── core/               # DeepSeek Agent engine
│   ├── agent/          # Agent creation and execution
│   ├── client/         # HTTP client, SSE streaming, retry
│   ├── model/          # DeepSeek model wrapper
│   ├── tool/           # Tool definition and validation
│   ├── generate/       # Agent loop, streaming, structured output
│   ├── context/        # Context compaction
│   └── index.ts        # Public API exports
├── server/             # Server-side logic
│   ├── agent.ts        # DB Agent configuration & layered system prompt (core + workflow + few-shot)
│   ├── tools.ts        # Database tools (overview, list_tables, get_schema, explain_sql, execute_sql)
│   ├── database.ts     # MySQL connection pool, FK extraction, EXPLAIN, auto-LIMIT
│   └── functions/      # TanStack server functions (chat, connections)
├── components/         # React components
│   ├── chat/           # Chat UI (messages, SQL confirm, charts, thinking)
│   └── layout/         # Sidebar, dialogs, database list
├── hooks/              # React hooks (useChat, useDatabase, useSettings)
├── lib/                # Types, constants, utilities, PII masking, AST-based SQL guard
├── routes/             # TanStack Router pages
└── styles/             # Global CSS (Tailwind)
```

---

## License

[MIT](./LICENSE) 协议 © [annoyc](https://github.com/annoyc).
