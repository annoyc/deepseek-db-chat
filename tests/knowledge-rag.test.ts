import test, { afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import committedIndex from '../knowledge/kb-index.json'
import { embedTexts } from '../src/core/model/embed'
import type { InvokeParams } from '../src/core/model/types'
import { KnowledgeContextPanel } from '../src/components/knowledge/KnowledgeContextPanel'
import type { KnowledgeMessage, KnowledgeStreamChunk } from '../src/lib/knowledge-types'
import { Bm25Index } from '../src/lib/retrieval/bm25'
import { chunkDocument } from '../src/server/knowledge/chunker'
import { checkCitations } from '../src/server/knowledge/citations'
import { parseCorpusFile } from '../src/server/knowledge/corpus'
import { buildIndex, decodeVectors, encodeVectors } from '../src/server/knowledge/index-builder'
import { createKnowledgeBase } from '../src/server/knowledge/knowledge-base'
import { NO_EVIDENCE_ANSWER, runKnowledgePipeline, type KnowledgePipelineDeps, type KnowledgePipelineInput } from '../src/server/knowledge/pipeline'
import { buildAnswerMessages } from '../src/server/knowledge/prompt'
import { retrievalQueries } from '../src/server/knowledge/query-analysis'
import { fuseRankings, retrieve } from '../src/server/knowledge/retriever'
import { tokenize, tokenizeQuery } from '../src/lib/retrieval/tokenizer'
import type { KbDocument, KbIndexFile } from '../src/server/knowledge/types'
import { beijingDate, documentStatus } from '../src/server/knowledge/validity'
import { createBochaWebSearch } from '../src/server/knowledge/web-search'

afterEach(() => mock.restoreAll())

const corpusDir = resolve(process.cwd(), 'knowledge/corpus')
const corpus: KbDocument[] = readdirSync(corpusDir).filter(name => name.endsWith('.md')).sort()
  .map(name => parseCorpusFile(readFileSync(resolve(corpusDir, name), 'utf8'), name))
const kb = createKnowledgeBase(committedIndex as unknown as KbIndexFile)
const ARTICLE_LINE = /^第[一二三四五六七八九十百零〇]+条(?=\s)/gm

// ── Corpus and chunking ─────────────────────────────────────

test('corpus keeps every article of the five source regulations', () => {
  const counts = Object.fromEntries(corpus.map(doc => [doc.meta.id, doc.body.match(ARTICLE_LINE)?.length ?? 0]))
  assert.deepEqual(counts, {
    'ancillary-service-market-2025': 67,
    'mid-long-term-market-2025': 98,
    'power-market-operation-2024': 45,
    'retail-company-2021': 46,
    'spot-market-2023': 129,
  })
})

test('chunks cover every article once, stay within size limits and keep glossary entries separate', () => {
  for (const doc of corpus) {
    const chunks = chunkDocument(doc)
    const inChunks = chunks.flatMap(chunk => chunk.text.match(ARTICLE_LINE) ?? [])
    assert.deepEqual(inChunks, doc.body.match(ARTICLE_LINE), doc.meta.id)
    for (const chunk of chunks) assert.ok(chunk.text.length <= 700, `${chunk.id} has ${chunk.text.length} chars`)
  }
  const spot = chunkDocument(corpus.find(doc => doc.meta.id === 'spot-market-2023')!)
  const lmp = spot.find(chunk => chunk.label === '名词解释 7. 节点边际电价')
  assert.ok(lmp?.text.startsWith('7．节点边际电价'))
  assert.deepEqual(lmp?.headings, ['附件 名词解释'])
  assert.ok(spot.some(chunk => /^第九十一条（1\/\d）$/.test(chunk.label)), 'long articles are split with part labels')
  const article = spot.find(chunk => chunk.text.startsWith('第三十一条'))
  assert.deepEqual(article?.headings, ['第四章 市场构成与价格', '第二节 价格机制'])
})

test('committed index matches the corpus (run pnpm kb:ingest after editing knowledge/corpus)', async () => {
  const rebuilt = await buildIndex(corpus)
  const committed = committedIndex as unknown as KbIndexFile
  assert.equal(committed.corpusHash, rebuilt.corpusHash)
  assert.deepEqual(committed.chunks.map(c => [c.id, c.hash]), rebuilt.chunks.map(c => [c.id, c.hash]))
})

test('corpus front matter is validated', () => {
  assert.throws(() => parseCorpusFile('# 无元数据'), /missing front matter/)
  assert.throws(() => parseCorpusFile('---\nid: a\n---\n'), /title is required/)
  assert.throws(() => parseCorpusFile('---\nid: a\ntitle: t\neffectiveFrom: 2024/1/1\n---\n'), /YYYY-MM-DD/)
  assert.throws(() => parseCorpusFile('---\nid: a\ntitle: t\nauthor: x\n---\n'), /unknown front matter key/)
})

// ── Tokenizer, BM25, fusion ─────────────────────────────────

test('tokenizer adds CJK bigrams, drops question filler and does not bridge function characters', () => {
  assert.ok(tokenize('售电公司').includes('售电'))
  const query = tokenizeQuery('什么是边际机组？')
  assert.ok(query.includes('边际') && query.includes('机组'))
  assert.ok(!query.includes('什么'))
  const tokens = tokenize('市场的构成')
  assert.ok(tokens.includes('构成'))
  assert.ok(!tokens.includes('场的') && !tokens.includes('的构'))
  assert.ok(tokenize('LMP 节点边际电价').includes('lmp'))
})

test('BM25 ranks documents with rarer matching terms higher', () => {
  const index = new Bm25Index([['电力', '市场'], ['电力', '绿电', '结算'], ['电力']])
  const hits = index.search(['绿电', '电力'], 10)
  assert.equal(hits[0].index, 1)
  assert.equal(index.search(['不存在'], 10).length, 0)
})

test('reciprocal rank fusion rewards agreement between ranked lists', () => {
  const scores = fuseRankings([['a', 'b', 'c'], ['b', 'd']])
  assert.ok(scores.get('b')! > scores.get('a')!)
  assert.equal(scores.get('a'), 1 / 61)
  assert.equal(scores.get('b'), 1 / 62 + 1 / 61)
})

test('keyword retrieval finds the governing provisions in the sample corpus', () => {
  const top = (query: string, k: number) => retrieve(kb, [query], { topK: k }).map(hit => `${hit.doc.id}:${hit.chunk.text.slice(0, 12)}`)
  assert.ok(top('绿电的价格怎么结算？', 3).some(id => id.startsWith('mid-long-term-market-2025:第七十七条')))
  assert.ok(top('售电公司注册的资产总额要求', 5).some(id => id.startsWith('retail-company-2021:第五条')))
  assert.ok(top('节点边际电价', 3).some(id => id.includes('7．节点边际电价')))
  assert.deepEqual(retrieve(kb, ['今天天气怎么样'], { topK: 5 }), [])
})

test('keyword hits matching only a common word are dropped instead of filling every slot', () => {
  // Regression: a résumé question rewritten with 个人博客 matched "任何单位和个人" in three rules.
  assert.deepEqual(retrieve(kb, ['个人博客 主页 链接 GitHub'], { topK: 6 }), [])
  const coverage = kb.bm25.search(tokenizeQuery('个人博客 主页 链接 GitHub'), 3)
  assert.ok(coverage.length > 0 && coverage.every(hit => hit.coverage < 0.2), 'the dropped hits really were weak')
  // Topical questions keep their provisions, including ones phrased with filler.
  const ids = (q: string) => retrieve(kb, [q], { topK: 6 }).map(hit => `${hit.doc.id}:${hit.chunk.text.slice(0, 6)}`)
  assert.ok(ids('售电公司参与绿电交易需要注意什么').some(id => id.startsWith('mid-long-term-market-2025:第五十一条')))
  assert.equal(ids('绿电的价格怎么结算？').length, 6)
  assert.ok(ids('现货市场和中长期市场如何衔接').length >= 3)
})

// ── Vectors and embeddings ──────────────────────────────────

const fakeDocs: KbDocument[] = [
  { meta: { id: 'a', title: '甲规则' }, body: '## 第一章 总则\n\n第一条 售电公司注册条件。\n\n第二条 交易结算规则。' },
  { meta: { id: 'b', title: '乙规则' }, body: '## 第一章 总则\n\n第一条 备用容量补偿。' },
]

/** Deterministic 4-d "embedding": one axis per topic keyword. */
function fakeEmbed(texts: string[]): Promise<Float32Array[]> {
  return Promise.resolve(texts.map((text) => {
    const v = new Float32Array([text.includes('售电') ? 1 : 0, text.includes('结算') ? 1 : 0, text.includes('容量') ? 1 : 0, 0.01])
    const norm = Math.hypot(...v)
    return v.map(x => x / norm)
  }))
}

test('index vectors round-trip and unchanged chunks reuse previous embeddings', async () => {
  const info = { provider: 'bailian', model: 'fake', dimensions: 4 }
  let embedded = 0
  const embed = async (texts: string[]) => { embedded += texts.length; return fakeEmbed(texts) }
  const first = await buildIndex(fakeDocs, { embedding: { info, embed } })
  // The two short articles of document a are merged into one chunk.
  assert.deepEqual(first.chunks.map(c => c.label), ['第一条至第二条', '第一条'])
  assert.equal(embedded, 2)
  const flat = decodeVectors(first.embedding!.vectors, 2, 4)
  assert.equal(encodeVectors([flat.slice(0, 4), flat.slice(4)]), first.embedding!.vectors)

  const changed = [fakeDocs[0], { ...fakeDocs[1], body: fakeDocs[1].body.replace('备用', '调峰') }]
  embedded = 0
  await buildIndex(changed, { embedding: { info, embed }, previous: first })
  assert.equal(embedded, 1, 'only the edited chunk is embedded again')
  embedded = 0
  await buildIndex(changed, { embedding: { info: { ...info, model: 'other' }, embed }, previous: first })
  assert.equal(embedded, 2, 'a different model never reuses vectors')
})

test('hybrid retrieval surfaces vector-only matches and records which retriever found each hit', async () => {
  const info = { provider: 'bailian', model: 'fake', dimensions: 4 }
  const base = createKnowledgeBase(await buildIndex(fakeDocs, { embedding: { info, embed: fakeEmbed } }))
  const [vector] = await fakeEmbed(['容量'])
  const hits = retrieve(base, ['调频补偿'], { topK: 3, queryVectors: [vector], minSimilarity: 0.5 })
  const capacity = hits.find(hit => hit.chunk.docId === 'b')
  assert.ok(capacity?.denseRank, 'found by vector search')
  assert.equal(hits.some(hit => hit.chunk.docId === 'a' && hit.denseRank), false, 'below the similarity floor')
})

test('embedding client batches requests and returns unit vectors in input order', async () => {
  const bodies: any[] = []
  mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    bodies.push(body)
    // Reply out of order to check the client sorts by index.
    return Response.json({ data: body.input.map((_: string, i: number) => ({ index: i, embedding: [3 * (i + 1), 4 * (i + 1)] })).reverse() })
  })
  const vectors = await embedTexts({ baseURL: 'https://embed.test/v1', apiKey: 'k', model: 'm', dimensions: 2, batchSize: 2 }, ['a', 'b', 'c'])
  assert.deepEqual(bodies.map(b => b.input), [['a', 'b'], ['c']])
  assert.equal(bodies[0].dimensions, 2)
  assert.deepEqual(vectors.map(v => [...v].map(x => Number(x.toFixed(2)))), [[0.6, 0.8], [0.6, 0.8], [0.6, 0.8]])
  mock.restoreAll()
  mock.method(globalThis, 'fetch', async () => Response.json({ data: [{ index: 0, embedding: [1, 2, 3] }] }))
  await assert.rejects(embedTexts({ baseURL: 'https://embed.test/v1', apiKey: 'k', model: 'm', dimensions: 2 }, ['a']), /does not match/)
})

