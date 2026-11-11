import type { ReactNode } from 'react'
import { Dialog } from 'radix-ui'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ModalProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  /** Classes for the panel itself (width, height, layout). */
  className?: string
  /** When false, Esc and clicking the backdrop are ignored (e.g. while saving). */
  dismissible?: boolean
  /** Clicking the backdrop closes the dialog. Off for forms, so typed input is not lost by a stray click. */
  closeOnBackdrop?: boolean
}

/**
 * Shared modal shell: focus is moved into the dialog and trapped there, Esc closes it,
 * the page behind is inert, and focus returns to the trigger on close.
 * Label it with <ModalTitle>.
 */
export function Modal({ open, onClose, children, className, dismissible = true, closeOnBackdrop = true }: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next && dismissible) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 animate-in fade-in duration-150" />
        <Dialog.Content
          aria-describedby={undefined}
          onEscapeKeyDown={(event) => { if (!dismissible) event.preventDefault() }}
          onInteractOutside={(event) => { if (!dismissible || !closeOnBackdrop) event.preventDefault() }}
          className={cn(
            'fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white shadow-2xl outline-none animate-in fade-in zoom-in-95 duration-150',
            className,
          )}
        >
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function ModalTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <Dialog.Title className={className}>{children}</Dialog.Title>
}

interface ConfirmDialogProps {
  open: boolean
  title: string
  description: ReactNode
  confirmLabel: string
  cancelLabel?: string
  onConfirm: () => void
  onClose: () => void
}

/** Destructive confirmation. Focus starts on "cancel" so Enter never deletes by accident. */
export function ConfirmDialog({ open, title, description, confirmLabel, cancelLabel = '取消', onConfirm, onClose }: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={onClose}>
      <div className="flex items-center justify-between p-5 pb-2">
        <ModalTitle className="text-lg font-bold text-gray-900">{title}</ModalTitle>
        <button onClick={onClose} aria-label="关闭" className="rounded-lg p-1.5 transition-colors hover:bg-gray-100">
          <X className="h-5 w-5 text-gray-500" />
        </button>
      </div>
      <div className="space-y-4 px-5 pb-5">
        <div className="text-sm text-gray-600">{description}</div>
        <div className="flex justify-end gap-3 pt-2">
          <button
            autoFocus
            onClick={onClose}
            className="rounded-xl border border-gray-300 px-6 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className="rounded-xl bg-red-600 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  )
}
