# Development Guide

This guide covers local setup, project layout, key files, and conventions for contributing to **DeepSeek-Native DB Chat2SQL Agent** — an AI-powered MySQL assistant.

---

## Local Development

### 1. Clone the repository

```bash
git clone https://github.com/annoyc/deepseek-db-chat.git
cd deepseek-db-chat
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Start the dev server

```bash
pnpm dev
```

The development server runs at **http://localhost:3000** with hot module replacement (HMR). Changes to React components, server functions, and styles are reflected instantly without a full page reload.

### Build tooling

The project uses **Vite 6** with:

- `@vitejs/plugin-react` — React Fast Refresh and JSX transform
- `@tailwindcss/vite` — Tailwind CSS v4 integration

TanStack Start is configured via the `@tanstack/react-start/plugin/vite` plugin in `vite.config.ts`.

---

## Project Structure

```
src/
├── core/           # DeepSeek Agent core (from deepseek-kit, MIT)
├── server/         # Server-side: agent, tools, database, server functions
├── components/     # React components (chat UI, layout)
├── hooks/          # React hooks (useChat, useDatabase, useSettings, useLocalStorage)
├── lib/            # Shared types, constants, utilities
├── routes/         # TanStack Router pages (single route: index.tsx)
└── styles/         # Global CSS
```

### `src/core/`

Inlined copy of the **deepseek-kit** agent runtime (MIT licensed). This is the heart of DeepSeek integration — it handles model invocation, streaming, tool-calling loops, and reasoning content (`reasoning_content`).

| Subdirectory | Purpose |
|--------------|---------|
| `agent/` | Agent orchestration and multi-step tool loop |
| `client/` | HTTP client, retry logic, streaming requests |
| `context/` | Context compaction for long conversations |
| `generate/` | Text and structured output generation |
| `model/` | Model types, invocation, balance checks |
| `tool/` | Tool definition types and dispatch |
| `fim/` | Fill-in-the-middle support |
| `utils/` | JSON parsing and shared helpers |
| `constants/` | Shared constants |
| `errors.ts` | Typed error classes |

Keeping this code inlined (rather than as an external dependency) allows deep customization of the agent loop and streaming behavior.

### `src/server/`

All server-side logic, exposed to the client via TanStack Start `createServerFn` endpoints.

| File / Directory | Purpose |
|------------------|---------|
| `agent.ts` | Creates the DB agent with system prompt and tool bindings |
| `tools.ts` | Defines the three database tools (`list_tables`, `get_table_schema`, `execute_sql`) |
| `database.ts` | MySQL connection pool management via mysql2 |
| `store.ts` | Server-side connection store (`data/connections.json`) |
| `functions/chat.ts` | SSE streaming chat endpoint |
| `functions/confirm-sql.ts` | Human-in-the-loop SQL execution after user approval |
| `functions/connections.ts` | Database connection CRUD |

### `src/components/`

React UI components, organized by feature area.

| Directory | Purpose |
|-----------|---------|
| `chat/` | Chat panel, message list, input, thinking blocks, SQL confirmation, result tables and charts |
| `layout/` | Sidebar, chat history, database list, API key dialog, add-connection dialog |

### `src/hooks/`

Custom React hooks that encapsulate client-side state and side effects.

| Hook | Purpose |
|------|---------|
| `useChat.tsx` | Main chat logic — SSE consumption, message state, SQL confirmation flow |
| `useDatabase.tsx` | Database connection management |
| `useSettings.tsx` | App settings (API key, model selection) |
| `useLocalStorage.ts` | IndexedDB read/write (with localStorage migration fallback) |

### `src/lib/`

Shared code used by both client and server.

| File | Purpose |
|------|---------|
| `types.ts` | Shared TypeScript types (messages, connections, stream events) |
| `constants.ts` | App-wide constants (model names, storage keys) |
| `utils.ts` | Utility functions (class name merging, formatting) |

### `src/routes/`

TanStack Router file-based routing. The app has a single page route:

- `index.tsx` — Main chat interface
- `__root.tsx` — Root layout wrapper

Route tree is auto-generated in `routeTree.gen.ts`.

### `src/styles/`

Global CSS including Tailwind directives and custom styles in `globals.css`.

---

## Key Files

| File | Description |
|------|-------------|
| `src/server/agent.ts` | DB Agent setup with system prompt — configures the DeepSeek agent with database-specific instructions and tool bindings |
| `src/server/tools.ts` | Three database tool definitions — `list_tables`, `get_table_schema`, and `execute_sql` with Zod parameter validation |
| `src/server/database.ts` | MySQL connection pool management — creates and reuses mysql2 pools per connection ID |
| `src/server/functions/chat.ts` | SSE streaming chat endpoint — orchestrates the agent loop and streams events to the client |
| `src/hooks/useChat.tsx` | Main chat logic and state management — consumes SSE events, manages messages, handles SQL confirmation |
| `src/components/chat/` | All chat UI components — message bubbles, thinking blocks, SQL confirm dialog, result tables and charts |

---

## Tech Decisions

### TanStack Start for full-stack React

TanStack Start provides full-stack React with server functions (`createServerFn`), file-based routing, and SSR capabilities. Server functions are type-safe RPC endpoints that run on the server but are callable from the client with full TypeScript inference.

### SSE for one-directional streaming

Server-Sent Events (SSE) stream agent events (thinking, tool calls, text deltas) from server to client in real time. SSE is simpler than WebSockets for this use case because communication is one-directional — the client sends a request, then receives a stream of events.

### IndexedDB for privacy-first data storage

Chat history, API keys, and app settings are stored in the browser's `IndexedDB` (via Dexie.js). No user data is persisted on the server. This keeps conversations private and eliminates the need for authentication.

### Zod for tool parameter validation

Tool parameters are validated with Zod schemas before being passed to the agent. This ensures the AI receives well-typed inputs and prevents malformed tool calls from reaching the database layer.

### deepseek-kit core inlined for deep DeepSeek integration

The `src/core/` directory contains an inlined copy of deepseek-kit rather than using it as an npm dependency. This allows direct control over the agent loop, streaming parser, and reasoning content handling — features that are central to the DeepSeek-Native DB Chat2SQL Agent experience.

---

## Build & Deploy

### Production build

```bash
pnpm build
```

Builds the application for production. Output is written to the `.output/` directory, which contains both the client bundle and the server entry point.

### Run production server

```bash
pnpm start
```

Starts the production server from `.output/server/index.mjs`. Make sure environment variables (especially `DEEPSEEK_API_KEY`) are set before starting.

### Preview build locally

```bash
pnpm preview
```

Serves the production build locally for testing before deployment.

---

## Code Style

| Convention | Details |
|------------|---------|
| **TypeScript strict mode** | Strict type checking enabled — no implicit `any`, strict null checks |
| **ESM modules** | `"type": "module"` in `package.json` — use `import`/`export`, not `require` |
| **React 19 with hooks** | Functional components only, no class components |
| **Tailwind CSS v4** | Utility-first styling via `@tailwindcss/vite` plugin |
| **Path aliases** | `@/` maps to `src/` (configured in `vite.config.ts`) |

When adding new code, follow existing patterns in the surrounding files. Keep server logic in `src/server/`, UI in `src/components/`, and shared types in `src/lib/`.
