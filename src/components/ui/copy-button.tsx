import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Copy, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface CopyButtonProps {
  /** Text to copy; a function defers building it until the click. */
  text: string | (() => string)
  label?: string
  className?: string
  iconClassName?: string
}

export function CopyButton({ text, label = '复制', className, iconClassName = 'h-3.5 w-3.5' }: CopyButtonProps) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timerRef.current), [])

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(typeof text === 'function' ? text() : text)
      setState('copied')
    } catch {
      setState('failed')
    }
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setState('idle'), 2000)
  }, [text])

  const currentLabel = state === 'copied' ? '已复制' : state === 'failed' ? '复制失败，请手动选择文本' : label

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={currentLabel}
      aria-label={currentLabel}
      className={cn(
        'inline-flex items-center justify-center rounded-md p-1 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary',
        className,
      )}
    >
      {state === 'copied'
        ? <Check className={cn(iconClassName, 'text-green-500')} />
        : state === 'failed'
          ? <X className={cn(iconClassName, 'text-red-500')} />
          : <Copy className={iconClassName} />}
      <span className="sr-only" role="status">{state === 'idle' ? '' : currentLabel}</span>
    </button>
  )
}
