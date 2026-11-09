/**
 * Turns extracted document text into the Markdown layout the chunker expects:
 * chapters/sections (第X章 / 第X节) as headings, every article, list item and
 * formula as its own paragraph. Same rules as scripts/kb_pdf_to_markdown.py,
 * which prepared the bundled corpus.
 */
const CN = '一二三四五六七八九十百零〇'
const CHAPTER = new RegExp(`^(第[${CN}]+章)\\s*(.*)$`)
const SECTION = new RegExp(`^(第[${CN}]+节)\\s*(.*)$`)
const ARTICLE = new RegExp(`^第[${CN}]+条(?:\\s+|$)`)
const ITEM = new RegExp(`^(?:（[${CN}]+）|\\d+[．.、](?!\\d)|（\\d+）)`)
const PAGE_NUMBER = /^\s*(?:[—–-]\s*)?\d+(?:\s*[—–-])?\s*$/
const FORMULA = /^[^，。；：]{1,40}[＝=]/
const TOC_LEADER = /(?:\.{4,}|…{2,}|·{4,})\s*\d*\s*$/
const MARKDOWN_HEADING = /^(#{1,6})\s+(.*)$/
const FRONT_MATTER = /^---\n[\s\S]*?\n---\n/
// "一、总体要求": the usual heading style of notices that are not split into 第X章.
const ENUM_HEADING = new RegExp(`^[${CN}]+、\\S.{0,28}$`)
const CJK = '[\\u3000-\\u303f\\u3400-\\u9fff\\uff00-\\uffef“”‘’]'
const CJK_BEFORE_ASCII = new RegExp(`(?<=${CJK})[ \\t]+(?=[A-Za-z0-9%-])`, 'g')
const ASCII_BEFORE_CJK = new RegExp(`(?<=[A-Za-z0-9%-])[ \\t]+(?=${CJK})`, 'g')
const CJK_GAP = new RegExp(`(?<=${CJK})\\s+(?=${CJK})`, 'g')

export type TextLayout = 'hard-wrapped' | 'paragraphs' | 'markdown'

function normalizeSpaces(text: string): string {
  return text.replace(CJK_BEFORE_ASCII, '').replace(ASCII_BEFORE_CJK, '')
}

function heading(level: 2 | 3, marker: string, title: string): string {
  // Headings are often letter-spaced in PDFs ("总 则").
  const rest = normalizeSpaces(title).replace(CJK_GAP, '').trim()
  return `${'#'.repeat(level)} ${rest ? `${marker} ${rest}` : marker}`
}

/**
 * hard-wrapped: PDF text, where one paragraph spans several lines.
 * paragraphs: Word or plain text, one paragraph per line.
 * markdown: Markdown, whose two top heading levels map to chapters and sections.
 */
export function structureText(raw: string, layout: TextLayout): string {
  const normalized = raw.replace(/\r\n?/g, '\n').replace(/\f/g, '\n')
  const lines = (layout === 'markdown' ? normalized.replace(FRONT_MATTER, '') : normalized).split('\n')
    .map(line => line.replace(/[ 　]/g, ' ').trim())
    .filter(line => line && !PAGE_NUMBER.test(line) && !TOC_LEADER.test(line))
  const widths = lines.map(line => line.length).sort((a, b) => a - b)
  const full = widths[Math.floor(widths.length * 0.9)] ?? 0
  const blocks: string[] = []
  let paragraph: string | null = null
  let pendingHeading: { level: 2 | 3; marker: string } | null = null
  let breakAfter = true
  let sawChapter = false

  const flush = () => {
    if (paragraph) blocks.push(normalizeSpaces(paragraph).replace(new RegExp(`^(第[${CN}]+条)\\s*`), '$1 '))
    paragraph = null
  }

  for (const line of lines) {
    if (pendingHeading) {
      // "第十一章" alone on a line: its title is the next line.
      blocks.push(heading(pendingHeading.level, pendingHeading.marker, line))
      pendingHeading = null
      breakAfter = true
      continue
    }
    const markdown = layout === 'markdown' ? MARKDOWN_HEADING.exec(line) : null
    if (markdown) {
      flush()
      const level = markdown[1].length
      if (level <= 2) blocks.push(`${level === 1 ? '##' : '###'} ${markdown[2].trim()}`)
      else blocks.push(markdown[2].trim())
      breakAfter = true
      continue
    }
    const chapter = CHAPTER.exec(line) ?? SECTION.exec(line)
    if (chapter && chapter[2].length <= 30) {
      flush()
      const level = CHAPTER.test(line) ? 2 : 3
      if (level === 2) sawChapter = true
      if (chapter[2].trim()) blocks.push(heading(level, chapter[1], chapter[2]))
      else pendingHeading = { level, marker: chapter[1] }
      breakAfter = true
      continue
    }
    if (ENUM_HEADING.test(line) && !/[。；，：]$/.test(line)) {
      flush()
      blocks.push(`${sawChapter ? '###' : '##'} ${normalizeSpaces(line)}`)
      breakAfter = true
      continue
    }
    const startsBlock = layout !== 'hard-wrapped' || breakAfter || paragraph === null
      || ARTICLE.test(line) || ITEM.test(line) || FORMULA.test(line)
    if (startsBlock) {
      flush()
      paragraph = line
    } else {
      const joinWithSpace = /[A-Za-z0-9,)]$/.test(paragraph!) && /^[A-Za-z0-9]/.test(line)
      paragraph += (joinWithSpace ? ' ' : '') + line
    }
    // A short line ending a sentence closes its paragraph; so does a short list-item title.
    breakAfter = (line.length < full - 1 && /[。；：！？]$/.test(line))
      || (ITEM.test(line) && line.length < full * 0.7 && !/[，、]$/.test(line))
  }
  flush()
  if (pendingHeading) blocks.push(heading(pendingHeading.level, pendingHeading.marker, ''))
  return blocks.join('\n\n') + '\n'
}
