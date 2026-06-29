import { useEffect } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: WorkbenchIndexRedirect,
})

function WorkbenchIndexRedirect() {
  const navigate = useNavigate()

  useEffect(() => {
    navigate({ to: '/dbpilot', replace: true })
  }, [navigate])

  return null
}