// ── Validity, citations, prompt ─────────────────────────────

test('document status follows Beijing dates', () => {
  assert.equal(beijingDate(new Date('2026-10-15T16:30:00Z')), '2026-10-16')
  const spot = { effectiveFrom: '2023-10-15', effectiveUntil: '2026-10-15' }
  assert.equal(documentStatus(spot, '2026-10-15').status, 'active')
  assert.equal(documentStatus(spot, '2026-10-16').status, 'expired')
  assert.equal(documentStatus({ effectiveFrom: '2026-03-01' }, '2026-02-28').status, 'pending')
  assert.equal(documentStatus({}, '2026-01-01').label, '有效期内')
})

test('citation check accepts common marker styles and flags unknown references', () => {
  const check = checkCitations('结论[1][2]，另见【3】和[1,W1]；年份[2026]不是引用', ['1', '2', '3', 'W1'])
  assert.deepEqual(check.cited, ['1', '2', '3', 'W1'])
  assert.deepEqual(check.invalid, [])
  assert.deepEqual(checkCitations('见[7]', ['1']).invalid, ['7'])
})

test('answer prompt numbers sources, carries validity and strips stale markers from history', () => {
  const messages = buildAnswerMessages({
    question: '绿电怎么结算？',
    history: [{ role: 'assistant', content: '上一轮结论[3]' }],
    citations: [{ ref: '1', chunkId: 'x#1', docTitle: '甲规则', locator: '第一条', headings: ['第一章 总则'], text: '条文', status: 'expired', statusLabel: '已过有效期（2026-10-15 到期）', retrievers: ['keyword'] }],
    webResults: [{ title: '网页', url: 'https://example.com' }],
    answerMode: 'concise',
    useBaseModel: false,
    today: '2026-11-09',
  })
  assert.equal(messages[0].role, 'system')
  assert.equal(messages[1].content, '上一轮结论')
  const prompt = messages.at(-1)!.content as string
  assert.ok(prompt.includes('[1] 《甲规则》第一条｜第一章 总则｜已过有效期（2026-10-15 到期）'))
  assert.ok(prompt.includes('[W1] 网页'))
  assert.ok(prompt.includes('只能依据参考资料回答'))
  assert.ok(prompt.includes('当前日期：2026-11-09'))
  assert.deepEqual(retrievalQueries('原问题', { standalone: '原问题', subQuestions: ['子问题'], keywords: ['术语1', '术语2'] }), ['原问题', '子问题', '术语1 术语2'])
})

