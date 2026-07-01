import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ChatPanel } from '@/components/chat/ChatPanel'
import { Sidebar } from '@/components/layout/Sidebar'
import { VisualizationPanel } from '@/components/chat/VisualizationPanel'
import type { AppMode } from '@/components/layout/AppModeSwitch'
import { useChatStore } from '@/hooks/useChat'

const VIZ_MIN_W = 360
const VIZ_MAX_W = 1200
const DEFAULT_VIZ_VIEWPORT_W = 1280

/**
 * 响应式默认宽度：取视口的 38%，并限制在 [VIZ_MIN_W, VIZ_MAX_W] 之间。
 * 小屏（如 <1000px）会自动收敛到接近最小宽度，避免挤占中间聊天区域；
 * 大屏则相对宽裕。用户手动拖拽后以用户值为准，不再随 resize 变动。
 */
function responsiveVizWidth(): number {
  const vw = typeof window !== 'undefined' ? window.innerWidth : DEFAULT_VIZ_VIEWPORT_W
  return Math.min(VIZ_MAX_W, Math.max(VIZ_MIN_W, Math.round(vw * 0.38)))
}

export const Route = createFileRoute('/dbpilot')({
  component: DbpilotPage,
})

function DbpilotPage() {
  const navigate = useNavigate()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [vizPanelCollapsed, setVizPanelCollapsed] = useState(false)
  const [vizWidth, setVizWidth] = useState(() => responsiveVizWidth())
  const userResizedRef = useRef(false)
  const draggingRef = useRef(false)
  const startXRef = useRef(0)
  const startWRef = useRef(0)
  const latestXRef = useRef(0)
  const { activeSession } = useChatStore()

  const hasVisualization = useMemo(() => {
    if (!activeSession?.messages) return false
    return activeSession.messages.some(m => m.role === 'assistant' && m.sqlResult)
  }, [activeSession?.messages])

  const showVizPanel = hasVisualization && !vizPanelCollapsed

  const handleAppChange = useCallback((app: AppMode) => {
    navigate({ to: app === 'knowledge' ? '/knowledge' : '/dbpilot' })
  }, [navigate])

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
      latestXRef.current = e.clientX
      if (rafPending) return
      rafPending = true
      requestAnimationFrame(() => {
        rafPending = false
        const delta = startXRef.current - latestXRef.current
        const next = Math.min(VIZ_MAX_W, Math.max(VIZ_MIN_W, startWRef.current + delta))
        setVizWidth(next)
      })
    }
    const onUp = () => {
      if (!draggingRef.current) return
      draggingRef.current = false
      userResizedRef.current = true
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

  // 响应式：窗口尺寸变化时，若用户未手动拖拽过，重新计算默认宽度，
  // 让小屏自动收窄、避免挤占中间聊天区域。
  useEffect(() => {
    const onResize = () => {
      if (userResizedRef.current) return
      setVizWidth(responsiveVizWidth())
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return (
    <div className="app-canvas flex h-screen">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((collapsed) => !collapsed)}
        activeApp="database"
        onAppChange={handleAppChange}
      />
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
              className="group relative z-50 w-1 flex-shrink-0 cursor-col-resize transition-colors hover:bg-primary/45 active:bg-primary/70"
            >
              <div className="absolute inset-y-0 -left-1 -right-1 cursor-col-resize bg-transparent" />
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
