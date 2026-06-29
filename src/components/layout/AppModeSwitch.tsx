import { BookOpenText, Database } from 'lucide-react'
import { cn } from '@/lib/utils'

export type AppMode = 'database' | 'knowledge'

interface AppModeSwitchProps {
  activeApp: AppMode
  onAppChange: (app: AppMode) => void
  collapsed?: boolean
}

const apps = [
  { id: 'database' as const, label: '数据库', icon: Database, title: '数据库查询' },
  { id: 'knowledge' as const, label: '知识问答', icon: BookOpenText, title: '知识库问答' },
]

export function AppModeSwitch({ activeApp, onAppChange, collapsed = false }: AppModeSwitchProps) {
  if (collapsed) {
    return (
      <div className="flex flex-col gap-1 rounded-xl bg-gray-100 p-1">
        {apps.map((app) => {
          const Icon = app.icon
          const active = activeApp === app.id
          return (
            <button
              key={app.id}
              onClick={() => onAppChange(app.id)}
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-lg transition-all',
                active
                  ? 'bg-white text-primary shadow-sm ring-1 ring-primary/10'
                  : 'text-gray-500 hover:bg-white/70 hover:text-primary',
              )}
              title={app.title}
            >
              <Icon className="h-4 w-4" />
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1">
      {apps.map((app) => {
        const Icon = app.icon
        const active = activeApp === app.id
        return (
          <button
            key={app.id}
            onClick={() => onAppChange(app.id)}
            className={cn(
              'flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm transition-all',
              active
                ? 'bg-white text-primary shadow-sm ring-1 ring-primary/10'
                : 'text-gray-500 hover:bg-white/70 hover:text-primary',
            )}
          >
            <Icon className="h-4 w-4" />
            <span>{app.label}</span>
          </button>
        )
      })}
    </div>
  )
}
