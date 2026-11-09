import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import committedIndex from '../knowledge/kb-index.json'
import { scoreAnswer, summarizeAnswers, type AnswerOutcome } from '../evals/knowledge/answer'
import { chunkLocators, scoreRetrieval, summarizeRetrieval, unknownGold, type KbEvalCase } from '../evals/knowledge/scorer'
import { VARIANTS } from '../evals/knowledge/variants'
import type { KnowledgeCitation } from '../src/lib/knowledge-types'
import { createKnowledgeBase } from '../src/server/knowledge/knowledge-base'
import { NO_EVIDENCE_ANSWER } from '../src/server/knowledge/pipeline'
import { retrieve } from '../src/server/knowledge/retriever'
import type { KbIndexFile } from '../src/server/knowledge/types'

const index = committedIndex as unknown as KbIndexFile
const cases: KbEvalCase[] = readFileSync(resolve(process.cwd(), 'evals/knowledge/questions.jsonl'), 'utf8')
  .split('\n').filter(line => line.trim()).map(line => JSON.parse(line))

test('evaluation questions are well-formed and every gold label names a real provision', () => {
  assert.ok(cases.length >= 80)
  assert.equal(new Set(cases.map(c => c.id)).size, cases.length, 'ids are unique')
  assert.deepEqual(unknownGold(cases, index.chunks), [])
  for (const c of cases) {
    assert.equal(c.category === 'out_of_scope', c.gold.length === 0, c.id)
    assert.ok(c.gold.every(group => group.length > 0), c.id)
    if (c.category === 'followup') assert.ok(c.history?.length, c.id)
  }
})

test('chunk locators cover merged articles, split parts and glossary entries', () => {
  assert.deepEqual(chunkLocators({ docId: 'd', label: '第三条至第四条', text: '第三条 甲。\n第四条 乙。' }), ['d:第三条', 'd:第四条'])
  assert.deepEqual(chunkLocators({ docId: 'd', label: '第九十一条（2/2）', text: '续文，没有条号。' }), ['d:第九十一条'])
  assert.deepEqual(chunkLocators({ docId: 'd', label: '名词解释 7. 节点边际电价', text: '7．节点边际电价…' }), ['d:名词解释7'])
  assert.deepEqual(chunkLocators({ docId: 'd', label: '正文（1/3）', text: '没有条款的通知' }), [])
})

test('retrieval scoring counts hits, recall over fact groups, completeness and MRR', () => {
  const evalCase: KbEvalCase = { id: 'x', category: 'multi', question: 'q', gold: [['d:第一条', 'd:第二条'], ['d:第九条']] }
  const score = scoreRetrieval(evalCase, [['d:第五条'], ['d:第二条'], ['d:第七条'], ['d:第九条']])
  assert.deepEqual(score, { retrieved: 4, firstHit: 2, groupRanks: [2, 4] })
  const outOfScope: KbEvalCase = { id: 'o', category: 'out_of_scope', question: 'q', gold: [] }
  const m = summarizeRetrieval([
    { evalCase, score },
    { evalCase: outOfScope, score: scoreRetrieval(outOfScope, []) },
    { evalCase: { ...outOfScope, id: 'o2' }, score: scoreRetrieval(outOfScope, [['d:第一条']]) },
  ])
  assert.equal(m.hitAt[1], 0)
  assert.equal(m.hitAt[3], 1)
  assert.equal(m.recallAt[3], 0.5)
  assert.equal(m.completeAt[3], 0)
  assert.equal(m.completeAt[5], 1)
  assert.equal(m.mrr, 0.5)
  assert.equal(m.outOfScopeEmptyRate, 0.5)
})

test('answer scoring separates refusals, valid citations and citations of gold provisions', () => {
  const evalCase: KbEvalCase = { id: 'x', category: 'lookup', question: 'q', gold: [['d:第一条']] }
  const citation = (ref: string, chunkId: string, cited: boolean): KnowledgeCitation => ({
    ref, chunkId, docTitle: 't', locator: '', headings: [], text: '', status: 'active', statusLabel: '', retrievers: ['keyword'], cited,
  })
  const locate = (id: string) => (id === 'c1' ? ['d:第一条'] : ['d:第八条'])
  const outcome: AnswerOutcome = {
    text: '结论[1][2]', citations: [citation('1', 'c1', true), citation('2', 'c2', true), citation('3', 'c3', false)],
    citationCheck: { status: 'done' }, modelCalls: 2, latencyMs: 900,
  }
  const score = scoreAnswer(evalCase, outcome, locate)
  assert.deepEqual(score, { refused: false, citationsValid: true, cited: 2, citedRelevant: 1, goldGroups: 1, goldGroupsCited: 1 })
  const refusal = scoreAnswer({ ...evalCase, gold: [] }, { ...outcome, text: NO_EVIDENCE_ANSWER, citations: [] }, locate)
  assert.equal(refusal.refused, true)
  const m = summarizeAnswers([
    { evalCase, outcome, score },
    { evalCase: { ...evalCase, gold: [] }, outcome: { ...outcome, text: NO_EVIDENCE_ANSWER }, score: refusal },
    { evalCase, outcome: { ...outcome, error: 'timeout' }, score },
  ])
  assert.equal(m.errors, 1)
  assert.equal(m.answeredRate, 1)
  assert.equal(m.citedPrecision, 0.5)
  assert.equal(m.outOfScopeRefusalRate, 1)
})

test('baseline retrieval quality does not regress (offline, keyword only)', async () => {
  const kb = await VARIANTS.find(v => v.name === 'baseline')!.build({ index, corpus: [] })
  const locate = new Map(kb.chunks.map(chunk => [chunk.id, chunkLocators(chunk)]))
  const m = summarizeRetrieval(cases.map(evalCase => ({
    evalCase,
    score: scoreRetrieval(evalCase, retrieve(kb, [evalCase.question], { topK: 10 }).map(hit => locate.get(hit.chunk.id) ?? [])),
  })))
  // Baseline at the time of writing: Hit@5 89.9%, in-scope empty 6.3%, out-of-scope empty 90%.
  assert.ok(m.hitAt[5] >= 0.85, `Hit@5 ${m.hitAt[5]}`)
  assert.ok(m.emptyRate <= 0.1, `in-scope empty ${m.emptyRate}`)
  assert.ok(m.outOfScopeEmptyRate >= 0.8, `out-of-scope empty ${m.outOfScopeEmptyRate}`)
})
