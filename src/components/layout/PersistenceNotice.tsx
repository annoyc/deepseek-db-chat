import type { PersistenceState } from '@/lib/session-storage'

export function PersistenceNotice({ state, onRetry }: { state: PersistenceState; onRetry: () => void }) {
  if (state === 'loading') return <div role="status" className="px-4 py-2 text-xs text-ink-muted">正在读取历史记录…</div>
  if (state !== 'error' && state !== 'load-error') return null
  return (
    <div role="alert" className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/45 dark:text-amber-300">
      <span>{state === 'load-error' ? '无法读取历史记录，请重试后再开始新任务。' : '历史记录尚未保存，请重试后再关闭页面。'}</span>
      <button type="button" onClick={onRetry} className="shrink-0 rounded border border-amber-300 px-2 py-1 font-medium hover:bg-amber-100 dark:border-amber-700/60 dark:hover:bg-amber-900/50">{state === 'load-error' ? '重试读取' : '重试保存'}</button>
    </div>
  )
}
