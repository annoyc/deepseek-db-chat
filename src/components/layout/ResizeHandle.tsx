import { useCallback, useRef } from 'react'

interface ResizeHandleProps {
  /** Current width of the panel to the right of the handle. */
  width: number
  min: number
  max: number
  onResize: (width: number) => void
  label: string
}

const KEY_STEP = 24

/** Drag (mouse, touch or pen) or use the arrow keys to resize the panel on its right. */
export function ResizeHandle({ width, min, max, onResize, label }: ResizeHandleProps) {
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const frameRef = useRef(0)
  const clamp = useCallback((value: number) => Math.min(max, Math.max(min, Math.round(value))), [min, max])

  const endDrag = useCallback(() => {
    if (!dragRef.current) return
    dragRef.current = null
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }, [])

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(width)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title={`${label}（可拖动，或用左右方向键）`}
      onPointerDown={(event) => {
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        dragRef.current = { startX: event.clientX, startWidth: width }
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current
        if (!drag) return
        const next = clamp(drag.startWidth + drag.startX - event.clientX)
        cancelAnimationFrame(frameRef.current)
        frameRef.current = requestAnimationFrame(() => onResize(next))
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={(event) => {
        const next = event.key === 'ArrowLeft' ? width + KEY_STEP
          : event.key === 'ArrowRight' ? width - KEY_STEP
            : event.key === 'Home' ? max
              : event.key === 'End' ? min
                : null
        if (next === null) return
        event.preventDefault()
        onResize(clamp(next))
      }}
      className="group relative z-30 w-1 flex-shrink-0 cursor-col-resize touch-none transition-colors hover:bg-primary/45 focus-visible:bg-primary/60 focus-visible:outline-none active:bg-primary/70"
    >
      <div className="absolute inset-y-0 -left-1.5 -right-1.5 cursor-col-resize bg-transparent" />
      <div className="absolute left-1/2 top-1/2 h-10 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-stone-300/70 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
    </div>
  )
}
