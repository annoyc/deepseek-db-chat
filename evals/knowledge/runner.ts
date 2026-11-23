/**
 * Knowledge-base evaluation.
 *
 *   pnpm eval:kb                                  offline retrieval variants (no API key)
 *   pnpm eval:kb --variants baseline,rewrite      choose variants; rewrite needs a model key
 *   pnpm eval:kb --mode answer --model <id>       end-to-end answers with a real model
 *   pnpm eval:kb --filter paraphrase,lookup-01    only some categories / ids
 *
 * Model settings come from --provider / --model and the server keys in .env.
 */
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { KEYWORD_RELEVANCE, type RelevanceGate } from '../../src/lib/retrieval/bm25'
import type { KnowledgeStreamChunk } from '../../src/lib/knowledge-types'
import { createRequestModel } from '../../src/server/ai-credentials'
import { parseCorpusFile } from '../../src/server/knowledge/corpus'
import { createServerEmbedder } from '../../src/server/knowledge/embedding'
import type { KnowledgeBase } from '../../src/server/knowledge/knowledge-base'
import { runKnowledgePipeline, type KnowledgePipelineDeps } from '../../src/server/knowledge/pipeline'
import { analyzeQuery, retrievalQueries, type KnowledgeChatModel } from '../../src/server/knowledge/query-analysis'
import { retrieve } from '../../src/server/knowledge/retriever'
import { beijingDate } from '../../src/server/knowledge/validity'
import type { KbIndexFile } from '../../src/server/knowledge/types'
import { scoreAnswer, summarizeAnswers, type AnswerMetrics, type AnswerOutcome, type AnswerScore } from './answer'
import { judgeFaithfulness } from './judge'
import { chunkLocators, KS, scoreRetrieval, summarizeRetrieval, unknownGold, type KbEvalCase, type RetrievalMetrics } from './scorer'
import { OFFLINE_VARIANTS, VARIANTS, type RetrievalVariant } from './variants'

const root = process.cwd()
const evalDir = resolve(root, 'evals/knowledge')
const TOP_K = 10

const pct = (value: number) => Number.isNaN(value) ? '—' : `${(value * 100).toFixed(1)}%`

function locatorsById(kb: KnowledgeBase): Map<string, string[]> {
  return new Map(kb.chunks.map(chunk => [chunk.id, chunkLocators(chunk)]))
}

async function loadInputs() {
  const cases = (await readFile(resolve(evalDir, 'questions.jsonl'), 'utf8'))
    .split('\n').filter(line => line.trim()).map(line => JSON.parse(line) as KbEvalCase)
  const index = JSON.parse(await readFile(resolve(root, 'knowledge/kb-index.json'), 'utf8')) as KbIndexFile
  const corpusDir = resolve(root, 'knowledge/corpus')
  const corpus = await Promise.all((await readdir(corpusDir)).filter(n => n.endsWith('.md')).sort()
    .map(async name => parseCorpusFile(await readFile(resolve(corpusDir, name), 'utf8'), name)))
  const missing = unknownGold(cases, index.chunks)
  if (missing.length) throw new Error(`Gold labels name provisions that do not exist: ${missing.join(', ')}`)
  return { cases, index, corpus }
}

