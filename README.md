<p align="center">
  <h1 align="center">DataQuery Workbench · 数问工作台</h1>
</p>

<p align="center">
  AI database pilot with multi-model support — natural language to SQL, real-time thinking visualization, human-in-the-loop safety, and automatic data visualization.
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

## See It in Action

[Open the hosted workspace](https://deepseek-db-chat.vercel.app/) · Watch the demos below without configuring a database.

> Recorded in a local workspace with the **real DeepSeek V4 Flash API** and the [synthetic e-commerce dataset](./scripts/mysql-demo-seed.sql). SQL is reviewed, confirmed, and executed against MySQL. The GIFs preserve key interactions and shorten waiting periods. See the [recording notes](./docs/demo/README.md).

To run your own queries in the hosted workspace, add a MySQL connection reachable from the deployed server and select a configured model provider. No shared database credentials are included.

### 1. Explore the Database

Ask how many tables exist and inspect the table list. Metadata tools provide the answer directly, without generating a redundant SQL query.

![Database exploration: ask for the table count and receive the complete table list](./docs/demo/schema-exploration.gif)

### 2. From a Question to a Chart

Ask a business question, review the generated SQL, confirm execution, and explore the returned data and chart.

![Data analysis: natural-language question, SQL review and confirmation, query results and chart](./docs/demo/sql-analysis.gif)

---

## Why DataQuery Workbench?

General-purpose AI database tools rely on universal LLM SDKs that ignore provider-specific optimizations like DeepSeek's thinking mode and caching mechanisms. DataQuery Workbench supports multiple providers (DeepSeek, Alibaba Cloud Bailian) with deep integration, solving problems other tools cannot.

### Multi-Model & Cost Efficiency

Supports **DeepSeek**, **Kimi**, **Qwen**, **GLM** and more via multiple providers (DeepSeek native + Alibaba Cloud Bailian). Built-in DeepSeek prefix caching optimization and context reuse minimize API call overhead. Deterministic message construction ensures maximum cache hit rates — switch models freely while maintaining the lowest possible cost.

### Rock-Solid Security

Database passwords and user-owned API keys are encrypted with AES-256-GCM. Server API keys never leave the server. SQL is checked again at the execution boundary using server policy: read-only by default, no writes for production connections, and an explicit server allowlist for any non-production writes. Executable comments and unsupported SQL are rejected. SELECT results are capped at 500 returned rows with the executed SQL and truncation metadata. Production database accounts must also enforce read-only access. See [operations and regression testing](./OPERATIONS.md).

### ️ Full Transparency

The AI's entire thinking process and tool calls are fully visible — every reasoning step and SQL generation is traceable and auditable. No black box operations: **what you see is exactly what the AI thinks**.

###  Complete Privacy

Connections and complete conversation history are stored in browser IndexedDB. Questions, necessary schema information and masked result data are sent to the chosen model; knowledge requests are sent to the configured knowledge backend. Common PII and structured sensitive fields are masked at the model boundary. This does not replace data classification or field-level authorization. Optional Langfuse telemetry defaults to operational metadata; content capture requires an explicit opt-in and remains masked. Initial database questions containing sensitive identifiers are rejected with guidance to use a non-sensitive internal identifier, avoiding silently altered query predicates.

---

## Features

- 🔀 **Multi-Provider Support** — DeepSeek / Kimi / Qwen / GLM via DeepSeek native API + Alibaba Cloud Bailian (DashScope), switch models freely in the UI
- ️ **Cost Optimization** — DeepSeek prefix caching with context reuse, deterministic messages, maximum cache hit rate
-  **Security** — AES-256 credentials, server-enforced read-only defaults, AST validation, human confirmation and model-boundary masking
-  **Smart Filter** — AI-driven interactive query parameter tuning (date ranges, enum selects, aggregation options) before SQL generation
-  **Database Overview** — One-click full database structure scan with table row counts, comments, and foreign key relationship mapping for accurate JOIN queries
-  **Foreign Key Awareness** — Schema inspection includes FK relationships extracted from `INFORMATION_SCHEMA`, enabling the AI to generate correct multi-table JOINs
-  **EXPLAIN Pre-Analysis** — Optional query plan inspection with full table scan warnings before execution
-  **SQL Self-Correction** — Structured error classification on failure (unknown column, missing table, syntax error) guides the AI to fix SQL intelligently instead of blind retries
- ️ **Transparency** — Real-time visualization of AI thinking and tool execution, fully auditable
-  **Privacy** — complete local history, documented model/backend data transfers, optional metadata-only telemetry by default
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
pnpm install --frozen-lockfile

# Set environment variables
cp .env.example .env
# Edit .env and fill in your API key (DeepSeek or Bailian)

# Start development server
pnpm dev

# Build for production
pnpm build
pnpm start
```

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Framework** | [TanStack Start](https://tanstack.com/start) + [TanStack Router](https://tanstack.com/router) |
| **AI Core** | Multi-provider Agent Engine (DeepSeek + Bailian/DashScope, based on [deepseek-kit](https://github.com/FliPPeDround/deepseek-kit)) |
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
├── core/               # Multi-provider Agent engine
│   ├── agent/          # Agent creation and execution
│   ├── client/         # HTTP client, SSE streaming, retry
│   ├── model/          # Model wrapper (DeepSeek, Bailian)
│   ├── provider.ts     # Provider registry and endpoint resolution
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


## Regression checks

Run `pnpm check` for source/test type checks, offline regression tests and a production build. Tests use synthetic fixtures and mock providers/databases. Live business accuracy and browser end-to-end acceptance remain separate checks; see [OPERATIONS.md](./OPERATIONS.md).
