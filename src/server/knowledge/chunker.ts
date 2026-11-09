import { createHash } from 'node:crypto'
import { chunkSearchText } from '@/lib/retrieval/search-text'
import type { KbChunk, KbDocument } from './types'

export { chunkSearchText }

export interface ChunkOptions {
  /** Units longer than this are split at paragraph, then sentence, boundaries. */
  maxChars: number
  /** Adjacent articles shorter than this are merged within the same section... */
  minChars: number
  /** ...as long as the merged chunk stays within this length. */
  mergeMaxChars: number
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = { maxChars: 700, minChars: 60, mergeMaxChars: 240 }

const ARTICLE = /^(第[一二三四五六七八九十百零〇]+条)(?=\s|$)/
const GLOSSARY_TERM = /^(\d+)[.．]\s*(.+)$/

interface Unit {
  kind: 'article' | 'term' | 'text'
  headings: string[]
  labels: string[]
  paragraphs: string[]
}

function termLabel(number: string, rest: string): string {
  const end = rest.search(/[（(：:]/)
  const name = end > 0 && end <= 30 ? rest.slice(0, end) : rest.slice(0, 20)
  return `${number}. ${name.trim()}`
}

/**
 * Splits a regulation into its own structural units: one article (第X条) or one glossary
 * entry each, carrying the chapter/section path. Rules are cited by article, so an article
 * is never cut unless it is too long, and short neighbouring articles are merged.
 */
function parseUnits(doc: KbDocument): Unit[] {
  const units: Unit[] = []
  let chapter: string | undefined
  let section: string | undefined
  let current: Unit | undefined
  for (const block of doc.body.split(/\n{2,}/)) {
    const text = block.trim()
    if (!text) continue
    if (/^#\s/.test(text)) { current = undefined; continue }
    if (/^##\s/.test(text)) { chapter = text.slice(3).trim(); section = undefined; current = undefined; continue }
    if (/^###\s/.test(text)) { section = text.slice(4).trim(); current = undefined; continue }
    const headings = [chapter, section].filter((h): h is string => Boolean(h))
    const article = ARTICLE.exec(text)
    const term = chapter?.startsWith('附件') ? GLOSSARY_TERM.exec(text) : null
    if (article) {
      current = { kind: 'article', headings, labels: [article[1]], paragraphs: [text] }
      units.push(current)
    } else if (term) {
      const appendix = chapter!.replace(/^附件\s*/, '') || '附件'
      current = { kind: 'term', headings, labels: [`${appendix} ${termLabel(term[1], term[2])}`], paragraphs: [text] }
      units.push(current)
    } else if (current) {
      current.paragraphs.push(text)
    } else {
      current = { kind: 'text', headings, labels: [headings.at(-1) ?? '正文'], paragraphs: [text] }
      units.push(current)
    }
  }
  return units
}

const length = (unit: Unit) => unit.paragraphs.reduce((sum, p) => sum + p.length, 0)
const sameHeadings = (a: Unit, b: Unit) => a.headings.join('\u0000') === b.headings.join('\u0000')

function mergeShortArticles(units: Unit[], options: ChunkOptions): Unit[] {
  const merged: Unit[] = []
  for (const unit of units) {
    const previous = merged.at(-1)
    if (
      previous?.kind === 'article' && unit.kind === 'article' && sameHeadings(previous, unit)
      && (length(previous) < options.minChars || length(unit) < options.minChars)
      && length(previous) + length(unit) <= options.mergeMaxChars
    ) {
      previous.labels.push(...unit.labels)
      previous.paragraphs.push(...unit.paragraphs)
    } else {
      merged.push({ ...unit, labels: [...unit.labels], paragraphs: [...unit.paragraphs] })
    }
  }
  return merged
}

/** Greedy packing at paragraph boundaries; a single oversized paragraph is cut after 。or ；, and hard-cut if still too long. */
function splitParagraphs(paragraphs: string[], maxChars: number): string[][] {
  const pieces = paragraphs.flatMap((paragraph) => {
    if (paragraph.length <= maxChars) return [paragraph]
    // Text without sentence punctuation (e.g. a table) is cut at maxChars as a last resort.
    const sentences = (paragraph.match(/[^。；]+[。；]?/g) ?? [paragraph])
      .flatMap(sentence => sentence.match(new RegExp(`[\\s\\S]{1,${maxChars}}`, 'g')) ?? [])
    const out: string[] = []
    let buffer = ''
    for (const sentence of sentences) {
      if (buffer && buffer.length + sentence.length > maxChars) { out.push(buffer); buffer = '' }
      buffer += sentence
    }
    if (buffer) out.push(buffer)
    return out
  })
  const parts: string[][] = []
  let current: string[] = []
  let size = 0
  for (const piece of pieces) {
    if (current.length && size + piece.length > maxChars) { parts.push(current); current = []; size = 0 }
    current.push(piece)
    size += piece.length
  }
  if (current.length) parts.push(current)
  return parts
}

export function contentHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

export function chunkDocument(doc: KbDocument, options: ChunkOptions = DEFAULT_CHUNK_OPTIONS): KbChunk[] {
  const chunks: KbChunk[] = []
  for (const unit of mergeShortArticles(parseUnits(doc), options)) {
    const label = unit.labels.length > 1 ? `${unit.labels[0]}至${unit.labels.at(-1)}` : unit.labels[0]
    const parts = splitParagraphs(unit.paragraphs, options.maxChars)
    parts.forEach((paragraphs, index) => {
      const partial = {
        headings: unit.headings,
        label: parts.length > 1 ? `${label}（${index + 1}/${parts.length}）` : label,
        text: paragraphs.join('\n'),
      }
      chunks.push({
        id: `${doc.meta.id}#${chunks.length + 1}`,
        docId: doc.meta.id,
        ...partial,
        hash: contentHash(chunkSearchText(doc.meta, partial)),
      })
    })
  }
  return chunks
}
