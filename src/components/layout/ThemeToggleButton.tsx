import { Moon, Sun } from 'lucide-react'
import { useTheme } from '@/hooks/useTheme'
import { cn } from '@/lib/utils'

interface ThemeToggleButtonProps {
  compact?: boolean
  className?: string
}

/** One-click light/dark toggle; renders both icons via CSS dark variant to avoid SSR hydration mismatch. */
export function ThemeToggleButton({ compact = false, className }: ThemeToggleButtonProps) {
  const { resolvedTheme, toggleThemeMode } = useTheme()
  const label = resolvedTheme === 'dark' ? '切换到浅色模式' : '切换到深色模式'

  return (
    <button
      type="button"
      onClick={toggleThemeMode}
      title={label}
      aria-label={label}
      className={cn(
        'rounded-lg text-ink-muted transition-colors hover:bg-surface/80 hover:text-ink',
        compact ? 'p-2.5' : 'p-2',
        className,
      )}
    >
      <Sun className="hidden h-3.5 w-3.5 dark:block" />
      <Moon className="block h-3.5 w-3.5 dark:hidden" />
    </button>
  )
}
