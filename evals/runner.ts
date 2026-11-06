import { AsyncLocalStorage } from 'node:async_hooks'
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import mysql from 'mysql2/promise'
import type { ModelProvider } from '@/core'
import type { DatabaseConnection } from '@/lib/types'
import { validateSql } from '@/lib/sql-guard'
import { createDbAgent } from '@/server/agent'
import { closePool } from '@/server/database'
import { compareResults, scoreBehaviour, type AgentOutcome, type EvalCase, type Row } from './scorer'
import { formatSummary, summarize, type CaseResult, type UsageTotals } from './summary'

interface EvalConfig {
  name: string
  provider: ModelProvider
  model: string
  thinkingMode?: 'enabled' | 'disabled'
  reasoningEffort?: 'high' | 'max'
  /** false skips the intent classifier and sends the full system prompt. */
  intentRouting?: boolean
  /** Frozen clock for both the prompt and MySQL's NOW()/CURDATE(). */
  now: string
}

// The launcher runs a bundled copy from node_modules with the repository as cwd.
const root = process.cwd()
const evalsDir = resolve(root, 'evals')
const CASE_TIMEOUT_MS = 180_000
const MAX_RESULT_ROWS = 5000

// ── Token accounting ────────────────────────────────────────
// Every LLM request (intent classifier and each agent step) goes through
// fetch; reading `usage` there counts all of them, whatever the provider.
// Bodies are observed as the app reads them rather than cloned: the stream
// reader stops at each step's end, so a cloned branch would never finish.

const usageScope = new AsyncLocalStorage<UsageTotals>()
const originalFetch = globalThis.fetch

function addUsage(totals: UsageTotals, usage: Record<string, any> | null | undefined) {
  if (!usage) return
  totals.promptTokens += usage.prompt_tokens ?? 0
  totals.completionTokens += usage.completion_tokens ?? 0
  totals.totalTokens += usage.total_tokens ?? 0
  totals.cacheHitTokens += usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0
  totals.llmCalls++
}

function observeUsage(response: Response, totals: UsageTotals): Response {
  if (!response.body) return response
  const sse = (response.headers.get('content-type') ?? '').includes('event-stream')
  const decoder = new TextDecoder()
  let buffer = ''
  const takeLine = (line: string) => {
    const data = line.startsWith('data:') ? line.slice(5).trim() : ''
    if (!data || data === '[DONE]') return
    try { addUsage(totals, JSON.parse(data).usage) } catch { /* partial or non-JSON event */ }
  }
  const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk)
      buffer += decoder.decode(chunk, { stream: true })
      if (!sse) return
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      lines.forEach(takeLine)
    },
    flush() {
      if (sse) return takeLine(buffer)
      try { addUsage(totals, JSON.parse(buffer).usage) } catch { /* error bodies carry no usage */ }
    },
  }))
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
}

globalThis.fetch = async (...args: Parameters<typeof fetch>) => {
  const response = await originalFetch(...args)
  const totals = usageScope.getStore()
  return totals ? observeUsage(response, totals) : response
}

// ── Database ────────────────────────────────────────────────

function evalConnection(): DatabaseConnection {
  const env = (name: string) => {
    const value = process.env[name]?.trim()
    if (!value) throw new Error(`Missing ${name}; see evals/README.md`)
    return value
  }
  return {
    id: 'eval', name: 'eval',
    host: env('EVAL_DB_HOST'), port: Number(process.env.EVAL_DB_PORT ?? 3306),
    user: env('EVAL_DB_USER'), password: env('EVAL_DB_PASSWORD'), database: env('EVAL_DB_DATABASE'),
    ssl: process.env.EVAL_DB_SSL === 'true' ? {} : undefined,
    env: 'test', readOnly: true, createdAt: new Date(0).toISOString(),
  }
}

/** Runs read-only SQL with MySQL's clock pinned to the eval's frozen time, in Beijing time. */
function createExecutor(connection: DatabaseConnection, now: Date) {
  const pool = mysql.createPool({
    host: connection.host, port: connection.port, user: connection.user, password: connection.password,
    database: connection.database, ssl: connection.ssl ? {} : undefined,
    dateStrings: true, supportBigNumbers: true, bigNumberStrings: true, connectionLimit: 4,
  })
  const run = async (sql: string): Promise<Row[]> => {
    const check = validateSql(sql, 'readonly')
    if (!check.allowed) throw new Error(`refused by read-only guard: ${check.reason}`)
    const conn = await pool.getConnection()
    try {
      await conn.query('SET SESSION TRANSACTION READ ONLY')
      await conn.query("SET time_zone = '+08:00', SESSION max_execution_time = 10000, timestamp = ?", [Math.floor(now.getTime() / 1000)])
      const [rows] = await conn.query(sql)
      if (!Array.isArray(rows)) throw new Error('statement returned no result set')
      const last = Array.isArray(rows[0]) ? rows.at(-1) : rows
      if ((last as Row[]).length > MAX_RESULT_ROWS) throw new Error(`more than ${MAX_RESULT_ROWS} rows`)
      return last as Row[]
    } finally {
      await conn.query('SET timestamp = DEFAULT').catch(() => {})
      conn.release()
    }
  }
  return { run, close: () => pool.end() }
}

