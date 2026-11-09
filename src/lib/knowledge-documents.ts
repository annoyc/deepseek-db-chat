import { Bm25Index, MIN_KEYWORD_COVERAGE } from '@/lib/retrieval/bm25'
import { chunkSearchText } from '@/lib/retrieval/search-text'
import { tokenize, tokenizeQuery } from '@/lib/retrieval/tokenizer'
import type { KnowledgeUploadedDocument, KnowledgeUploadKind, KnowledgeUploadLimits, KnowledgeUserChunkCandidate } from './knowledge-types'

// Files are parsed in the browser, so maxBytes bounds browser work and maxChars the server's.
export const DEFAULT_UPLOAD_LIMITS: KnowledgeUploadLimits = { maxBytes: 10 * 1024 * 1024, maxChars: 100_000, maxDocuments: 10 }

/** Candidate chunks sent with one question; the server rejects more. */
export const MAX_UPLOAD_CANDIDATES = 30

export const UPLOAD_EXTENSIONS: Record<string, KnowledgeUploadKind> = {
  pdf: 'pdf',
  docx: 'docx',
  md: 'md',
  markdown: 'md',
  txt: 'txt',
}

export const UPLOAD_ACCEPT = Object.keys(UPLOAD_EXTENSIONS).map(ext => `.${ext}`).join(',')

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Checks done in the browser before uploading; the server repeats the size check. */
export function validateUploadSelection(file: { name: string; size: number }, existing: number, limits: KnowledgeUploadLimits): string | null {
  if (existing >= limits.maxDocuments) return `最多保存 ${limits.maxDocuments} 份文档，请先移除不需要的文档`
  if (!UPLOAD_EXTENSIONS[fileExtension(file.name)]) return '仅支持 PDF、Word（.docx）、Markdown 和 TXT 文件'
  if (file.size === 0) return '文件为空'
  if (file.size > limits.maxBytes) return `文件大小 ${formatBytes(file.size)}，超过 ${formatBytes(limits.maxBytes)} 的上限`
  return null
}

export interface UploadSearchIndex {
  /**
   * Chunks relevant to any of `queries` (best rank first), then the `carry` chunk ids,
   * at most `limit` in total. Keyword matches covering too little of a query are dropped.
   */
  search(queries: string[], options?: { limit?: number; carry?: string[] }): KnowledgeUserChunkCandidate[]
}

/**
 * Uploaded documents never leave the browser except as the few chunks relevant to a
 * question: this keyword pre-selection runs locally, and the server re-ranks the
 * candidates together with the built-in knowledge base.
 */
export function createUploadSearchIndex(documents: KnowledgeUploadedDocument[]): UploadSearchIndex {
  const entries = documents.flatMap(doc => doc.chunks.map(chunk => ({ doc, chunk })))
  const bm25 = new Bm25Index(entries.map(({ doc, chunk }) => tokenize(chunkSearchText(doc, chunk))))
  return {
    search(queries, { limit = MAX_UPLOAD_CANDIDATES, carry = [] } = {}) {
      if (!entries.length) return []
      // Each query is ranked on its own so a long earlier question cannot dilute the current one.
      const best = new Map<number, number>()
      for (const query of queries.filter(q => q.trim())) {
        bm25.search(tokenizeQuery(query), limit, { minCoverage: MIN_KEYWORD_COVERAGE }).forEach(({ index }, rank) => {
          best.set(index, Math.min(best.get(index) ?? Infinity, rank))
        })
      }
      const ordered = [...best].sort((a, b) => a[1] - b[1] || a[0] - b[0]).map(([index]) => index)
      for (const id of carry) {
        const index = entries.findIndex(entry => entry.chunk.id === id)
        if (index >= 0 && !best.has(index)) ordered.push(index)
      }
      return ordered.slice(0, limit).map((index) => {
        const { doc, chunk } = entries[index]
        return {
          id: chunk.id,
          docId: doc.id,
          docTitle: doc.title,
          headings: chunk.headings,
          label: chunk.label,
          text: chunk.text,
          ...(chunk.vector && doc.embeddingKey ? { vector: chunk.vector, embeddingKey: doc.embeddingKey } : {}),
        }
      })
    },
  }
}

export function embeddingKey(info: { provider: string; model: string; dimensions: number }): string {
  return `${info.provider}:${info.model}:${info.dimensions}`
}
