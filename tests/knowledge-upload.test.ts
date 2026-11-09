import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import committedIndex from '../knowledge/kb-index.json'
import { KnowledgeDocumentList } from '../src/components/knowledge/KnowledgeDocuments'
import { decodeText, detectKind, DocumentTextError, extractDocumentText } from '../src/lib/document-text'
import { createUploadSearchIndex, DEFAULT_UPLOAD_LIMITS, embeddingKey, validateUploadSelection } from '../src/lib/knowledge-documents'
import type { KnowledgeStreamChunk, KnowledgeUploadedDocument, KnowledgeUserChunkCandidate } from '../src/lib/knowledge-types'
import { encodeVectors } from '../src/server/knowledge/index-builder'
import { createKnowledgeBase, createUploadKnowledgeBase } from '../src/server/knowledge/knowledge-base'
import { runKnowledgePipeline, UPLOAD_STATUS_LABEL, type KnowledgePipelineDeps } from '../src/server/knowledge/pipeline'
import { retrieve } from '../src/server/knowledge/retriever'
import { structureText } from '../src/server/knowledge/text-structure'
import type { KbIndexFile } from '../src/server/knowledge/types'
import { processUpload, UploadError } from '../src/server/knowledge/upload'
import { handleKnowledgeUpload } from '../src/server/knowledge/upload-handler'

const savedEnv = { ...process.env }
afterEach(() => {
  for (const key of ['KNOWLEDGE_BACKEND', 'KB_UPLOAD_MAX_CHARS', 'KB_UPLOAD_MAX_BYTES']) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
})

const limits = { maxBytes: 1024 * 1024, maxChars: 5000, maxDocuments: 3 }