// ── Agent turn ──────────────────────────────────────────────

/** Mirrors chatStream: the turn stops once SQL awaits confirmation or smart_filter asks the user. */
async function runAgent(connection: DatabaseConnection, question: string, options: EvalConfig, signal: AbortSignal) {
  const { agent, resultStore } = await createDbAgent(connection, {
    provider: options.provider,
    model: options.model,
    thinkingMode: options.thinkingMode,
    reasoningEffort: options.reasoningEffort,
    sqlPermission: 'readonly',
    userQuery: question,
    intent: options.intentRouting === false ? null : undefined,
    now: new Date(options.now),
    signal,
  })
  const started = performance.now()
  const trace = (message: string) => {
    if (process.env.EVAL_VERBOSE === 'true') console.log(`  [${((performance.now() - started) / 1000).toFixed(1)}s] ${question.slice(0, 16)} ${message}`)
  }
  trace('agent ready')
  const toolCalls: string[] = []
  const submittedSql: string[] = []
  let text = ''
  let pendingSql: string | undefined
  let seenSqlResults = 0
  const collectPending = () => {
    const queue = resultStore.get('execute_sql') ?? []
    for (const result of queue.slice(seenSqlResults)) {
      try {
        const parsed = JSON.parse(result)
        if (parsed.status === 'pending_confirmation') pendingSql = parsed.sql
      } catch { /* guard errors are plain text and let the model retry */ }
    }
    seenSqlResults = queue.length
  }
  for await (const event of agent.stream({ prompt: question, signal })) {
    if (event.type === 'text-delta') text += event.textDelta
    else if (event.type === 'tool-call') {
      for (const call of event.toolCalls) {
        trace(`tool-call ${call.function.name} ${call.function.arguments?.slice(0, 120) ?? ''}`)
        toolCalls.push(call.function.name)
        if (call.function.name !== 'execute_sql') continue
        try { submittedSql.push(String(JSON.parse(call.function.arguments || '{}').sql ?? '')) } catch { /* malformed args */ }
      }
    } else if (event.type === 'step') {
      trace(`step ${event.step}`)
      collectPending()
      if (pendingSql || toolCalls.includes('smart_filter')) break
    }
  }
  collectPending()
  const outcome: AgentOutcome = { pendingSql, smartFilterCalled: toolCalls.includes('smart_filter'), submittedSql, text }
  return { outcome, toolCalls }
}

async function runCase(
  c: EvalCase, repeat: number, config: EvalConfig, connection: DatabaseConnection,
  executor: ReturnType<typeof createExecutor>, goldCache: Map<string, Promise<Row[]>>,
): Promise<CaseResult> {
  const usage: UsageTotals = { promptTokens: 0, completionTokens: 0, totalTokens: 0, cacheHitTokens: 0, llmCalls: 0 }
  const started = performance.now()
  const base = { id: c.id, category: c.category, expect: c.expect.type, repeat, usage }
  let toolCalls: string[] = []
  try {
    const run = await usageScope.run(usage, () => runAgent(connection, c.question, config, AbortSignal.timeout(CASE_TIMEOUT_MS)))
    const latencyMs = Math.round(performance.now() - started)
    toolCalls = run.toolCalls
    const { outcome } = run
    if (c.expect.type !== 'result') {
      const score = scoreBehaviour(c.expect, outcome)
      return { ...base, ...score, pendingSql: outcome.pendingSql, toolCalls, latencyMs }
    }
    if (!outcome.pendingSql) return { ...base, pass: false, strictPass: false, reason: 'no SQL submitted', toolCalls, latencyMs }
    const golds = [c.expect.gold_sql].flat()
    const goldRows = await Promise.all(golds.map(sql => {
      if (!goldCache.has(sql)) goldCache.set(sql, executor.run(sql))
      return goldCache.get(sql)!
    }))
    let predRows: Row[]
    try {
      predRows = await executor.run(outcome.pendingSql)
    } catch (error) {
      return { ...base, pass: false, strictPass: false, reason: `predicted SQL failed: ${(error as Error).message}`, pendingSql: outcome.pendingSql, toolCalls, latencyMs }
    }
    const comparisons = goldRows.map(rows => compareResults(rows, predRows, c.expect.type === 'result' && !!c.expect.order_matters))
    const pass = comparisons.some(r => r.relaxed)
    const strictPass = comparisons.some(r => r.strict)
    return { ...base, pass, strictPass, reason: pass ? 'result matches' : `result differs (${predRows.length} rows)`, pendingSql: outcome.pendingSql, toolCalls, latencyMs }
  } catch (error) {
    const latencyMs = Math.round(performance.now() - started)
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    return { ...base, pass: false, reason: 'agent error', error: message, toolCalls, latencyMs }
  }
}

