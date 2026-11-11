import { useEffect, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

function useEscape(active: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!active) return
    const onKeyDown = (event: KeyboardEvent) => {
      // Dialogs opened on top handle their own Escape.
      if (event.key === 'Escape' && !document.querySelector('[role="dialog"][data-state="open"]')) onEscape()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active, onEscape])
}

interface SidebarFrameProps {
  isMobile: boolean
  open: boolean
  onClose: () => void
  children: ReactNode
}

/** On phones the sidebar is an off-canvas drawer; on larger screens it sits in the layout as is. */
export function SidebarFrame({ isMobile, open, onClose, children }: SidebarFrameProps) {
  useEscape(isMobile && open, onClose)
  if (!isMobile) return <>{children}</>
  return (
    <>
      <div
        aria-hidden="true"
        onClick={onClose}
        className={cn('fixed inset-0 z-40 bg-black/40 transition-opacity duration-200', open ? 'opacity-100' : 'pointer-events-none opacity-0')}
      />
      <div
        inert={!open}
        // Picking a conversation (even the current one) or starting a new one dismisses the drawer.
        onClick={(event) => {
          const target = event.target as HTMLElement
          if (target.closest('[data-drawer-close]') && !target.closest('input')) onClose()
        }}
        className={cn(
          'fixed inset-y-0 left-0 z-40 max-w-[86vw] shadow-2xl transition-transform duration-200 ease-out',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {children}
      </div>
    </>
  )
}

interface SidePanelOverlayProps {
  label: string
  onClose: () => void
  children: ReactNode
}

/** A right-hand panel shown over the chat on screens too narrow to fit both side by side. */
export function SidePanelOverlay({ label, onClose, children }: SidePanelOverlayProps) {
  useEscape(true, onClose)
  return (
    <>
      <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-40 bg-black/40 animate-in fade-in duration-150" />
      <div
        role="complementary"
        aria-label={label}
        className="fixed inset-y-0 right-0 z-40 w-full shadow-2xl animate-in slide-in-from-right-8 fade-in duration-200 sm:w-[min(560px,92vw)]"
      >
        {children}
      </div>
    </>
  )
}
