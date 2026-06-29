import { useCallback, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { KnowledgeWorkbench } from '@/components/knowledge/KnowledgeWorkbench'
import type { AppMode } from '@/components/layout/AppModeSwitch'

export const Route = createFileRoute('/knowledge')({
  component: KnowledgePage,
})

function KnowledgePage() {
  const navigate = useNavigate()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  const handleAppChange = useCallback((app: AppMode) => {
    navigate({ to: app === 'knowledge' ? '/knowledge' : '/dbpilot' })
  }, [navigate])

  return (
    <KnowledgeWorkbench
      activeApp="knowledge"
      onAppChange={handleAppChange}
      sidebarCollapsed={sidebarCollapsed}
      onToggleSidebar={() => setSidebarCollapsed((collapsed) => !collapsed)}
    />
  )
}
