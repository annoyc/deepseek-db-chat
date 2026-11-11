import { useCallback } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { KnowledgeWorkbench } from '@/components/knowledge/KnowledgeWorkbench'
import type { AppMode } from '@/components/layout/AppModeSwitch'
import { useLayout } from '@/hooks/useLayout'

export const Route = createFileRoute('/knowledge')({
  component: KnowledgePage,
})

function KnowledgePage() {
  const navigate = useNavigate()
  const { sidebarCollapsed, toggleSidebar } = useLayout()

  const handleAppChange = useCallback((app: AppMode) => {
    navigate({ to: app === 'knowledge' ? '/knowledge' : '/dbpilot' })
  }, [navigate])

  return (
    <KnowledgeWorkbench
      activeApp="knowledge"
      onAppChange={handleAppChange}
      sidebarCollapsed={sidebarCollapsed}
      onToggleSidebar={toggleSidebar}
    />
  )
}