function modelFactory(provider: string, model: string | undefined): KnowledgePipelineDeps['chatModel'] {
  return ({ purpose, thinking }) => createRequestModel({ provider, model }, {
    thinking: { type: thinking ? 'enabled' : 'disabled' },
    ...(purpose === 'analysis' ? { temperature: 0, timeout: 15000, maxRetries: 1 } : { timeout: 60000 }),
  })
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), Math.max(1, items.length)) }, async () => {
    while (true) {
      const index = next++
      if (index >= items.length) break
      results[index] = await fn(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

async function runRetrievalVariant(
  variant: RetrievalVariant,
  inputs: Awaited<ReturnType<typeof loadInputs>>,
  model: { provider: string; model?: string },
  concurrency: number,
) {
  const kb = await variant.build(inputs)
  const locate = locatorsById(kb)
  const embed = variant.vectors && kb.embedding ? createServerEmbedder(kb.embedding) : null
  if (variant.vectors && !embed) throw new Error('needs an index built with --embed and the server key for its embedding provider')
  const chat = variant.rewrite ? modelFactory(model.provider, model.model)({ purpose: 'analysis', thinking: false }) : undefined
  const rows = await mapConcurrent(inputs.cases, chat || embed ? concurrency : 1, async (evalCase) => {
    const started = performance.now()
    let queries = [evalCase.question]
    if (chat) {
      try {
        queries = retrievalQueries(evalCase.question, await analyzeQuery(chat as KnowledgeChatModel, evalCase.question, evalCase.history ?? []))
      } catch { /* the app falls back to the original question too */ }
    }
    const queryVectors = embed ? await embed(queries) : undefined
    const hits = retrieve(kb, queries, { topK: TOP_K, queryVectors, minSimilarity: Number(process.env.KB_MIN_SIMILARITY) || 0.3, relevance: variant.relevance })
    const ranked = hits.map(hit => locate.get(hit.chunk.id) ?? [])
    return {
      evalCase,
      score: scoreRetrieval(evalCase, ranked),
      retrieved: hits.map(hit => hit.chunk.id),
      queries,
      latencyMs: Math.round(performance.now() - started),
    }
  })
  return { metrics: summarizeRetrieval(rows), rows }
}

function retrievalTable(results: { variant: RetrievalVariant; metrics: RetrievalMetrics }[]): string {
  const header = `| 配置 | Hit@1 | Hit@3 | Hit@5 | Recall@5 | Recall@10 | 完整@10 | MRR | 库内空检索 ↓ | 库外空检索 ↑ | 平均返回 |`
  const lines = results.map(({ variant, metrics: m }) =>
    `| ${variant.name} | ${pct(m.hitAt[1])} | ${pct(m.hitAt[3])} | ${pct(m.hitAt[5])} | ${pct(m.recallAt[5])} | ${pct(m.recallAt[10])} | ${pct(m.completeAt[10])} | ${m.mrr.toFixed(3)} | ${pct(m.emptyRate)} | ${pct(m.outOfScopeEmptyRate)} | ${m.meanRetrieved.toFixed(1)} |`)
  return [header, `|${'---|'.repeat(11)}`, ...lines].join('\n')
}

function categoryTable(rows: { evalCase: KbEvalCase; score: ReturnType<typeof scoreRetrieval> }[]): string {
  const categories = [...new Set(rows.map(r => r.evalCase.category))].filter(c => c !== 'out_of_scope')
  const lines = categories.map((category) => {
    const m = summarizeRetrieval(rows.filter(r => r.evalCase.category === category))
    return `| ${category} | ${m.cases} | ${pct(m.hitAt[1])} | ${pct(m.hitAt[5])} | ${pct(m.recallAt[10])} | ${m.mrr.toFixed(3)} |`
  })
  return ['| 类别 | 题数 | Hit@1 | Hit@5 | Recall@10 | MRR |', '|---|---|---|---|---|---|', ...lines].join('\n')
}

/**
 * In-scope Hit@5 and empty-retrieval rates for a grid of relevance gates on the committed
 * index, without a model: the evidence behind KEYWORD_RELEVANCE.
 */
function gateSweep(kb: KnowledgeBase, cases: KbEvalCase[]): string {
  const locate = locatorsById(kb)
  const coverages = [0.1, 0.15, 0.2, 0.3]
  const idfs = [4, 5, 6, 7, 8, Infinity]
  const cell = (gate: RelevanceGate) => {
    const m = summarizeRetrieval(cases.map(evalCase => ({
      evalCase,
      score: scoreRetrieval(evalCase, retrieve(kb, [evalCase.question], { topK: TOP_K, relevance: gate }).map(h => locate.get(h.chunk.id) ?? [])),
    })))
    const chosen = gate.minCoverage === KEYWORD_RELEVANCE.minCoverage && gate.minMatchedIdf === KEYWORD_RELEVANCE.minMatchedIdf
    const text = `${pct(m.hitAt[5])} / ${pct(m.emptyRate)} / ${pct(m.outOfScopeEmptyRate)}`
    return chosen ? `**${text}**` : text
  }
  const header = `| 覆盖率 \\ 命中 IDF | ${idfs.map(v => (v === Infinity ? '不用' : `≥ ${v}`)).join(' | ')} |`
  const rows = coverages.map(c => `| ≥ ${c} | ${idfs.map(v => cell({ minCoverage: c, minMatchedIdf: v })).join(' | ')} |`)
  return [
    '每格为：库内 Hit@5 / 库内空检索 ↓ / 库外空检索 ↑。加粗为当前线上门槛。门槛是在这份评测集上调出来的，数字偏乐观，需要新题验证。',
    header, `|${'---|'.repeat(idfs.length + 1)}`, ...rows,
  ].join('\n')
}

function answerMarkdown(
  commit: string,
  model: { provider: string; model?: string },
  judgeModel: { provider: string; model?: string } | null,
  metrics: AnswerMetrics,
  rows: { evalCase: KbEvalCase; outcome: AnswerOutcome; score: AnswerScore }[],
): string {
  const summaryRows = [
    `| 指标 | 数值 |`,
    `|---|---|`,
    `| 库内题数 / 库外题数 / 出错 | ${metrics.cases} / ${metrics.outOfScopeCases} / ${metrics.errors} |`,
    `| 库内回答率 | ${pct(metrics.answeredRate)} |`,
    `| 引用有效率（已回答题） | ${pct(metrics.citationValidRate)} |`,
    `| 引用准确率（命中的标准条款占比） | ${pct(metrics.citedPrecision)} |`,
    `| 要点覆盖率 | ${pct(metrics.goldCoverage)} |`,
    `| 库外拒答率 | ${pct(metrics.outOfScopeRefusalRate)} |`,
    ...(metrics.faithfulness ? [
      `| 忠实度通过率（LLM-as-a-Judge，${metrics.faithfulness.judged} 题） | ${pct(metrics.faithfulness.faithfulRate)}（均分 ${metrics.faithfulness.meanScore.toFixed(3)}，判分出错 ${metrics.faithfulness.errors}） |`,
    ] : []),
    `| 延迟 P50 / P90 | ${Math.round(metrics.latencyMs.p50)} ms / ${Math.round(metrics.latencyMs.p90)} ms |`,
    `| 平均模型调用次数 | ${metrics.meanModelCalls.toFixed(2)} |`,
  ].join('\n')

  const categories = [...new Set(rows.map(r => r.evalCase.category))].filter(c => c !== 'out_of_scope')
  const catLines = categories.map((category) => {
    const m = summarizeAnswers(rows.filter(r => r.evalCase.category === category))
    const faith = m.faithfulness ? `${pct(m.faithfulness.faithfulRate)} (${m.faithfulness.meanScore.toFixed(2)})` : '—'
    return `| ${category} | ${m.cases} | ${pct(m.answeredRate)} | ${pct(m.citationValidRate)} | ${pct(m.citedPrecision)} | ${pct(m.goldCoverage)} | ${faith} |`
  })
  const catTable = [
    '| 类别 | 题数 | 回答率 | 引用有效率 | 引用准确率 | 要点覆盖率 | 忠实度 |',
    '|---|---|---|---|---|---|---|',
    ...catLines,
  ].join('\n')

  const notable = rows.filter(r =>
    r.outcome.error
    || (r.evalCase.gold.length > 0 && (r.score.refused || r.score.goldGroupsCited < r.score.goldGroups || r.score.faithful === false))
    || (r.evalCase.gold.length === 0 && !r.score.refused),
  )
  const issueLines = notable.length
    ? notable.map((r) => {
      const tags: string[] = []
      if (r.outcome.error) tags.push(`出错: ${r.outcome.error}`)
      else if (r.evalCase.gold.length === 0) tags.push('库外未拒答')
      else {
        if (r.score.refused) tags.push('库内误拒答')
        if (r.score.goldGroupsCited < r.score.goldGroups) tags.push(`要点覆盖 ${r.score.goldGroupsCited}/${r.score.goldGroups}`)
        if (r.score.faithful === false) tags.push(`忠实度 ${r.score.faithfulnessScore}：${r.outcome.faithfulness?.reason ?? ''}`)
      }
      return `- \`${r.evalCase.id}\` (${r.evalCase.category}) ${r.evalCase.question} — ${tags.join('；')}`
    }).join('\n')
    : '无异常样例。'

  const judgeNote = judgeModel ? `，忠实度评审模型：${judgeModel.provider}/${judgeModel.model ?? 'default'}` : ''
  return [
    `## 知识库端到端回答评测（${rows.length} 题，${model.provider}/${model.model ?? 'default'}${judgeNote}，commit ${commit}）`,
    summaryRows,
    '### 分类别表现',
    catTable,
    `### 需关注样例（${notable.length} 题）`,
    issueLines,
  ].join('\n\n')
}

async function runAnswers(
  inputs: Awaited<ReturnType<typeof loadInputs>>,
  options: { provider: string; model?: string; now?: Date; judge?: { provider: string; model?: string } | null; concurrency: number },
) {
  const { createKnowledgeBase } = await import('../../src/server/knowledge/knowledge-base')
  const kb = createKnowledgeBase(inputs.index)
  const locate = locatorsById(kb)
  const factory = modelFactory(options.provider, options.model)
  const judgeModel = options.judge ? modelFactory(options.judge.provider, options.judge.model)({ purpose: 'analysis', thinking: false }) as KnowledgeChatModel : null
  const rows = await mapConcurrent(inputs.cases, options.concurrency, async (evalCase) => {
    let modelCalls = 0
    const chatModel: KnowledgePipelineDeps['chatModel'] = (opts) => {
      const model = factory(opts)
      return {
        invoke: (params) => { modelCalls++; return model.invoke(params) },
        invokeStream: (params) => { modelCalls++; return model.invokeStream(params) },
      }
    }
    const outcome: AnswerOutcome = { text: '', citations: [], modelCalls: 0, latencyMs: 0 }
    const started = performance.now()
    try {
      const chunks: KnowledgeStreamChunk[] = []
      for await (const chunk of runKnowledgePipeline({
        message: evalCase.question,
        history: evalCase.history ?? [],
        useWebSearch: false,
        useBaseModel: false,
        answerMode: 'standard',
      }, {
        knowledgeBase: async () => kb,
        chatModel,
        embedder: kb.embedding ? createServerEmbedder(kb.embedding) : null,
        now: options.now ? () => options.now! : undefined,
      })) chunks.push(chunk)
      outcome.text = chunks.filter(c => c.type === 'text').map(c => (c as { content: string }).content).join('')
      const evidence = chunks.filter(c => c.type === 'evidence' && c.citations).at(-1)
      outcome.citations = evidence?.type === 'evidence' ? evidence.citations ?? [] : []
      const check = chunks.filter(c => c.type === 'tool' && c.id === 'citation_check').at(-1)
      if (check?.type === 'tool') outcome.citationCheck = { status: check.status, output: check.output }
    } catch (error) {
      outcome.error = error instanceof Error ? error.message : String(error)
    }
    outcome.modelCalls = modelCalls
    outcome.latencyMs = Math.round(performance.now() - started)
    let score = scoreAnswer(evalCase, outcome, id => locate.get(id) ?? [])
    if (judgeModel && !outcome.error && !score.refused && outcome.citations.length > 0) {
      try {
        const today = beijingDate(options.now ?? new Date())
        outcome.faithfulness = await judgeFaithfulness(judgeModel, evalCase.question, outcome.text, outcome.citations, today)
        score = scoreAnswer(evalCase, outcome, id => locate.get(id) ?? [])
      } catch (error) {
        outcome.faithfulnessError = error instanceof Error ? error.message : String(error)
      }
    }
    const faithTag = outcome.faithfulness ? ` · 忠实 ${outcome.faithfulness.score}` : outcome.faithfulnessError ? ' · 评审失败' : ''
    console.log(`${evalCase.id} ${outcome.error ? `ERROR ${outcome.error}` : `${score.refused ? '拒答' : `引用 ${score.citedRelevant}/${score.cited} 相关`}${faithTag} · ${outcome.latencyMs}ms`}`)
    return { evalCase, outcome, score }
  })
  return { metrics: summarizeAnswers(rows), rows }
}

async function main() {
  const { values } = parseArgs({
    options: {
      mode: { type: 'string', default: 'retrieval' },
      variants: { type: 'string' },
      provider: { type: 'string', default: 'deepseek' },
      model: { type: 'string' },
      judge: { type: 'boolean', default: false },
      'judge-provider': { type: 'string' },
      'judge-model': { type: 'string' },
      concurrency: { type: 'string', default: '4' },
      now: { type: 'string' },
      filter: { type: 'string' },
      out: { type: 'string' },
    },
  })
  if (existsSync(resolve(root, '.env'))) process.loadEnvFile(resolve(root, '.env'))
  const loaded = await loadInputs()
  // --filter takes category names or id prefixes, comma-separated.
  const filters = values.filter?.split(',').map(f => f.trim()).filter(Boolean) ?? []
  const inputs = { ...loaded, cases: loaded.cases.filter(c => !filters.length || filters.some(f => c.category === f || c.id.startsWith(f))) }
  if (!inputs.cases.length) throw new Error('No evaluation questions matched --filter')
  let commit = 'unknown'
  try { commit = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim() } catch { /* not a checkout */ }
  const startedAt = new Date().toISOString()
  const stamp = startedAt.replace(/[:.]/g, '-').slice(0, 19)
  const model = { provider: values.provider!, model: values.model }
  const concurrency = Math.max(1, Number(values.concurrency) || 4)

  if (values.mode === 'answer') {
    const judgeModel = values.judge
      ? { provider: values['judge-provider'] ?? model.provider, model: values['judge-model'] ?? model.model }
      : null
    const { metrics, rows } = await runAnswers(inputs, { ...model, now: values.now ? new Date(values.now) : undefined, judge: judgeModel, concurrency })
    const report = { mode: 'answer', model, judgeModel, commit, startedAt, metrics, rows: rows.map(({ evalCase, outcome, score }) => ({ id: evalCase.id, category: evalCase.category, score, outcome })) }
    const outPath = values.out ? resolve(values.out) : resolve(evalDir, 'results', `${stamp}-answer-${model.provider}-${model.model ?? 'default'}.json`)
    const markdown = answerMarkdown(commit, model, judgeModel, metrics, rows)
    await mkdir(resolve(outPath, '..'), { recursive: true })
    await writeFile(outPath, JSON.stringify(report, null, 2) + '\n')
    await writeFile(outPath.replace(/\.json$/, '.md'), markdown + '\n')
    console.log(`\n${markdown}\n\nSaved ${outPath}`)
    return
  }

  const names = values.variants ? values.variants.split(',').map(v => v.trim()) : OFFLINE_VARIANTS
  const results = []
  for (const name of names) {
    const variant = VARIANTS.find(v => v.name === name)
    if (!variant) throw new Error(`Unknown variant ${name}; available: ${VARIANTS.map(v => v.name).join(', ')}`)
    try {
      const { metrics, rows } = await runRetrievalVariant(variant, inputs, model, concurrency)
      results.push({ variant, metrics, rows })
      console.log(`${variant.name}: Hit@5 ${pct(metrics.hitAt[5])} · Recall@10 ${pct(metrics.recallAt[10])} · MRR ${metrics.mrr.toFixed(3)}`)
    } catch (error) {
      console.log(`${variant.name}: 跳过（${error instanceof Error ? error.message : error}）`)
    }
  }
  if (!results.length) throw new Error('No variant could run')
  const categorySections = results.length <= 3
    ? results.flatMap(r => [`### ${r.variant.name} 分类别`, categoryTable(r.rows)])
    : (() => {
      const baseline = results.find(r => r.variant.name === 'baseline') ?? results[0]
      return [`### ${baseline.variant.name} 分类别`, categoryTable(baseline.rows)]
    })()
  const markdown = [
    `## 检索评测（${inputs.cases.length} 题，Top ${TOP_K}，commit ${commit}）`,
    retrievalTable(results),
    ...categorySections,
    '### 相关性门槛扫描（baseline 索引，仅原问题）',
    gateSweep(await VARIANTS[0].build(inputs), inputs.cases),
    '### 配置说明',
    results.map(r => `- **${r.variant.name}**：${r.variant.description}`).join('\n'),
  ].join('\n\n')
  const report = {
    mode: 'retrieval', commit, startedAt, topK: TOP_K, ks: KS,
    variants: results.map(({ variant, metrics, rows }) => ({
      name: variant.name,
      description: variant.description,
      metrics,
      rows: rows.map(r => ({ id: r.evalCase.id, category: r.evalCase.category, ...r.score, retrieved: r.retrieved, queries: r.queries, latencyMs: r.latencyMs })),
    })),
  }
  const outPath = values.out ? resolve(values.out) : resolve(evalDir, 'results', `${stamp}-retrieval.json`)
  await mkdir(resolve(outPath, '..'), { recursive: true })
  await writeFile(outPath, JSON.stringify(report, null, 2) + '\n')
  await writeFile(outPath.replace(/\.json$/, '.md'), markdown + '\n')
  console.log(`\n${markdown}\n\nSaved ${outPath}`)
}

await main()
