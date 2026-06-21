import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { ChatPanel } from '@/components/chat/ChatPanel'
import { Sidebar } from '@/components/layout/Sidebar'
import { VisualizationPanel } from '@/components/chat/VisualizationPanel'
import { useChatStore } from '@/hooks/useChat'

const VIZ_MIN_W = 360
const VIZ_MAX_W = 1200
const VIZ_DEFAULT_W = 480

export const Route = createFileRoute('/')({
  component: HomePage,
})

function HomePage() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [vizPanelCollapsed, setVizPanelCollapsed] = useState(false)
  const [vizWidth, setVizWidth] = useState(VIZ_DEFAULT_W)
  const draggingRef = useRef(false)
  const startXRef = useRef(0)
  const startWRef = useRef(0)
  const { activeSession } = useChatStore()

  const hasVisualization = useMemo(() => {
    if (!activeSession?.messages) return false
    return activeSession.messages.some(m => m.role === 'assistant' && m.sqlResult)
  }, [activeSession?.messages])

  const showVizPanel = hasVisualization && !vizPanelCollapsed

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    draggingRef.current = true
    startXRef.current = e.clientX
    startWRef.current = vizWidth
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [vizWidth])

  useEffect(() => {
    let rafPending = false
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return
      if (rafPending) return
      rafPending = true
      requestAnimationFrame(() => {
        rafPending = false
        const delta = startXRef.current - e.clientX
        const next = Math.min(VIZ_MAX_W, Math.max(VIZ_MIN_W, startWRef.current + delta))
        setVizWidth(next)
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
    }
  }, [])

  return (
    <div className="flex h-screen">
      <Sidebar collapsed={sidebarCollapsed} onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)} />
      <main className="flex-1 flex min-w-0">
        <div className="flex-1 flex flex-col min-w-0">
          <ChatPanel
            vizPanelOpen={showVizPanel}
            onOpenVizPanel={() => setVizPanelCollapsed(false)}
            hasVisualization={hasVisualization}
          />
        </div>
        {showVizPanel && (
          <>
            {/* Drag handle */}
            <div
              onMouseDown={onDragStart}
              className="w-1 flex-shrink-0 cursor-col-resize group relative hover:bg-blue-400 active:bg-blue-500 transition-colors"
            >
              <div className="absolute inset-y-0 -left-1 -right-1" />
            </div>
            <div className="flex-shrink-0" style={{ width: vizWidth }}>
              <VisualizationPanel
                messages={activeSession?.messages ?? []}
                onCollapse={() => setVizPanelCollapsed(true)}
              />
            </div>
          </>
        )}
      </main>
    </div>
  )
}
