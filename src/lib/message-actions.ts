import type { ExecutionLogEntry } from './types'

export type AnswerFeedback = 'up' | 'down'

export interface TurnMessageLike {
  id: string
  role: 'user' | 'assistant'
  content: string
  sqlResult?: unknown
}

export interface TurnContext<T extends TurnMessageLike> {
  userMessage: T | null
  userMessageIndex: number
  turnStartIndex: number
  turnEndIndex: number
  turnMessages: T[]
  latestVizMessageId: string | null
  isLatestTurn: boolean
}

/**
 * Locate the user prompt, assistant messages, and latest SQL result belonging
 * to the turn that produced `assistantMessageId`.
 */
export function findTurnContext<T extends TurnMessageLike>(
  messages: T[],
  assistantMessageId: string,
): TurnContext<T> | null {
  const targetIdx = messages.findIndex((m) => m.id === assistantMessageId)
  if (targetIdx === -1) return null

  let userMessageIndex = -1
  for (let i = targetIdx - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      userMessageIndex = i
      break
    }
  }

  let turnEndIndex = messages.length
  for (let i = targetIdx + 1; i < messages.length; i++) {
    if (messages[i].role === 'user') {
      turnEndIndex = i
      break
    }
  }

  const turnStartIndex = userMessageIndex + 1
  const turnMessages = messages.slice(turnStartIndex, turnEndIndex)

  let latestVizMessageId: string | null = null
  for (let i = turnMessages.length - 1; i >= 0; i--) {
    if (turnMessages[i].role === 'assistant' && turnMessages[i].sqlResult) {
      latestVizMessageId = turnMessages[i].id
      break
    }
  }

  return {
    userMessage: userMessageIndex >= 0 ? messages[userMessageIndex] : null,
    userMessageIndex,
    turnStartIndex,
    turnEndIndex,
    turnMessages,
    latestVizMessageId,
    isLatestTurn: turnEndIndex === messages.length,
  }
}

/**
 * Keep only executionLog entries that correspond to SQL queries from the
 * retained prefix of messages when regenerating an earlier or current turn.
 */
export function trimExecutionLogForPrefix(
  executionLog: ExecutionLogEntry[] | undefined,
  keptMessages: Array<{ role: 'user' | 'assistant'; sqlResult?: unknown }>,
): ExecutionLogEntry[] | undefined {
  if (!executionLog || executionLog.length === 0) return executionLog
  const keptSqlCount = keptMessages.filter((m) => m.role === 'assistant' && Boolean(m.sqlResult)).length
  if (keptSqlCount === 0) return []
  return executionLog.slice(0, keptSqlCount)
}

export interface MarkdownExportCitation {
  ref: string
  docTitle: string
  locator?: string
  statusLabel?: string
  cited?: boolean
}

export interface MarkdownExportOptions {
  question?: string
  answer: string
  modelName?: string
  durationMs?: number
  queryCount?: number
  citations?: MarkdownExportCitation[]
  exportedAt?: Date
}

function formatExportDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.round(seconds % 60)
  return `${minutes}m ${remainingSeconds}s`
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function formatDateTime(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

/** Format an answer (plus its question and optional cited sources) as a clean Markdown report. */
export function buildMarkdownExport(options: MarkdownExportOptions): string {
  const sections: string[] = []
  const question = options.question?.trim()
  const answer = options.answer.trim()

  if (question) {
    const heading = question.split(/\r?\n/)[0].slice(0, 80)
    sections.push(`# ${heading}`)
    if (question !== heading) {
      sections.push(`> ${question.replace(/\r?\n/g, '\n> ')}`)
    }
  }

  sections.push(answer)

  const cited = (options.citations ?? []).filter((c) => c.cited !== false)
  if (cited.length > 0) {
    const lines = cited.map((c) => {
      const locator = c.locator ? ` · ${c.locator}` : ''
      const status = c.statusLabel ? `（${c.statusLabel}）` : ''
      return `- [${c.ref}] ${c.docTitle}${locator}${status}`
    })
    sections.push(`## 参考依据\n\n${lines.join('\n')}`)
  }

  const metaParts: string[] = []
  metaParts.push(`导出时间：${formatDateTime(options.exportedAt ?? new Date())}`)
  if (options.modelName) metaParts.push(`模型：${options.modelName}`)
  if (options.queryCount != null && options.queryCount > 0) metaParts.push(`${options.queryCount} 次查询`)
  if (options.durationMs != null) metaParts.push(`耗时 ${formatExportDuration(options.durationMs)}`)
  sections.push(`---\n\n*${metaParts.join(' · ')}*`)

  return `${sections.join('\n\n')}\n`
}

/** Build a filesystem-safe `.md` filename from the user's question. */
export function buildExportFilename(question?: string, fallback = '分析报告', now = new Date()): string {
  const dateTag = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`
  const raw = (question ?? '')
    .split(/\r?\n/)[0]
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40)
    .replace(/[. ]+$/g, '')
  const stem = raw || fallback
  return `${stem}-${dateTag}.md`
}

/** Trigger a client-side Markdown file download. */
export function downloadMarkdownFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    URL.revokeObjectURL(url)
  }
}
