import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocalStorage } from './useLocalStorage'

/** Below this the sidebar becomes a drawer. */
export const MOBILE_QUERY = '(max-width: 767px)'
/** Below this side panels overlay the chat instead of squeezing it. */
export const NARROW_QUERY = '(max-width: 1099px)'

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false)
  useEffect(() => {
    const media = window.matchMedia(query)
    const update = () => setMatches(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [query])
  return matches
}

export function useViewportWidth(): number {
  const [width, setWidth] = useState(1280)
  useEffect(() => {
    const update = () => setWidth(window.innerWidth)
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return width
}

interface LayoutState {
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  /** Width the user dragged the data panel to; null until they resize it. */
  vizWidth: number | null
  setVizWidth: (width: number) => void
  contextWidth: number | null
  setContextWidth: (width: number) => void
}

const LayoutContext = createContext<LayoutState | null>(null)

/** Layout choices shared by both workspaces and remembered across reloads. */
export function LayoutProvider({ children }: { children: ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useLocalStorage('layout-sidebar-collapsed', false)
  const [vizWidth, setVizWidth] = useLocalStorage<number | null>('layout-viz-width', null)
  const [contextWidth, setContextWidth] = useLocalStorage<number | null>('layout-context-width', null)
  const toggleSidebar = useCallback(() => setSidebarCollapsed((collapsed) => !collapsed), [setSidebarCollapsed])

  const value = useMemo<LayoutState>(() => ({
    sidebarCollapsed, toggleSidebar, vizWidth, setVizWidth, contextWidth, setContextWidth,
  }), [sidebarCollapsed, toggleSidebar, vizWidth, setVizWidth, contextWidth, setContextWidth])

  return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>
}

export function useLayout(): LayoutState {
  const context = useContext(LayoutContext)
  if (!context) throw new Error('useLayout must be used within LayoutProvider')
  return context
}
