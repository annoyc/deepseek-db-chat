import { PanelLeftClose } from 'lucide-react'
import { APP_NAME, APP_TAGLINE, APP_TITLE } from '@/lib/constants'
import { cn } from '@/lib/utils'

interface BrandHeaderProps {
  collapsed: boolean
  onToggleCollapse?: () => void
}

/** Shared identity for the database and knowledge workspaces. */
export function BrandHeader({ collapsed, onToggleCollapse }: BrandHeaderProps) {
  return (
    <div className={cn('flex items-center gap-2', collapsed ? 'justify-center' : 'justify-between')}>
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
          aria-expanded={!collapsed}
          title={`${APP_TITLE} · ${collapsed ? '展开' : '收起'}侧边栏`}
          className={cn(
            'shrink-0 transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary',
            collapsed ? 'h-8 w-8 rounded-[9px]' : 'h-10 w-10 rounded-[11px]',
          )}
        >
          <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" className="block h-full w-full" />
        </button>
        {!collapsed && (
          <div className="min-w-0">
            <div className="flex items-baseline gap-2 leading-none">
              <span className="text-[20px] font-bold tracking-[0.08em] text-[#153E38]">{APP_NAME}</span>
              <span className="whitespace-nowrap text-[10px] font-medium tracking-wide text-stone-500">AI 工作台</span>
            </div>
            <p className="mt-1.5 whitespace-nowrap text-[11px] leading-4 tracking-[0.025em] text-stone-500">{APP_TAGLINE}</p>
          </div>
        )}
      </div>
      {!collapsed && (
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label="收起侧边栏"
          aria-expanded
          title="收起侧边栏"
          className="shrink-0 rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-white/70 hover:text-stone-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <PanelLeftClose className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}