// ── Pipeline ────────────────────────────────────────────────

interface ModelCall { purpose: string; thinking: boolean; messages: InvokeParams['messages'] }

function fakeChatModel(options: { analysis?: string | Error; answer?: string[] } = {}) {
  const calls: ModelCall[] = []
  const factory: KnowledgePipelineDeps['chatModel'] = ({ purpose, thinking }) => ({
    async invoke(params) {
      calls.push({ purpose, thinking, messages: params.messages })
      if (options.analysis instanceof Error) throw options.analysis
      return { choices: [{ message: { content: options.analysis ?? '{"standalone":"绿电交易价格如何结算","subQuestions":[],"keywords":["绿电环境价值","分开结算"]}' } }] } as any
    },
    async *invokeStream(params) {
      calls.push({ purpose, thinking, messages: params.messages })
      for (const content of options.answer ?? ['电能量与绿电环境价值分开结算', '[1]。']) yield { choices: [{ delta: { content } }] } as any
    },
  })
  return { factory, calls }
}

async function runPipeline(input: Partial<KnowledgePipelineInput>, deps: Partial<KnowledgePipelineDeps> = {}) {
  const chunks: KnowledgeStreamChunk[] = []
  for await (const chunk of runKnowledgePipeline(
    { message: '绿电的价格怎么结算？', history: [], useWebSearch: false, useBaseModel: true, answerMode: 'standard', ...input },
    { knowledgeBase: async () => kb, chatModel: fakeChatModel().factory, now: () => new Date('2026-11-09T04:00:00Z'), ...deps },
  )) chunks.push(chunk)
  const tools = chunks.filter((c): c is Extract<KnowledgeStreamChunk, { type: 'tool' }> => c.type === 'tool')
  const finalStatus = (id: string) => tools.filter(t => t.id === id).at(-1)
  const text = chunks.filter(c => c.type === 'text').map(c => (c as { content: string }).content).join('')
  const citations = chunks.filter(c => c.type === 'evidence' && c.citations).at(-1) as Extract<KnowledgeStreamChunk, { type: 'evidence' }> | undefined
  return { chunks, tools, finalStatus, text, citations: citations?.citations ?? [] }
}

