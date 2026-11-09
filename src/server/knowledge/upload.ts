import { randomUUID } from 'node:crypto'
import { DEFAULT_UPLOAD_LIMITS, embeddingKey, formatBytes } from '@/lib/knowledge-documents'
import type { KnowledgeUploadedDocument, KnowledgeUploadKind, KnowledgeUploadLimits } from '@/lib/knowledge-types'
import { maskPII } from '@/lib/masking'
import { chunkDocument, chunkSearchText } from './chunker'
import type { Embedder } from './embedding'
import { encodeVectors } from './index-builder'
import { structureText } from './text-structure'
import type { KbEmbeddingInfo } from './types'

/** A rejection whose message is shown to the user as-is. */
export class UploadError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
    this.name = 'UploadError'
  }
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function uploadLimits(env: NodeJS.ProcessEnv = process.env): KnowledgeUploadLimits {
  return {
    maxBytes: positiveInt(env.KB_UPLOAD_MAX_BYTES, DEFAULT_UPLOAD_LIMITS.maxBytes),
    maxChars: positiveInt(env.KB_UPLOAD_MAX_CHARS, DEFAULT_UPLOAD_LIMITS.maxChars),
    maxDocuments: positiveInt(env.KB_UPLOAD_MAX_DOCUMENTS, DEFAULT_UPLOAD_LIMITS.maxDocuments),
  }
}

export interface ProcessUploadOptions {
  limits?: KnowledgeUploadLimits
  /** When set, chunks are embedded with the same model as the built-in index. */
  embedding?: { info: KbEmbeddingInfo; embed: Embedder }
  now?: Date
  signal?: AbortSignal
}

function titleFromName(name: string): string {
  const base = name.replace(/\.[^.]+$/, '').replace(/[\u0000-\u001f]/g, '').trim()
  return (base || '未命名文档').slice(0, 80)
}

export interface ExtractedUpload {
  fileName: string
  kind: KnowledgeUploadKind
  /** Size of the original file in bytes, as reported by the browser. */
  size: number
  /** Text the browser extracted from the file. */
  text: string
}

/** Structures, validates and chunks the text of one uploaded file. Nothing is stored on the server. */
export async function processUpload(upload: ExtractedUpload, options: ProcessUploadOptions = {}): Promise<KnowledgeUploadedDocument> {
  const limits = options.limits ?? uploadLimits()
  const { fileName, kind } = upload
  if (upload.size > limits.maxBytes) throw new UploadError(`文件超过 ${formatBytes(limits.maxBytes)} 的上限`, 413)
  const body = structureText(upload.text, kind === 'pdf' ? 'hard-wrapped' : kind === 'md' ? 'markdown' : 'paragraphs')
  const charCount = body.replace(/\s|#/g, '').length
  if (!charCount) {
    throw new UploadError(kind === 'pdf' ? '没有提取到文字，可能是扫描版 PDF，请先做文字识别（OCR）' : '文件中没有文字内容')
  }
  if (charCount > limits.maxChars) {
    throw new UploadError(`文字内容约 ${charCount.toLocaleString('zh-CN')} 字，超过单个文档 ${limits.maxChars.toLocaleString('zh-CN')} 字的上限`, 413)
  }

  const meta = { id: `upload-${randomUUID()}`, title: titleFromName(fileName) }
  const chunks = chunkDocument({ meta, body })
  let vectors: string[] | undefined
  let warning: string | undefined
  if (options.embedding) {
    try {
      // Same masking as every other text the app sends to a model provider.
      const embedded = await options.embedding.embed(chunks.map(chunk => maskPII(chunkSearchText(meta, chunk))), options.signal)
      vectors = embedded.map(vector => encodeVectors([vector]))
    } catch (error) {
      if (options.signal?.aborted) throw error
      warning = '向量生成失败，此文档仅支持关键词检索'
    }
  }
  return {
    id: meta.id,
    name: fileName.slice(0, 255),
    title: meta.title,
    kind,
    size: upload.size,
    charCount,
    uploadedAt: (options.now ?? new Date()).toISOString(),
    chunks: chunks.map((chunk, i) => ({
      id: chunk.id,
      headings: chunk.headings.map(heading => heading.slice(0, 100)),
      label: chunk.label.slice(0, 100),
      text: chunk.text,
      ...(vectors ? { vector: vectors[i] } : {}),
    })),
    ...(vectors && options.embedding ? { embeddingKey: embeddingKey(options.embedding.info) } : {}),
    ...(warning ? { warning } : {}),
  }
}

/** Reads at most `maxBytes` of a request body, cancelling the upload as soon as it exceeds the limit. */
export async function readLimitedBody(request: Request, maxBytes: number): Promise<Uint8Array> {
  const tooLarge = () => new UploadError('文档文字内容过多', 413)
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge()
  if (!request.body) return new Uint8Array()
  const reader = request.body.getReader()
  const parts: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        await reader.cancel().catch(() => {})
        throw tooLarge()
      }
      parts.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength }
  return bytes
}
