/** Metadata from a corpus file's front matter; see knowledge/README.md. */
export interface KbDocumentMeta {
  id: string
  title: string
  docNo?: string
  issuer?: string
  region?: string
  /** All dates are YYYY-MM-DD in Beijing time. */
  issuedAt?: string
  effectiveFrom?: string
  effectiveUntil?: string
  /** The source's own wording about when it applies. */
  validity?: string
  sourceUrl?: string
  attachmentUrl?: string
}

export interface KbDocument {
  meta: KbDocumentMeta
  /** Markdown body without front matter. */
  body: string
}

export interface KbChunk {
  /** `${docId}#${ordinal}`: stable as long as the document's structure is unchanged. */
  id: string
  docId: string
  /** Heading path inside the document, e.g. ['第三章 市场成员', '第一节 经营主体注册']. */
  headings: string[]
  /** Where the chunk sits, e.g. '第十条', '第十条至第十二条', '名词解释 7. 绿色电力'. */
  label: string
  text: string
  /** Short content hash of the text that is indexed and embedded. */
  hash: string
}

export interface KbEmbeddingInfo {
  provider: string
  model: string
  dimensions: number
}

export interface KbIndexFile {
  version: 1
  /** Hash over every document and chunk; changes whenever the corpus or chunker output changes. */
  corpusHash: string
  documents: (KbDocumentMeta & { hash: string })[]
  chunks: KbChunk[]
  /** Present only when the index was built with `pnpm kb:ingest --embed`. */
  embedding?: KbEmbeddingInfo & {
    /** Base64 of unit-length Float32 vectors, in chunk order. */
    vectors: string
  }
}

export type KbDocumentStatus = 'active' | 'expired' | 'pending'