test('pipeline runs each stage in order, streams the answer and marks cited provisions', async () => {
  const model = fakeChatModel()
  const run = await runPipeline({}, { chatModel: model.factory })
  const order = [...new Set(run.tools.map(t => t.id))]
  assert.deepEqual(order, ['guardrail', 'query_rewrite', 'kb_retrieve', 'synthesis', 'citation_check'])
  assert.ok(run.tools.filter(t => t.status !== 'running').every(t => typeof t.durationMs === 'number'))
  assert.equal(run.text, '电能量与绿电环境价值分开结算[1]。')
  assert.equal(run.finalStatus('citation_check')?.status, 'done')
  assert.equal(run.citations[0].cited, true)
  assert.equal(run.citations.slice(1).some(c => c.cited), false)
  assert.ok(run.citations.some(c => c.docTitle === '电力中长期市场基本规则' && c.locator === '第七十七条'))
  assert.deepEqual(model.calls.map(c => [c.purpose, c.thinking]), [['analysis', false], ['answer', false]])
  const prompt = model.calls[1].messages.at(-1)!.content as string
  assert.ok(prompt.includes('[1] 《'), 'retrieved provisions are numbered in the prompt')
})

test('expired regulations are labelled in citations and the prompt', async () => {
  const model = fakeChatModel({ analysis: new Error('offline') })
  const run = await runPipeline({ message: '节点边际电价是什么？', answerMode: 'concise' }, { chatModel: model.factory })
  const lmp = run.citations.find(c => c.locator === '名词解释 7. 节点边际电价')
  assert.equal(lmp?.status, 'expired')
  assert.equal(lmp?.statusLabel, '已过有效期（2026-10-15 到期）')
  assert.ok((model.calls.at(-1)!.messages.at(-1)!.content as string).includes('已过有效期'))
})

