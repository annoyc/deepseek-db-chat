import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { ChatPanel } from '@/components/chat/ChatPanel'
import { Sidebar } from '@/components/layout/Sidebar'

export const Route = createFileRoute('/')({
  component: HomePage,
})

function HomePage() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  return (
    <div className="flex h-screen">
      <Sidebar collapsed={sidebarCollapsed} onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)} />
      <main className="flex-1 flex flex-col min-w-0">
        <ChatPanel />
      </main>
    </div>
  )
}
