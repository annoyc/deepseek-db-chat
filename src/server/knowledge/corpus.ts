import type { KbDocument, KbDocumentMeta } from './types'

const META_KEYS = ['id', 'title', 'docNo', 'issuer', 'region', 'issuedAt', 'effectiveFrom', 'effectiveUntil', 'validity', 'sourceUrl', 'attachmentUrl'] as const
const DATE_KEYS = new Set(['issuedAt', 'effectiveFrom', 'effectiveUntil'])
const DATE = /^\d{4}-\d{2}-\d{2}$/

/** Parses a corpus Markdown file: `key: value` front matter between `---` lines, then the body. */
export function parseCorpusFile(source: string, fileName = 'corpus file'): KbDocument {
  const text = source.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text)
  if (!match) throw new Error(`${fileName}: missing front matter`)
  const meta: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    if (!line.trim()) continue
    const separator = line.indexOf(':')
    if (separator <= 0) throw new Error(`${fileName}: invalid front matter line "${line}"`)
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim()
    if (!(META_KEYS as readonly string[]).includes(key)) throw new Error(`${fileName}: unknown front matter key "${key}"`)
    if (DATE_KEYS.has(key) && !DATE.test(value)) throw new Error(`${fileName}: ${key} must be YYYY-MM-DD`)
    if (value) meta[key] = value
  }
  if (!meta.id || !/^[a-z0-9][a-z0-9-]*$/.test(meta.id)) throw new Error(`${fileName}: id must be lowercase letters, digits and hyphens`)
  if (!meta.title) throw new Error(`${fileName}: title is required`)
  if (meta.effectiveFrom && meta.effectiveUntil && meta.effectiveFrom > meta.effectiveUntil) {
    throw new Error(`${fileName}: effectiveFrom is after effectiveUntil`)
  }
  return { meta: meta as unknown as KbDocumentMeta, body: text.slice(match[0].length) }
}