/** A one-page PDF with standard-font ASCII text and a correct xref table. */
function minimalPdf(lines: string[]): Uint8Array {
  const content = ['BT', '/F1 12 Tf', '14 TL', '72 720 Td', ...lines.map(line => `(${line.replace(/[\\()]/g, '\\$&')}) '`), 'ET'].join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((object, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${object}\nendobj\n` })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(pdf)
}

// ── Browser-side extraction ─────────────────────────────────

test('file kind must match both extension and content signature', () => {
  assert.equal(detectKind('规则.PDF', minimalPdf(['x'])), 'pdf')
  assert.equal(detectKind('a.docx', new Uint8Array([0x50, 0x4b, 0x03, 0x04])), 'docx')
  assert.equal(detectKind('a.markdown', new TextEncoder().encode('# t')), 'md')
  assert.throws(() => detectKind('a.pdf', new TextEncoder().encode('not a pdf')), /不是有效的 PDF/)
  assert.throws(() => detectKind('a.doc', new Uint8Array([0xd0, 0xcf])), DocumentTextError)
  assert.throws(() => detectKind('a.txt', new Uint8Array([0x41, 0, 0x42])), /不是文本/)
})

test('text files decode as UTF-8 or fall back to GB18030', () => {
  assert.equal(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('中文')])), '中文')
  assert.equal(decodeText(new Uint8Array([0xd6, 0xd0, 0xce, 0xc4])), '中文')
})

test('PDF and Word text is extracted', async () => {
  const pdfText = await extractDocumentText('pdf', minimalPdf(['Article 1 Contracts shall be signed.', 'Article 2 Settlement is monthly.']))
  assert.match(pdfText, /Article 1 Contracts shall be signed\./)
  assert.match(pdfText, /Article 2 Settlement is monthly\./)
  const docx = new Uint8Array(readFileSync(resolve(process.cwd(), 'tests/fixtures/sample.docx')))
  const docxText = await extractDocumentText('docx', docx)
  assert.match(docxText, /第二条 合同履约保函金额不低于年度合同电费的百分之十。/)
  await assert.rejects(extractDocumentText('docx', new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2])), /Word 文档解析失败/)
})

// ── Structuring and processing ──────────────────────────────

test('hard-wrapped PDF text is rebuilt into chapters, sections and articles', () => {
  const raw = [
    '示例交易规则', '目 录', '第一章 总则 ........ 1',
    '第一章 总 则', '第一条 为规范示例市场交易行为，依法保护经营主体', '合法权益，制定本规则。',
    '— 1 —',
    '第二章', '交易组织', '第一节 一般规定',
    '第二条 交易包括：', '（一）年度交易；', '（二）月度交易。',
    'Clearing price = bid', 'price',
  ].join('\n')
  const body = structureText(raw, 'hard-wrapped')
  assert.ok(body.includes('## 第一章 总则\n\n第一条 为规范示例市场交易行为，依法保护经营主体合法权益，制定本规则。'))
  assert.ok(body.includes('## 第二章 交易组织\n\n### 第一节 一般规定\n\n第二条 交易包括：\n\n（一）年度交易；\n\n（二）月度交易。'))
  assert.ok(!body.includes('— 1 —') && !body.includes('........'))
  assert.ok(body.includes('Clearing price = bid price'))
})

test('notices with 一、二、 headings and Markdown files keep their structure', () => {
  const notice = structureText('关于示例的通知\n一、总体要求\n各单位应按时报送。\n二、工作安排\n按月组织。', 'paragraphs')
  assert.ok(notice.includes('## 一、总体要求\n\n各单位应按时报送。\n\n## 二、工作安排'))
  const markdown = structureText('---\ntitle: x\n---\n# 标题\n## 小节\n正文一\n#### 细节\n正文二', 'markdown')
  assert.equal(markdown, '## 标题\n\n### 小节\n\n正文一\n\n细节\n\n正文二\n')
})

test('uploads are chunked with stable ids and bounded by size and text limits', async () => {
  const text = '第一章 总则\n第一条 本办法适用于示例售电合同。\n第二条 合同履约保函金额不低于年度合同电费的百分之十。'
  const doc = await processUpload({ fileName: '示例办法.docx', kind: 'docx', size: 2048, text }, { limits, now: new Date('2026-11-09T00:00:00Z') })
  assert.match(doc.id, /^upload-[0-9a-f-]{36}$/)
  assert.equal(doc.title, '示例办法')
  assert.equal(doc.uploadedAt, '2026-11-09T00:00:00.000Z')
  assert.ok(doc.chunks.every(chunk => chunk.id.startsWith(`${doc.id}#`)))
  assert.deepEqual(doc.chunks.map(c => c.label), ['第一条至第二条'])
  assert.equal(doc.embeddingKey, undefined)

  await assert.rejects(processUpload({ fileName: 'a.txt', kind: 'txt', size: limits.maxBytes + 1, text }, { limits }), (e: UploadError) => e.status === 413)
  await assert.rejects(processUpload({ fileName: 'a.txt', kind: 'txt', size: 10, text: '字'.repeat(limits.maxChars + 1) }, { limits }), /超过单个文档 5,000 字/)
  await assert.rejects(processUpload({ fileName: 'scan.pdf', kind: 'pdf', size: 10, text: '\n\n' }, { limits }), /扫描版 PDF/)
  // A table with no sentence punctuation is still cut into chunks the chat request accepts.
  const table = await processUpload({ fileName: 't.txt', kind: 'txt', size: 10, text: '甲'.repeat(2000) }, { limits })
  assert.ok(table.chunks.every(chunk => chunk.text.length <= 700))
})

test('uploads are embedded with the built-in model, masking PII; failures fall back to keywords', async () => {
  const info = { provider: 'bailian', model: 'fake', dimensions: 2 }
  const inputs: string[] = []
  const embed = async (texts: string[]) => { inputs.push(...texts); return texts.map(() => new Float32Array([0.6, 0.8])) }
  const doc = await processUpload({ fileName: 'a.txt', kind: 'txt', size: 10, text: '联系人手机13812345678，负责结算。' }, { limits, embedding: { info, embed } })
  assert.equal(doc.embeddingKey, 'bailian:fake:2')
  assert.equal(doc.chunks[0].vector, encodeVectors([new Float32Array([0.6, 0.8])]))
  assert.ok(inputs.every(text => !text.includes('13812345678')))

  const failed = await processUpload({ fileName: 'a.txt', kind: 'txt', size: 10, text: '结算规则。' }, {
    limits,
    embedding: { info, embed: async () => { throw new Error('quota') } },
  })
  assert.equal(failed.embeddingKey, undefined)
  assert.equal(failed.warning, '向量生成失败，此文档仅支持关键词检索')
})

// ── Upload route ────────────────────────────────────────────

function uploadRequest(body: BodyInit, headers: Record<string, string> = { 'content-type': 'application/json' }) {
  return new Request('http://localhost/workbench/knowledge-upload', { method: 'POST', headers, body, duplex: 'half' } as RequestInit)
}

test('upload route returns chunks and rejects malformed or oversized requests', async () => {
  const ok = await handleKnowledgeUpload(uploadRequest(JSON.stringify({ fileName: '办法.md', kind: 'md', size: 100, text: '# 办法\n第一条 示例条款。' })))
  assert.equal(ok.status, 200)
  assert.equal(ok.headers.get('cache-control'), 'no-store')
  const doc = await ok.json() as KnowledgeUploadedDocument
  assert.equal(doc.kind, 'md')
  assert.equal(doc.chunks[0].text, '第一条 示例条款。')

  assert.equal((await handleKnowledgeUpload(uploadRequest('x', { 'content-type': 'application/octet-stream' }))).status, 415)
  assert.equal((await handleKnowledgeUpload(uploadRequest('{bad json'))).status, 400)
  assert.equal((await handleKnowledgeUpload(uploadRequest(JSON.stringify({ fileName: 'a.exe', kind: 'exe', size: 1, text: 'x' })))).status, 400)

  process.env.KB_UPLOAD_MAX_CHARS = '10'
  const declared = await handleKnowledgeUpload(uploadRequest('{}', { 'content-type': 'application/json', 'content-length': String(10 * 8 + 64 * 1024 + 1) }))
  assert.equal(declared.status, 413)
  let pulled = 0
  const endless = new ReadableStream<Uint8Array>({
    pull(controller) { pulled++; controller.enqueue(new Uint8Array(16 * 1024)) },
  })
  const streamed = await handleKnowledgeUpload(uploadRequest(endless))
  assert.equal(streamed.status, 413)
  assert.ok(pulled < 20, 'stops reading once the cap is exceeded')

  process.env.KNOWLEDGE_BACKEND = 'remote'
  assert.equal((await handleKnowledgeUpload(uploadRequest('{}'))).status, 409)
})

// ── Browser selection and limits ────────────────────────────

const uploadedDoc: KnowledgeUploadedDocument = {
  id: 'upload-00000000-0000-4000-8000-000000000001',
  name: '购电合同管理办法.docx',
  title: '购电合同管理办法',
  kind: 'docx',
  size: 2048,
  charCount: 80,
  uploadedAt: '2026-11-09T00:00:00.000Z',
  chunks: [
    { id: 'upload-00000000-0000-4000-8000-000000000001#1', headings: ['第一章 总则'], label: '第一条', text: '第一条 合同履约保函金额不低于年度合同电费的百分之十。' },
    { id: 'upload-00000000-0000-4000-8000-000000000001#2', headings: ['第一章 总则'], label: '第二条', text: '第二条 偏差电量按月结算。' },
  ],
}

test('browser limits: document count, file type and size', () => {
  assert.equal(validateUploadSelection({ name: 'a.pdf', size: 10 }, 3, limits), '最多保存 3 份文档，请先移除不需要的文档')
  assert.match(validateUploadSelection({ name: 'a.xlsx', size: 10 }, 0, limits)!, /仅支持/)
  assert.match(validateUploadSelection({ name: 'a.pdf', size: limits.maxBytes + 1 }, 0, limits)!, /超过 1\.0 MB 的上限/)
  assert.equal(validateUploadSelection({ name: 'a.pdf', size: 0 }, 0, limits), '文件为空')
  assert.equal(validateUploadSelection({ name: 'a.PDF', size: 10 }, 2, limits), null)
  assert.equal(DEFAULT_UPLOAD_LIMITS.maxDocuments, 10)
})

test('browser pre-selection ranks uploaded chunks and attaches vectors only when embedded', () => {
  const index = createUploadSearchIndex([uploadedDoc])
  const [first] = index.search('履约保函金额是多少')
  assert.equal(first.label, '第一条')
  assert.equal(first.docTitle, '购电合同管理办法')
  assert.equal(first.vector, undefined)
  assert.deepEqual(index.search('天气'), [])
  assert.deepEqual(createUploadSearchIndex([]).search('任何问题'), [])
})

// ── Retrieval and pipeline ──────────────────────────────────

const kb = createKnowledgeBase(committedIndex as unknown as KbIndexFile)

function candidates(): KnowledgeUserChunkCandidate[] {
  return createUploadSearchIndex([uploadedDoc]).search('履约保函')
}

test('uploaded vectors are used only when they come from the index model', () => {
  const info = { provider: 'bailian', model: 'm', dimensions: 2 }
  const vector = encodeVectors([new Float32Array([1, 0])])
  const matching = createUploadKnowledgeBase(candidates().map(c => ({ ...c, vector, embeddingKey: embeddingKey(info) })), info)
  assert.ok(matching.vectors)
  const other = createUploadKnowledgeBase(candidates().map(c => ({ ...c, vector, embeddingKey: 'bailian:other:2' })), info)
  assert.equal(other.vectors, undefined)
  const hits = retrieve([kb, matching], ['履约保函金额'], { topK: 3, queryVectors: [new Float32Array([1, 0])], minSimilarity: 0.5 })
  assert.equal(hits[0].source, 'upload')
  assert.ok(hits[0].denseRank)
})

test('pipeline cites uploaded documents as unverified user material alongside the built-in rules', async () => {
  const prompts: string[] = []
  const chatModel: KnowledgePipelineDeps['chatModel'] = () => ({
    async invoke() { throw new Error('not used in concise mode') },
    async *invokeStream(params) {
      prompts.push(params.messages.at(-1)!.content as string)
      yield { choices: [{ delta: { content: '保函金额不低于年度合同电费的百分之十[1]。' } }] } as any
    },
  })
  const chunks: KnowledgeStreamChunk[] = []
  for await (const chunk of runKnowledgePipeline(
    { message: '履约保函金额要求是什么', history: [], useWebSearch: false, useBaseModel: false, answerMode: 'concise', userChunks: candidates() },
    { knowledgeBase: async () => kb, chatModel, now: () => new Date('2026-11-09T04:00:00Z') },
  )) chunks.push(chunk)
  const evidence = chunks.filter(c => c.type === 'evidence' && c.citations).at(-1) as Extract<KnowledgeStreamChunk, { type: 'evidence' }>
  const upload = evidence.citations!.find(c => c.source === 'upload')
  assert.equal(upload?.docTitle, '购电合同管理办法')
  assert.equal(upload?.status, 'unverified')
  assert.equal(upload?.statusLabel, UPLOAD_STATUS_LABEL)
  assert.equal(upload?.ref, '1')
  assert.equal(upload?.cited, true)
  assert.ok(prompts[0].includes(`《购电合同管理办法》第一条｜第一章 总则｜${UPLOAD_STATUS_LABEL}`))
  const retrieval = chunks.filter(c => c.type === 'tool' && c.id === 'kb_retrieve').at(-1) as Extract<KnowledgeStreamChunk, { type: 'tool' }>
  assert.match(retrieval.output!, /含我的文档 \d+ 条/)
  const check = chunks.filter(c => c.type === 'tool' && c.id === 'citation_check').at(-1) as Extract<KnowledgeStreamChunk, { type: 'tool' }>
  assert.equal(check.output, '引用 1 处来源，均可对应；含我上传的文档')
})

// ── Sidebar list ────────────────────────────────────────────

test('document list shows usage against the limit and disables upload when full', () => {
  const render = (documents: KnowledgeUploadedDocument[], extra: Partial<Parameters<typeof KnowledgeDocumentList>[0]> = {}) =>
    renderToStaticMarkup(createElement(KnowledgeDocumentList, {
      documents, limits, uploading: null, error: null, onUpload() {}, onRemove() {}, onDismissError() {}, ...extra,
    }))
  const one = render([uploadedDoc])
  assert.ok(one.includes('1/3'))
  assert.ok(one.includes('购电合同管理办法'))
  assert.ok(one.includes('Word · 2.0 KB · 2 段 · 关键词检索'))
  assert.ok(one.includes('单个不超过 1.0 MB'))
  assert.ok(!/<button[^>]*disabled=""[^>]*>.*?上传/.test(one))
  const full = render([uploadedDoc, uploadedDoc, uploadedDoc].map((doc, i) => ({ ...doc, id: `${doc.id}${i}` })))
  assert.match(full, /<button[^>]*disabled=""[^>]*>.*?上传/)
  assert.ok(render([], { uploading: '规则.pdf', error: '文件为空' }).includes('正在解析 规则.pdf'))
})