test('strict mode without evidence refuses without calling the model', async () => {
  const model = fakeChatModel()
  const run = await runPipeline({ message: '今天天气怎么样', useBaseModel: false, answerMode: 'concise' }, { chatModel: model.factory })
  assert.equal(run.text, NO_EVIDENCE_ANSWER)
  assert.equal(model.calls.length, 0)
  assert.equal(run.finalStatus('kb_retrieve')?.output, '未检索到相关条款')
})

test('a failed rewrite degrades to the original question; PII never reaches the model', async () => {
  const model = fakeChatModel({ analysis: new Error('timeout') })
  const run = await runPipeline({ message: '我的手机号13812345678，绿电怎么结算', history: [{ role: 'user', content: '上一问' }] }, { chatModel: model.factory })
  assert.equal(run.finalStatus('query_rewrite')?.output, '改写不可用，按原问题检索')
  assert.match(run.finalStatus('guardrail')?.output ?? '', /脱敏/)
  for (const call of model.calls) assert.equal(JSON.stringify(call.messages).includes('13812345678'), false)
  assert.ok(run.text.length > 0)
})

test('web search reports a missing configuration but still answers; invalid citations are flagged', async () => {
  const model = fakeChatModel({ answer: ['结论[9]'] })
  const run = await runPipeline({ useWebSearch: true }, { chatModel: model.factory })
  assert.equal(run.finalStatus('web_search')?.status, 'error')
  assert.equal(run.finalStatus('web_search')?.output, '服务器未配置联网搜索')
  assert.equal(run.finalStatus('citation_check')?.status, 'error')
  assert.match(run.finalStatus('citation_check')?.output ?? '', /\[9\]/)

  const withWeb = await runPipeline({ useWebSearch: true }, {
    chatModel: fakeChatModel({ answer: ['见[W1]'] }).factory,
    webSearch: async () => [{ title: '网页', url: 'https://example.com/a' }],
  })
  assert.equal(withWeb.finalStatus('web_search')?.status, 'done')
  assert.equal(withWeb.finalStatus('citation_check')?.status, 'done')
  assert.ok(withWeb.chunks.some(c => c.type === 'evidence' && c.webResults?.length === 1))
})

