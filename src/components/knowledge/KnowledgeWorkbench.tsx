import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppMode } from '@/components/layout/AppModeSwitch'
import { useKnowledgeChatStore } from '@/hooks/useKnowledgeChat'
import { KnowledgeContextPanel } from './KnowledgeContextPanel'
import { KnowledgePanel } from './KnowledgePanel'
import { KnowledgeSidebar } from './KnowledgeSidebar'

const CONTEXT_MIN_W = 320
const CONTEXT_MAX_W = 720
const DEFAULT_CONTEXT_W = 380

interface KnowledgeWorkbenchProps {
  activeApp: AppMode
  onAppChange: (app: AppMode) => void
  sidebarCollapsed?: boolean
  onToggleSidebar?: () => void
}

export function KnowledgeWorkbench({
  activeApp,
  onAppChange,
  sidebarCollapsed = false,
  onToggleSidebar,
}: KnowledgeWorkbenchProps) {
  const [contextOpen, setContextOpen] = useState(false)
  const [contextWidth, setContextWidth] = useState(DEFAULT_CONTEXT_W)
  const draggingRef = useRef(false)
  const startXRef = useRef(0)
  const startWRef = useRef(DEFAULT_CONTEXT_W)
  const latestXRef = useRef(0)
  const { activeEvidenceMessage } = useKnowledgeChatStore()

  const onContextDragStart = useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    draggingRef.current = true
    startXRef.current = event.clientX
    startWRef.current = contextWidth
    latestXRef.current = event.clientX
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [contextWidth])

  useEffect(() => {
    let rafPending = false
    const onMove = (event: MouseEvent) => {
      if (!draggingRef.current) return
      latestXRef.current = event.clientX
      if (rafPending) return
      rafPending = true
      requestAnimationFrame(() => {
        rafPending = false
        const delta = startXRef.current - latestXRef.current
        const viewportMax = Math.max(CONTEXT_MIN_W, Math.min(CONTEXT_MAX_W, window.innerWidth - 520))
        const next = Math.min(viewportMax, Math.max(CONTEXT_MIN_W, startWRef.current + delta))
        setContextWidth(next)
      })
    }
    const onUp = () => {
      if (!draggingRef.current) return
      draggingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [])

  return (
    <div className="app-canvas flex h-screen">
      <KnowledgeSidebar
        activeApp={activeApp}
        onAppChange={onAppChange}
        collapsed={sidebarCollapsed}
        onToggleCollapse={onToggleSidebar}
      />
      <KnowledgePanel contextOpen={contextOpen} onOpenContext={() => setContextOpen(true)} />
      {contextOpen && (
        <>
          <div
            onMouseDown={onContextDragStart}
            className="group relative z-40 w-1 flex-shrink-0 cursor-col-resize transition-colors hover:bg-primary/45 active:bg-primary/70"
            title="拖动调整证据面板宽度"
          >
            <div className="absolute inset-y-0 -left-1 -right-1 cursor-col-resize bg-transparent" />
            <div className="absolute left-1/2 top-1/2 h-10 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-stone-300/70 opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
          <KnowledgeContextPanel
            message={activeEvidenceMessage}
            width={contextWidth}
            onClose={() => setContextOpen(false)}
          />
        </>
      )}
    </div>
  )
}
