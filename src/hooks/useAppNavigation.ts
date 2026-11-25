import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useRouter } from '@tanstack/react-router'
import type { AppMode } from '@/components/layout/AppModeSwitch'

const ROUTE_TRANSITION_TIMEOUT_MS = 2500

function routePathForApp(app: AppMode): '/dbpilot' | '/knowledge' {
  return app === 'knowledge' ? '/knowledge' : '/dbpilot'
}

function browserHrefForApp(app: AppMode): string {
  const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`
  return `${base}${app === 'knowledge' ? 'knowledge' : 'dbpilot'}`
}

/**
 * Handles switching between the database and knowledge workbench routes:
 * preloads the sibling route chunk, updates the active tab immediately, and
 * falls back to a full navigation if a stale client bundle stalls transition.
 */
export function useAppNavigation(activeApp: AppMode) {
  const router = useRouter()
  const navigate = useNavigate()
  const [pendingApp, setPendingApp] = useState<AppMode | null>(null)
  const fallbackTimerRef = useRef<number | null>(null)

  const clearFallbackTimer = useCallback(() => {
    if (fallbackTimerRef.current !== null) {
      window.clearTimeout(fallbackTimerRef.current)
      fallbackTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (pendingApp === activeApp) {
      setPendingApp(null)
    }
  }, [activeApp, pendingApp])

  useEffect(() => {
    const siblingApp: AppMode = activeApp === 'database' ? 'knowledge' : 'database'
    const timer = window.setTimeout(() => {
      void router.preloadRoute({ to: routePathForApp(siblingApp) }).catch(() => {})
    }, 80)
    return () => {
      window.clearTimeout(timer)
      clearFallbackTimer()
    }
  }, [activeApp, router, clearFallbackTimer])

  const preloadApp = useCallback((app: AppMode) => {
    if (app === activeApp) return
    void router.preloadRoute({ to: routePathForApp(app) }).catch(() => {})
  }, [activeApp, router])

  const handleAppChange = useCallback((app: AppMode) => {
    if (app === activeApp) return
    setPendingApp(app)
    clearFallbackTimer()

    const target = routePathForApp(app)
    const fallbackHref = browserHrefForApp(app)
    fallbackTimerRef.current = window.setTimeout(() => {
      window.location.assign(fallbackHref)
    }, ROUTE_TRANSITION_TIMEOUT_MS)

    void navigate({ to: target }).catch(() => {
      clearFallbackTimer()
      window.location.assign(fallbackHref)
    })
  }, [activeApp, navigate, clearFallbackTimer])

  return {
    pendingApp,
    preloadApp,
    handleAppChange,
  }
}