// ── CLI ─────────────────────────────────────────────────────

/** Runs every gold SQL without the model; an empty answer would let wrong SQL score as correct. */
async function checkGold(cases: EvalCase[], executor: ReturnType<typeof createExecutor>) {
  let failures = 0
  try {
    for (const c of cases) {
      if (c.expect.type !== 'result') continue
      for (const sql of [c.expect.gold_sql].flat()) {
        try {
          const rows = await executor.run(sql)
          if (!rows.length) throw new Error('empty result')
          console.log(`OK   ${c.id}: ${rows.length} row(s) ${JSON.stringify(rows.slice(0, 3))}`)
        } catch (error) {
          failures++
          console.log(`FAIL ${c.id}: ${(error as Error).message}`)
        }
      }
    }
  } finally {
    await executor.close()
  }
  if (failures) process.exitCode = 1
}

async function main() {
  const { values } = parseArgs({
    options: {
      config: { type: 'string', default: 'deepseek-flash' },
      dataset: { type: 'string', default: 'questions.jsonl' },
      filter: { type: 'string' },
      repeats: { type: 'string', default: '1' },
      concurrency: { type: 'string', default: '2' },
      out: { type: 'string' },
      'check-gold': { type: 'boolean', default: false },
    },
  })
  if (existsSync(resolve(root, '.env'))) process.loadEnvFile(resolve(root, '.env'))
  const configPath = values.config!.endsWith('.json') ? resolve(values.config!) : resolve(evalsDir, 'configs', `${values.config}.json`)
  const config = JSON.parse(await readFile(configPath, 'utf8')) as EvalConfig
  const datasetText = await readFile(resolve(evalsDir, 'dataset', values.dataset!), 'utf8')
  const filters = values.filter?.split(',').map(f => f.trim()).filter(Boolean) ?? []
  const cases = datasetText.split('\n').filter(line => line.trim()).map(line => JSON.parse(line) as EvalCase)
    .filter(c => !filters.length || filters.some(f => c.id.startsWith(f) || c.category === f))
  if (!cases.length) throw new Error('No eval cases matched')
  const repeats = Number(values.repeats)
  const concurrency = Math.max(1, Number(values.concurrency))

  const connection = evalConnection()
  const executor = createExecutor(connection, new Date(config.now))
  if (values['check-gold']) return checkGold(cases, executor)
  const goldCache = new Map<string, Promise<Row[]>>()
  const queue = Array.from({ length: repeats }, (_, repeat) => cases.map(c => ({ c, repeat }))).flat()
  const results: CaseResult[] = []
  const startedAt = new Date().toISOString()
  let done = 0
  try {
    await Promise.all(Array.from({ length: concurrency }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        const result = await runCase(job.c, job.repeat, config, connection, executor, goldCache)
        results.push(result)
        done++
        const mark = result.pass ? 'PASS' : 'FAIL'
        console.log(`[${done}/${repeats * cases.length}] ${mark} ${result.id}#${result.repeat} ${result.reason}${result.error ? ` — ${result.error}` : ''}`)
      }
    }))
  } finally {
    await executor.close()
    await closePool(connection.id).catch(() => {})
  }

  results.sort((a, b) => a.id.localeCompare(b.id) || a.repeat - b.repeat)
  const summary = summarize(results)
  let commit = 'unknown'
  try { commit = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim() } catch { /* not a checkout */ }
  const report = { config, dataset: values.dataset, filter: values.filter ?? null, commit, startedAt, finishedAt: new Date().toISOString(), summary, results }
  const stamp = startedAt.replace(/[:.]/g, '-').slice(0, 19)
  const outPath = values.out ? resolve(values.out) : resolve(evalsDir, 'results', `${stamp}-${config.name}.json`)
  await mkdir(resolve(outPath, '..'), { recursive: true })
  await writeFile(outPath, JSON.stringify(report, null, 2) + '\n')
  console.log(`\n${formatSummary(config.name, summary)}\n\nSaved ${outPath}`)
  if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, formatSummary(config.name, summary) + '\n', { flag: 'a' })
}

await main()
