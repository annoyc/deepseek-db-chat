import type { MouseEvent } from 'react'
import { BookOpenText, Database } from 'lucide-react'
import { cn } from '@/lib/utils'

export type AppMode = 'database' | 'knowledge'

interface AppModeSwitchProps {
  activeApp: AppMode
  onAppChange: (app: AppMode) => void
  pendingApp?: AppMode | null
  onAppIntent?: (app: AppMode) => void
  collapsed?: boolean
}

const apps = [
  { id: 'database' as const, label: '数据库', icon: Database, title: '数据库查询', slug: 'dbpilot' },
  { id: 'knowledge' as const, label: '知识问答', icon: BookOpenText, title: '知识库问答', slug: 'knowledge' },
]

function appHref(slug: string): string {
  const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`
  return `${base}${slug}`
}

export function AppModeSwitch({ activeApp, onAppChange, pendingApp = null, onAppIntent, collapsed = false }: AppModeSwitchProps) {
  const effectiveApp = pendingApp ?? activeApp

  const handleClick = (event: MouseEvent<HTMLAnchorElement>, appId: AppMode) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.defaultPrevented) {
      return
    }
    event.preventDefault()
    onAppChange(appId)
  }

  if (collapsed) {
    return (
      <div className="flex flex-col gap-1 rounded-xl border border-line bg-surface-muted p-1">
        {apps.map((app) => {
          const Icon = app.icon
          const active = effectiveApp === app.id
          return (
            <a
              key={app.id}
              href={appHref(app.slug)}
              data-drawer-close
              aria-current={active ? 'page' : undefined}
              onPointerEnter={() => onAppIntent?.(app.id)}
              onFocus={() => onAppIntent?.(app.id)}
              onClick={(event) => handleClick(event, app.id)}
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-200',
                active
                  ? 'bg-surface text-primary shadow-sm ring-1 ring-primary/20'
                  : 'text-ink-muted hover:bg-surface/75 hover:text-ink',
              )}
              title={app.title}
            >
              <Icon className="h-4 w-4" />
            </a>
          )
        })}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-surface-muted p-1">
      {apps.map((app) => {
        const Icon = app.icon
        const active = effectiveApp === app.id
        return (
          <a
            key={app.id}
            href={appHref(app.slug)}
            data-drawer-close
            aria-current={active ? 'page' : undefined}
            onPointerEnter={() => onAppIntent?.(app.id)}
            onFocus={() => onAppIntent?.(app.id)}
            onClick={(event) => handleClick(event, app.id)}
            className={cn(
              'flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-all duration-200',
              active
                ? 'bg-surface text-primary shadow-sm ring-1 ring-primary/20'
                : 'text-ink-muted hover:bg-surface/75 hover:text-ink',
            )}
          >
            <Icon className="h-4 w-4" />
            <span>{app.label}</span>
          </a>
        )
      })}
    </div>
  )
}
