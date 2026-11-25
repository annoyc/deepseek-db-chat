import { createFileRoute } from '@tanstack/react-router'
import { KnowledgeWorkbench } from '@/components/knowledge/KnowledgeWorkbench'
import { useAppNavigation } from '@/hooks/useAppNavigation'
import { useLayout } from '@/hooks/useLayout'

export const Route = createFileRoute('/knowledge')({
  component: KnowledgePage,
})

function KnowledgePage() {
  const { pendingApp, preloadApp, handleAppChange } = useAppNavigation('knowledge')
  const { sidebarCollapsed, toggleSidebar } = useLayout()

  return (
    <KnowledgeWorkbench
      activeApp="knowledge"
      onAppChange={handleAppChange}
      pendingApp={pendingApp}
      onAppIntent={preloadApp}
      sidebarCollapsed={sidebarCollapsed}
      onToggleSidebar={toggleSidebar}
    />
  )
}
