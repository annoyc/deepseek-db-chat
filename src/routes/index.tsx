import { createFileRoute, redirect } from '@tanstack/react-router'

// Redirect while routing, so the workbench renders directly instead of after a blank frame.
export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({ to: '/dbpilot', replace: true })
  },
})
