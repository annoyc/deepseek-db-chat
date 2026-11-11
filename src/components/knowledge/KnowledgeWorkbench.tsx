import { useCallback, useEffect, useState } from 'react'
import type { AppMode } from '@/components/layout/AppModeSwitch'
import { ResizeHandle } from '@/components/layout/ResizeHandle'
import { SidebarFrame, SidePanelOverlay } from '@/components/layout/ResponsiveFrames'
import { useKnowledgeChatStore } from '@/hooks/useKnowledgeChat'
import { MOBILE_QUERY, NARROW_QUERY, useLayout, useMediaQuery, useViewportWidth } from '@/hooks/useLayout'
import { KnowledgeContextPanel } from './KnowledgeContextPanel'
import { KnowledgePanel } from './KnowledgePanel'
import { KnowledgeSidebar } from './KnowledgeSidebar'

const CONTEXT_MIN_W = 320
const CONTEXT_MAX_W = 720
const DEFAULT_CONTEXT_W = 380
const CHAT_MIN_W = 520

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
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const { contextWidth, setContextWidth } = useLayout()
  const isMobile = useMediaQuery(MOBILE_QUERY)
  const isNarrow = useMediaQuery(NARROW_QUERY)
  const viewportWidth = useViewportWidth()
  const { activeEvidenceMessage, activeSessionId } = useKnowledgeChatStore()

  useEffect(() => {
    setMobileNavOpen(false)
  }, [activeSessionId])

  const closeContext = useCallback(() => setContextOpen(false), [])
  const closeMobileNav = useCallback(() => setMobileNavOpen(false), [])

  const maxWidth = Math.max(CONTEXT_MIN_W, Math.min(CONTEXT_MAX_W, viewportWidth - CHAT_MIN_W))
  const width = Math.min(maxWidth, Math.max(CONTEXT_MIN_W, contextWidth ?? DEFAULT_CONTEXT_W))

  return (
    <div className="app-canvas flex h-dvh">
      <SidebarFrame isMobile={isMobile} open={mobileNavOpen} onClose={closeMobileNav}>
        <KnowledgeSidebar
          activeApp={activeApp}
          onAppChange={onAppChange}
          collapsed={isMobile ? false : sidebarCollapsed}
          onToggleCollapse={isMobile ? closeMobileNav : onToggleSidebar}
        />
      </SidebarFrame>
      <KnowledgePanel
        contextOpen={contextOpen}
        onOpenContext={() => setContextOpen(true)}
        onOpenSidebar={isMobile ? () => setMobileNavOpen(true) : undefined}
      />
      {contextOpen && !isNarrow && (
        <>
          <ResizeHandle
            width={width}
            min={CONTEXT_MIN_W}
            max={maxWidth}
            onResize={setContextWidth}
            label="调整证据面板宽度"
          />
          <KnowledgeContextPanel message={activeEvidenceMessage} width={width} onClose={closeContext} />
        </>
      )}
      {contextOpen && isNarrow && (
        <SidePanelOverlay label="证据面板" onClose={closeContext}>
          <KnowledgeContextPanel message={activeEvidenceMessage} onClose={closeContext} fill />
        </SidePanelOverlay>
      )}
    </div>
  )
}
