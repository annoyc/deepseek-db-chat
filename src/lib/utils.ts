import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Fallback for non-secure HTTP environments (e.g. accessing via server IP directly)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export function formatTimestamp(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength) + '...'
}

/** Get relative time string in Chinese, using calendar-day boundaries (consistent with getTimeGroup) */
export function getRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffHour = Math.floor(diffMs / 3600000)

  // Calendar-day boundaries (same logic as getTimeGroup)
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterdayStart = new Date(todayStart.getTime() - 86400000)
  const daysDiff = Math.floor((todayStart.getTime() - new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) / 86400000)

  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin}分钟前`
  if (date >= todayStart) return `${diffHour}小时前`
  if (date >= yesterdayStart) return '昨天'
  if (daysDiff < 7) return `${daysDiff}天前`
  if (daysDiff < 30) return `${Math.floor(daysDiff / 7)}周前`
  return `${Math.floor(daysDiff / 30)}月前`
}

/** Group sessions by time category: 今天 / 昨天 / 最近7天 / 更早 */
export type TimeGroup = 'today' | 'yesterday' | 'last7days' | 'older'

export function getTimeGroup(dateStr: string): TimeGroup {
  const date = new Date(dateStr)
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterdayStart = new Date(todayStart.getTime() - 86400000)
  const weekStart = new Date(todayStart.getTime() - 7 * 86400000)

  if (date >= todayStart) return 'today'
  if (date >= yesterdayStart) return 'yesterday'
  if (date >= weekStart) return 'last7days'
  return 'older'
}

export const timeGroupLabels: Record<TimeGroup, string> = {
  today: '今天',
  yesterday: '昨天',
  last7days: '最近7天',
  older: '更早',
}

export const timeGroupOrder: TimeGroup[] = ['today', 'yesterday', 'last7days', 'older']

export const envConfig: Record<string, { label: string; color: string; bg: string }> = {
  prod: { label: 'PROD', color: 'text-red-700', bg: 'bg-red-50 border-red-200' },
  dev: { label: 'DEV', color: 'text-green-700', bg: 'bg-green-50 border-green-200' },
  test: { label: 'PRE', color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200' },
  staging: { label: 'UAT', color: 'text-yellow-700', bg: 'bg-yellow-50 border-yellow-200' },
  unknown: { label: '', color: 'text-gray-500', bg: 'bg-gray-50 border-gray-200' },
}

/** Detect database type from port or name heuristics */
export function getDbTypeFromConnection(conn: { host: string; port: number; database: string }): string {
  const port = conn.port
  if (port === 3306 || port === 3307) return 'MySQL'
  if (port === 5432 || port === 5433) return 'PostgreSQL'
  if (port === 27017) return 'MongoDB'
  if (port === 6379) return 'Redis'
  if (port === 1433) return 'SQL Server'
  if (port === 1521) return 'Oracle'
  // Fallback: guess from name patterns
  const db = conn.database?.toLowerCase() ?? ''
  if (db.includes('mysql') || db.includes('maria')) return 'MySQL'
  if (db.includes('postgres') || db.includes('pg')) return 'PostgreSQL'
  return 'MySQL'
}
