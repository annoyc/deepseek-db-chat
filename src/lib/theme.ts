export type ThemeMode = 'light' | 'dark' | 'system'
export type ResolvedThemeMode = 'light' | 'dark'
export type ThemeAccent = 'teal' | 'indigo' | 'ocean' | 'emerald' | 'terracotta' | 'violet'

export const DEFAULT_THEME_MODE: ThemeMode = 'system'
export const DEFAULT_THEME_ACCENT: ThemeAccent = 'teal'
export const THEME_MODE_STORAGE_KEY = 'theme-mode'
export const THEME_ACCENT_STORAGE_KEY = 'theme-accent'

export interface ThemeAccentOption {
  id: ThemeAccent
  label: string
  swatch: string
  description: string
}

export const THEME_ACCENTS: readonly ThemeAccentOption[] = [
  { id: 'teal', label: '松石青', swatch: '#0f766e', description: '默认青绿' },
  { id: 'indigo', label: '靛青蓝', swatch: '#4338ca', description: '沉稳科技' },
  { id: 'ocean', label: '晴空蓝', swatch: '#0369a1', description: '清爽理性' },
  { id: 'emerald', label: '森屿绿', swatch: '#15803d', description: '自然护眼' },
  { id: 'terracotta', label: '赤陶棕', swatch: '#9a4a24', description: '温润纸感' },
  { id: 'violet', label: '暮山紫', swatch: '#6d28d9', description: '雅致现代' },
] as const

const VALID_MODES = new Set<string>(['light', 'dark', 'system'])
const VALID_ACCENTS = new Set<string>(THEME_ACCENTS.map((item) => item.id))

export function normalizeThemeMode(value: unknown, fallback: ThemeMode = DEFAULT_THEME_MODE): ThemeMode {
  return typeof value === 'string' && VALID_MODES.has(value) ? (value as ThemeMode) : fallback
}

export function normalizeThemeAccent(value: unknown, fallback: ThemeAccent = DEFAULT_THEME_ACCENT): ThemeAccent {
  return typeof value === 'string' && VALID_ACCENTS.has(value) ? (value as ThemeAccent) : fallback
}

export function resolveThemeMode(mode: ThemeMode, prefersDark: boolean): ResolvedThemeMode {
  if (mode === 'light' || mode === 'dark') return mode
  return prefersDark ? 'dark' : 'light'
}

/** Parses either JSON-serialized strings (`"dark"`) or plain strings (`dark`) without throwing. */
export function parseStoredString(raw: string | null): unknown {
  if (raw === null) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('"') || trimmed === 'null' || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return trimmed
    }
  }
  return trimmed
}

export function applyThemeToDocument(
  resolved: ResolvedThemeMode,
  accent: ThemeAccent,
  doc: Document | undefined = typeof document !== 'undefined' ? document : undefined,
): void {
  if (!doc?.documentElement) return
  const el = doc.documentElement
  el.dataset.theme = resolved
  el.dataset.accent = accent
  el.style.colorScheme = resolved
}

/**
 * Generates an inline blocking `<head>` script that sets `data-theme`, `data-accent`,
 * and `colorScheme` on `<html>` before first paint to prevent SSR FOUC.
 */
export function buildThemeInitScript(): string {
  const accentIds = JSON.stringify(THEME_ACCENTS.map((item) => item.id))
  return `(() => {
  try {
    const parse = (raw) => {
      if (!raw) return null;
      const t = raw.trim();
      if (!t) return null;
      if (t[0] === '"') {
        try { return JSON.parse(t); } catch { return t; }
      }
      return t;
    };
    const modes = { light: 1, dark: 1, system: 1 };
    const accents = ${accentIds};
    let rawMode = null;
    let rawAccent = null;
    try {
      rawMode = parse(window.localStorage.getItem(${JSON.stringify(THEME_MODE_STORAGE_KEY)}));
      rawAccent = parse(window.localStorage.getItem(${JSON.stringify(THEME_ACCENT_STORAGE_KEY)}));
    } catch {}
    const mode = typeof rawMode === 'string' && modes[rawMode] ? rawMode : ${JSON.stringify(DEFAULT_THEME_MODE)};
    const accent = typeof rawAccent === 'string' && accents.indexOf(rawAccent) !== -1 ? rawAccent : ${JSON.stringify(DEFAULT_THEME_ACCENT)};
    const prefersDark = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const resolved = mode === 'system' ? (prefersDark ? 'dark' : 'light') : mode;
    const el = document.documentElement;
    el.dataset.theme = resolved;
    el.dataset.accent = accent;
    el.style.colorScheme = resolved;
  } catch {}
})();`
}
