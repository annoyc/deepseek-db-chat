import type { ReactNode } from 'react'
import { Outlet, HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'
import { DatabaseProvider } from '@/hooks/useDatabase'
import { ChatProvider } from '@/hooks/useChat'
import { KnowledgeChatProvider } from '@/hooks/useKnowledgeChat'
import { KnowledgeDocumentsProvider } from '@/hooks/useKnowledgeDocuments'
import { SettingsProvider } from '@/hooks/useSettings'
import { LayoutProvider } from '@/hooks/useLayout'
import { APP_TAGLINE, APP_TITLE } from '@/lib/constants'
import '@/styles/globals.css'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: APP_TITLE },
      { name: 'description', content: `${APP_TAGLINE}，用自然语言探索数据库与知识。` },
    ],
    links: [
      { rel: 'icon', href: `${import.meta.env.BASE_URL}logo.svg`, type: 'image/svg+xml' },
    ],
  }),
  component: RootComponent,
})

function RootComponent() {
  return (
    <RootDocument>
      <SettingsProvider>
        <DatabaseProvider>
          <ChatProvider>
            <KnowledgeDocumentsProvider>
              <KnowledgeChatProvider>
                <LayoutProvider>
                  <Outlet />
                </LayoutProvider>
              </KnowledgeChatProvider>
            </KnowledgeDocumentsProvider>
          </ChatProvider>
        </DatabaseProvider>
      </SettingsProvider>
    </RootDocument>
  )
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <HeadContent />
      </head>
      <body className="h-dvh overflow-hidden bg-white text-gray-900 antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  )
}