test('deep mode answers with thinking enabled and a larger evidence set', async () => {
  const model = fakeChatModel()
  const run = await runPipeline({ answerMode: 'deep' }, { chatModel: model.factory })
  assert.equal(model.calls.at(-1)?.thinking, true)
  assert.equal(run.citations.length, 10)
})

test('Bocha web search maps results and is disabled without a key', async () => {
  assert.equal(createBochaWebSearch({}), null)
  mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, 'https://api.bochaai.com/v1/web-search')
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer key')
    return Response.json({ code: 200, data: { webPages: { value: [
      { name: '标题', url: 'https://example.com/a', summary: '摘要', siteName: '站点' },
      { name: '坏链接', url: 'javascript:alert(1)' },
    ] } } })
  })
  const search = createBochaWebSearch({ BOCHA_API_KEY: 'key' })!
  assert.deepEqual(await search('绿电'), [{ title: '标题', url: 'https://example.com/a', snippet: '摘要', site_name: '站点' }])
})

// ── Evidence panel ──────────────────────────────────────────

test('evidence panel lists cited provisions with validity and original-source links', () => {
  const message: KnowledgeMessage = {
    id: 'answer', role: 'assistant', content: '回答[1]', timestamp: '2026-11-09T00:00:00Z',
    evidence: {
      subQuestions: [], memorySnippets: [], progress: [], toolSteps: [],
      webResults: [{ title: '网页', url: 'https://example.com/w' }],
      citations: [
        { ref: '1', chunkId: 'a#1', docTitle: '电力中长期市场基本规则', locator: '第七十七条', headings: ['第八章 计量和结算'], text: '第七十七条 条文', status: 'active', statusLabel: '有效期内（至 2031-02-28）', sourceUrl: 'https://www.ndrc.gov.cn/rule.html', retrievers: ['keyword', 'vector'], cited: true },
        { ref: '2', chunkId: 'b#1', docTitle: '电力现货市场基本规则（试行）', locator: '第一条', headings: [], text: '第一条 条文', status: 'expired', statusLabel: '已过有效期（2026-10-15 到期）', retrievers: ['keyword'], cited: false },
      ],
    },
  }
  const markup = renderToStaticMarkup(createElement(KnowledgeContextPanel, { message, onClose() {} }))
  assert.ok(markup.includes('引用条款'))
  assert.ok(markup.includes('已引用 1/2'))
  assert.ok(markup.includes('《电力中长期市场基本规则》第七十七条'))
  assert.ok(markup.includes('已过有效期（2026-10-15 到期）'))
  assert.ok(markup.includes('href="https://www.ndrc.gov.cn/rule.html"'))
  assert.ok(markup.includes('[W1]'))
  assert.equal(markup.includes('暂无历史问答片段'), false)
})
