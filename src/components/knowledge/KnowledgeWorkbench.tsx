import { useState } from 'react'
import type { AppMode } from '@/components/layout/AppModeSwitch'
import { useKnowledgeChatStore } from '@/hooks/useKnowledgeChat'
import { KnowledgeContextPanel } from './KnowledgeContextPanel'
import { KnowledgePanel } from './KnowledgePanel'
import { KnowledgeSidebar } from './KnowledgeSidebar'

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
  const { activeEvidenceMessage } = useKnowledgeChatStore()

  return (
    <div className="flex h-screen">
      <KnowledgeSidebar
        activeApp={activeApp}
        onAppChange={onAppChange}
        collapsed={sidebarCollapsed}
        onToggleCollapse={onToggleSidebar}
      />
      <KnowledgePanel contextOpen={contextOpen} onOpenContext={() => setContextOpen(true)} />
      {contextOpen && (
        <KnowledgeContextPanel
          message={activeEvidenceMessage}
          onClose={() => setContextOpen(false)}
        />
      )}
    </div>
  )
}
