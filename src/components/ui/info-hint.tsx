import type { ReactNode } from 'react'
import { Info } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from './popover'

/** A small "i" button that reveals secondary explanation on click, tap or keyboard. */
export function InfoHint({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          className="rounded p-1 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3 text-xs leading-relaxed text-stone-600">
        {children}
      </PopoverContent>
    </Popover>
  )
}
