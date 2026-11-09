import { createFileRoute } from '@tanstack/react-router'
import { handleKnowledgeUpload } from '@/server/knowledge/upload-handler'

export const Route = createFileRoute('/knowledge-upload')({
  server: {
    handlers: {
      POST: ({ request }) => handleKnowledgeUpload(request),
    },
  },
})
