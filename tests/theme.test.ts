import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  THEME_ACCENTS,
  THEME_ACCENT_STORAGE_KEY,
  THEME_MODE_STORAGE_KEY,
  applyThemeToDocument,
  buildThemeInitScript,
  normalizeThemeAccent,
  normalizeThemeMode,
  parseStoredString,
  resolveThemeMode,
} from '../src/lib/theme'
import { BrandLogo } from '../src/components/layout/BrandLogo'
import { ThemeToggleButton } from '../src/components/layout/ThemeToggleButton'

test('theme mode and accent normalizers fall back safely on invalid inputs', () => {
  assert.equal(normalizeThemeMode('light'), 'light')
  assert.equal(normalizeThemeMode('dark'), 'dark')
  assert.equal(normalizeThemeMode('system'), 'system')
  assert.equal(normalizeThemeMode('sepia'), 'system')
  assert.equal(normalizeThemeMode(null), 'system')

  for (const accent of THEME_ACCENTS) {
    assert.equal(normalizeThemeAccent(accent.id), accent.id)
    assert.match(accent.swatch, /^#[0-9a-fA-F]{6}$/)
  }
  assert.equal(THEME_ACCENTS.length, 6)
  assert.equal(normalizeThemeAccent('rainbow'), 'teal')
  assert.equal(normalizeThemeAccent(undefined), 'teal')
})

test('resolveThemeMode maps system preference and preserves explicit modes', () => {
  assert.equal(resolveThemeMode('light', true), 'light')
  assert.equal(resolveThemeMode('dark', false), 'dark')
  assert.equal(resolveThemeMode('system', true), 'dark')
  assert.equal(resolveThemeMode('system', false), 'light')
})

test('parseStoredString handles JSON-serialized values, plain strings, and malformed values', () => {
  assert.equal(parseStoredString('"dark"'), 'dark')
  assert.equal(parseStoredString('dark'), 'dark')
  assert.equal(parseStoredString(''), null)
  assert.equal(parseStoredString(null), null)
  assert.equal(parseStoredString('"unclosed'), '"unclosed')
})

test('applyThemeToDocument sets dataset attributes and colorScheme', () => {
  const doc = {
    documentElement: {
      dataset: {} as Record<string, string>,
      style: { colorScheme: '' },
    },
  } as unknown as Document

  applyThemeToDocument('dark', 'violet', doc)
  assert.equal(doc.documentElement.dataset.theme, 'dark')
  assert.equal(doc.documentElement.dataset.accent, 'violet')
  assert.equal(doc.documentElement.style.colorScheme, 'dark')
})

function runInitScript(opts: {
  storage?: Record<string, string>
  throwsOnStorage?: boolean
  prefersDark?: boolean
}) {
  const el = {
    dataset: {} as Record<string, string>,
    style: { colorScheme: '' },
  }
  const fakeWindow = {
    localStorage: {
      getItem(key: string) {
        if (opts.throwsOnStorage) throw new Error('SecurityError')
        return opts.storage?.[key] ?? null
      },
    },
    matchMedia(query: string) {
      assert.equal(query, '(prefers-color-scheme: dark)')
      return { matches: Boolean(opts.prefersDark) }
    },
  }
  const fakeDocument = { documentElement: el }
  const fn = new Function('window', 'document', buildThemeInitScript())
  fn(fakeWindow, fakeDocument)
  return el
}

test('buildThemeInitScript resolves system mode, JSON-stored overrides, and corrupted storage without throwing', () => {
  // Default system + dark OS -> dark + teal
  const sysDark = runInitScript({ prefersDark: true })
  assert.equal(sysDark.dataset.theme, 'dark')
  assert.equal(sysDark.dataset.accent, 'teal')
  assert.equal(sysDark.style.colorScheme, 'dark')

  // Explicit JSON-serialized "light" overrides dark OS
  const explicitLight = runInitScript({
    prefersDark: true,
    storage: {
      [THEME_MODE_STORAGE_KEY]: JSON.stringify('light'),
      [THEME_ACCENT_STORAGE_KEY]: JSON.stringify('ocean'),
    },
  })
  assert.equal(explicitLight.dataset.theme, 'light')
  assert.equal(explicitLight.dataset.accent, 'ocean')
  assert.equal(explicitLight.style.colorScheme, 'light')

  // Plain string "dark" + "violet"
  const explicitDark = runInitScript({
    prefersDark: false,
    storage: {
      [THEME_MODE_STORAGE_KEY]: 'dark',
      [THEME_ACCENT_STORAGE_KEY]: 'violet',
    },
  })
  assert.equal(explicitDark.dataset.theme, 'dark')
  assert.equal(explicitDark.dataset.accent, 'violet')
  assert.equal(explicitDark.style.colorScheme, 'dark')

  // Corrupted storage falls back cleanly
  const corrupted = runInitScript({
    prefersDark: false,
    storage: {
      [THEME_MODE_STORAGE_KEY]: 'invalid-mode',
      [THEME_ACCENT_STORAGE_KEY]: 'invalid-accent',
    },
  })
  assert.equal(corrupted.dataset.theme, 'light')
  assert.equal(corrupted.dataset.accent, 'teal')

  // Throwing localStorage falls back cleanly
  const blocked = runInitScript({ throwsOnStorage: true, prefersDark: true })
  assert.equal(blocked.dataset.theme, 'dark')
  assert.equal(blocked.dataset.accent, 'teal')
})

test('BrandLogo and ThemeToggleButton render safely during SSR without providers', () => {
  const logoMarkup = renderToStaticMarkup(createElement(BrandLogo, { title: '数问' }))
  assert.ok(logoMarkup.includes('var(--logo-stop-1)'))
  assert.ok(logoMarkup.includes('<title>数问</title>'))

  const toggleMarkup = renderToStaticMarkup(createElement(ThemeToggleButton))
  assert.ok(toggleMarkup.includes('切换到深色模式'))
  assert.ok(toggleMarkup.includes('dark:block'))
  assert.ok(toggleMarkup.includes('dark:hidden'))
})
