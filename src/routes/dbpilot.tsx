import { useState, useMemo, useCallback, useEffect } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ChatPanel } from '@/components/chat/ChatPanel'
import { Sidebar } from '@/components/layout/Sidebar'
import { VisualizationPanel, VizFocusContext } from '@/components/chat/VisualizationPanel'
import { ResizeHandle } from '@/components/layout/ResizeHandle'
import { SidebarFrame, SidePanelOverlay } from '@/components/layout/ResponsiveFrames'
import type { AppMode } from '@/components/layout/AppModeSwitch'
import { useChatStore } from '@/hooks/useChat'
import { MOBILE_QUERY, NARROW_QUERY, useLayout, useMediaQuery, useViewportWidth } from '@/hooks/useLayout'

const VIZ_MIN_W = 360
const VIZ_MAX_W = 1200
/** The chat column never gets narrower than this because of the data panel. */
const CHAT_MIN_W = 420
const SIDEBAR_W = 272
const SIDEBAR_COLLAPSED_W = 60

export const Route = createFileRoute('/dbpilot')({
  component: DbpilotPage,
})

function DbpilotPage() {
  const navigate = useNavigate()
  const { sidebarCollapsed, toggleSidebar, vizWidth, setVizWidth } = useLayout()
  const isMobile = useMediaQuery(MOBILE_QUERY)
  const isNarrow = useMediaQuery(NARROW_QUERY)
  const viewportWidth = useViewportWidth()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  // null follows the default: open beside the chat on wide screens, closed when it would cover the chat.
  const [vizOpenPref, setVizOpenPref] = useState<boolean | null>(null)
  const [focusRequest, setFocusRequest] = useState<{ id: string; nonce: number } | null>(null)
  const { activeSession } = useChatStore()
  const activeSessionId = activeSession?.id

  const vizCount = useMemo(() => {
    return (activeSession?.messages ?? []).filter((m) => m.role === 'assistant' && m.sqlResult).length
  }, [activeSession?.messages])
  const hasVisualization = vizCount > 0
  const showVizPanel = hasVisualization && (vizOpenPref ?? !isNarrow)

  useEffect(() => {
    setMobileNavOpen(false)
    if (isNarrow) setVizOpenPref(null)
    // Only a session switch should close the overlays, not crossing the breakpoint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId])

  const handleAppChange = useCallback((app: AppMode) => {
    navigate({ to: app === 'knowledge' ? '/knowledge' : '/dbpilot' })
  }, [navigate])

  const focusVizItem = useCallback((messageId: string) => {
    setVizOpenPref(true)
    setFocusRequest((prev) => ({ id: messageId, nonce: (prev?.nonce ?? 0) + 1 }))
  }, [])
  const clearFocusRequest = useCallback(() => setFocusRequest(null), [])
  const closeViz = useCallback(() => setVizOpenPref(false), [])
  const closeMobileNav = useCallback(() => setMobileNavOpen(false), [])

  const sidebarWidth = isMobile ? 0 : sidebarCollapsed ? SIDEBAR_COLLAPSED_W : SIDEBAR_W
  const vizMaxWidth = Math.min(VIZ_MAX_W, Math.max(VIZ_MIN_W, viewportWidth - sidebarWidth - CHAT_MIN_W))
  const effectiveVizWidth = Math.min(vizMaxWidth, Math.max(VIZ_MIN_W, vizWidth ?? Math.round(viewportWidth * 0.38)))

  const vizPanel = (
    <VisualizationPanel
      messages={activeSession?.messages ?? []}
      onCollapse={closeViz}
      focusRequest={focusRequest}
      onFocusHandled={clearFocusRequest}
    />
  )

  return (
    <VizFocusContext.Provider value={focusVizItem}>
      <div className="app-canvas flex h-dvh">
        <SidebarFrame isMobile={isMobile} open={mobileNavOpen} onClose={closeMobileNav}>
          <Sidebar
            collapsed={isMobile ? false : sidebarCollapsed}
            onToggleCollapse={isMobile ? closeMobileNav : toggleSidebar}
            activeApp="database"
            onAppChange={handleAppChange}
          />
        </SidebarFrame>
        <main className="flex-1 flex min-w-0">
          <div className="flex-1 flex flex-col min-w-0">
            <ChatPanel
              vizPanelOpen={showVizPanel}
              onOpenVizPanel={() => setVizOpenPref(true)}
              vizCount={vizCount}
              onOpenSidebar={isMobile ? () => setMobileNavOpen(true) : undefined}
            />
          </div>
          {showVizPanel && !isNarrow && (
            <>
              <ResizeHandle
                width={effectiveVizWidth}
                min={VIZ_MIN_W}
                max={vizMaxWidth}
                onResize={setVizWidth}
                label="调整数据面板宽度"
              />
              <div className="flex-shrink-0" style={{ width: effectiveVizWidth }}>
                {vizPanel}
              </div>
            </>
          )}
        </main>
        {showVizPanel && isNarrow && (
          <SidePanelOverlay label="数据面板" onClose={closeViz}>
            {vizPanel}
          </SidePanelOverlay>
        )}
      </div>
    </VizFocusContext.Provider>
  )
}
