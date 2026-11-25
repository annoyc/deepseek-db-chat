import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocalStorage } from './useLocalStorage'
import {
  applyThemeToDocument,
  DEFAULT_THEME_ACCENT,
  DEFAULT_THEME_MODE,
  normalizeThemeAccent,
  normalizeThemeMode,
  parseStoredString,
  resolveThemeMode,
  THEME_ACCENT_STORAGE_KEY,
  THEME_MODE_STORAGE_KEY,
  type ResolvedThemeMode,
  type ThemeAccent,
  type ThemeMode,
} from '@/lib/theme'

export type { ResolvedThemeMode, ThemeAccent, ThemeMode }

interface ThemeContextValue {
  themeMode: ThemeMode
  resolvedTheme: ResolvedThemeMode
  themeAccent: ThemeAccent
  setThemeMode: (mode: ThemeMode) => void
  setThemeAccent: (accent: ThemeAccent) => void
  toggleThemeMode: () => void
}

const FALLBACK_THEME_VALUE: ThemeContextValue = {
  themeMode: DEFAULT_THEME_MODE,
  resolvedTheme: 'light',
  themeAccent: DEFAULT_THEME_ACCENT,
  setThemeMode: () => {},
  setThemeAccent: () => {},
  toggleThemeMode: () => {},
}

const ThemeContext = createContext<ThemeContextValue>(FALLBACK_THEME_VALUE)

function readLocalStorageTheme<T extends string>(
  key: string,
  normalizer: (val: unknown, fallback: T) => T,
  fallback: T,
): T {
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return fallback
    return normalizer(parseStoredString(raw), fallback)
  } catch {
    return fallback
  }
}

function mirrorThemeToLocalStorage(key: string, value: string): void {
  try {
    // Store as JSON string so useLocalStorage's migration JSON.parse() stays compatible.
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Ignore storage quota or privacy-mode errors.
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [storedMode, setStoredMode, , modeHydrated] = useLocalStorage<ThemeMode>(
    THEME_MODE_STORAGE_KEY,
    DEFAULT_THEME_MODE,
  )
  const [storedAccent, setStoredAccent, , accentHydrated] = useLocalStorage<ThemeAccent>(
    THEME_ACCENT_STORAGE_KEY,
    DEFAULT_THEME_ACCENT,
  )

  const [eagerMode, setEagerMode] = useState<ThemeMode | null>(null)
  const [eagerAccent, setEagerAccent] = useState<ThemeAccent | null>(null)
  const [systemPrefersDark, setSystemPrefersDark] = useState(false)

  // Read synchronous localStorage mirror immediately on mount before IndexedDB resolves.
  useEffect(() => {
    setEagerMode(readLocalStorageTheme(THEME_MODE_STORAGE_KEY, normalizeThemeMode, DEFAULT_THEME_MODE))
    setEagerAccent(readLocalStorageTheme(THEME_ACCENT_STORAGE_KEY, normalizeThemeAccent, DEFAULT_THEME_ACCENT))
  }, [])

  // Track OS dark mode preference live for `system` mode.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    setSystemPrefersDark(media.matches)
    const onChange = (event: MediaQueryListEvent) => setSystemPrefersDark(event.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const themeMode = modeHydrated
    ? normalizeThemeMode(storedMode)
    : (eagerMode ?? normalizeThemeMode(storedMode))
  const themeAccent = accentHydrated
    ? normalizeThemeAccent(storedAccent)
    : (eagerAccent ?? normalizeThemeAccent(storedAccent))

  const resolvedTheme = useMemo(
    () => resolveThemeMode(themeMode, systemPrefersDark),
    [themeMode, systemPrefersDark],
  )

  // Apply attributes to <html> and keep synchronous localStorage mirror updated.
  useEffect(() => {
    applyThemeToDocument(resolvedTheme, themeAccent)
  }, [resolvedTheme, themeAccent])

  useEffect(() => {
    if (!modeHydrated) return
    mirrorThemeToLocalStorage(THEME_MODE_STORAGE_KEY, themeMode)
  }, [modeHydrated, themeMode])

  useEffect(() => {
    if (!accentHydrated) return
    mirrorThemeToLocalStorage(THEME_ACCENT_STORAGE_KEY, themeAccent)
  }, [accentHydrated, themeAccent])

  const setThemeMode = useCallback((mode: ThemeMode) => {
    const next = normalizeThemeMode(mode)
    setEagerMode(next)
    mirrorThemeToLocalStorage(THEME_MODE_STORAGE_KEY, next)
    setStoredMode(next)
  }, [setStoredMode])

  const setThemeAccent = useCallback((accent: ThemeAccent) => {
    const next = normalizeThemeAccent(accent)
    setEagerAccent(next)
    mirrorThemeToLocalStorage(THEME_ACCENT_STORAGE_KEY, next)
    setStoredAccent(next)
  }, [setStoredAccent])

  const toggleThemeMode = useCallback(() => {
    setThemeMode(resolvedTheme === 'dark' ? 'light' : 'dark')
  }, [resolvedTheme, setThemeMode])

  const value = useMemo<ThemeContextValue>(() => ({
    themeMode,
    resolvedTheme,
    themeAccent,
    setThemeMode,
    setThemeAccent,
    toggleThemeMode,
  }), [themeMode, resolvedTheme, themeAccent, setThemeMode, setThemeAccent, toggleThemeMode])

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext)
}
