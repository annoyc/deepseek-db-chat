import { fileExtension, UPLOAD_EXTENSIONS } from './knowledge-documents'
import type { KnowledgeUploadKind } from './knowledge-types'

/**
 * Text extraction for uploaded documents. It runs in the browser, so the original file
 * never leaves the user's machine; only the extracted text is sent for chunking. The PDF
 * and Word parsers are loaded on first use.
 */
export class DocumentTextError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DocumentTextError'
  }
}

const startsWith = (bytes: Uint8Array, signature: number[]) => signature.every((byte, i) => bytes[i] === byte)

/** The extension picks the parser; the file's signature has to agree with it. */
export function detectKind(fileName: string, bytes: Uint8Array): KnowledgeUploadKind {
  const kind = UPLOAD_EXTENSIONS[fileExtension(fileName)]
  if (!kind) throw new DocumentTextError('仅支持 PDF、Word（.docx）、Markdown 和 TXT 文件')
  if (kind === 'pdf' && !startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) throw new DocumentTextError('文件内容不是有效的 PDF')
  if (kind === 'docx' && !startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    throw new DocumentTextError('文件内容不是有效的 Word（.docx）文档，旧版 .doc 请另存为 .docx')
  }
  if ((kind === 'md' || kind === 'txt') && bytes.subarray(0, 8192).includes(0)) throw new DocumentTextError('文件内容不是文本')
  return kind
}

/** UTF-8 first; Chinese text files saved by older Windows tools are often GB18030/GBK. */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '')
  } catch {
    return new TextDecoder('gb18030').decode(bytes)
  }
}

// Parsing only ever runs in the browser. In the SSR build import.meta.env.SSR is the literal
// true, so these branches fold away and pdf.js / mammoth stay out of the server bundle.
const loadMammoth = () => import.meta.env.SSR
  ? Promise.reject(new DocumentTextError('文档只能在浏览器中解析'))
  : import('mammoth')
const loadUnpdf = () => import.meta.env.SSR
  ? Promise.reject(new DocumentTextError('文档只能在浏览器中解析'))
  : import('unpdf')

export async function extractDocumentText(kind: KnowledgeUploadKind, bytes: Uint8Array): Promise<string> {
  if (kind === 'md' || kind === 'txt') return decodeText(bytes)
  if (kind === 'docx') {
    try {
      const mammoth = await loadMammoth()
      // mammoth reads { arrayBuffer } in its browser build and { buffer } under Node (tests).
      const input = typeof Buffer === 'undefined'
        ? { arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer }
        : { buffer: Buffer.from(bytes) }
      return (await mammoth.extractRawText(input)).value
    } catch {
      throw new DocumentTextError('Word 文档解析失败，文件可能已损坏')
    }
  }
  try {
    const { extractText, getDocumentProxy } = await loadUnpdf()
    // pdf.js takes ownership of the buffer it is given, so pass a copy.
    const pdf = await getDocumentProxy(new Uint8Array(bytes))
    const { text } = await extractText(pdf, { mergePages: false })
    return text.join('\n')
  } catch {
    throw new DocumentTextError('PDF 解析失败，文件可能已损坏或已加密')
  }
}
