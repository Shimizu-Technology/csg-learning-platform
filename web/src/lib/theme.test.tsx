// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderBrandTemplate } from '../../brand-build'
import { createBrand } from './brand'
import { applySurface } from './brand'
import { ThemeChoice } from '../components/shared/ThemeChoice'
import {
  initTheme, MONACO_COLORS, readThemePreference, resetThemeForTests, resolveTheme, setThemePreference,
  THEME_COLORS, THEME_STORAGE_KEY, useTheme,
} from './theme'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const indexHtml = renderBrandTemplate(readFileSync(resolve(__dirname, '../../index.html'), 'utf8'), createBrand())
const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8')

function cssVar(name: string, theme: 'light' | 'dark') {
  const selector = theme === 'light' ? /^:root\s*\{/m : /^:root\[data-theme="dark"\]\s*\{/m
  const start = css.search(selector)
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
  return body.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim()
}

/** A controllable prefers-color-scheme media query. */
function stubSystemTheme(dark: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  const query = {
    matches: dark,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
  }
  vi.stubGlobal('matchMedia', vi.fn((media: string) => (media === query.media ? query : { matches: false, media, addEventListener() {}, removeEventListener() {} })))
  return {
    set(nextDark: boolean) {
      query.matches = nextDark
      listeners.forEach((listener) => listener({ matches: nextDark } as MediaQueryListEvent))
    },
  }
}

const html = document.documentElement
const themeColor = () => document.querySelector('meta[name="theme-color"]')?.getAttribute('content')

beforeEach(() => {
  resetThemeForTests()
  window.localStorage.clear()
  delete html.dataset.theme
  delete html.dataset.surface
  html.removeAttribute('style')
  document.head.innerHTML = ''
})

afterEach(() => {
  resetThemeForTests()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('theme preference', () => {
  it('defaults to System, which follows the OS', () => {
    stubSystemTheme(true)
    expect(readThemePreference()).toBe('system')
    initTheme()
    expect(html.dataset.theme).toBe('dark')
    expect(html.style.colorScheme).toBe('dark')
    expect(document.querySelector('meta[name="color-scheme"]')?.getAttribute('content')).toBe('dark')
  })

  it('ignores unknown stored values', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'sepia')
    expect(readThemePreference()).toBe('system')
  })

  it('toggles, persists across a reload, and forgets the key for System', () => {
    stubSystemTheme(false)
    initTheme()
    expect(html.dataset.theme).toBe('light')

    setThemePreference('dark')
    expect(html.dataset.theme).toBe('dark')
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')

    // A reload reads the saved choice.
    resetThemeForTests()
    delete html.dataset.theme
    initTheme()
    expect(html.dataset.theme).toBe('dark')

    setThemePreference('light')
    expect(html.dataset.theme).toBe('light')
    setThemePreference('system')
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
    expect(html.dataset.theme).toBe('light')
  })

  it('still switches when storage is unavailable', () => {
    stubSystemTheme(false)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(readThemePreference()).toBe('system')
    initTheme()
    setThemePreference('dark')
    expect(html.dataset.theme).toBe('dark')
  })

  it('follows prefers-color-scheme changes while on System, and not after a manual choice', () => {
    const system = stubSystemTheme(false)
    initTheme()
    expect(html.dataset.theme).toBe('light')
    system.set(true)
    expect(html.dataset.theme).toBe('dark')
    system.set(false)
    expect(html.dataset.theme).toBe('light')

    setThemePreference('dark')
    system.set(false)
    expect(html.dataset.theme).toBe('dark')
  })

  it('picks up a choice made in another tab', () => {
    stubSystemTheme(false)
    initTheme()
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY }))
    expect(html.dataset.theme).toBe('dark')
  })

  it('resolves explicit choices regardless of the OS', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
    expect(resolveTheme('system', true)).toBe('dark')
  })
})

describe('browser chrome', () => {
  it('sets the status-bar colour for each surface and theme', () => {
    stubSystemTheme(false)
    applySurface('/dashboard')
    initTheme()
    expect(themeColor()).toBe(THEME_COLORS.app.light)
    setThemePreference('dark')
    expect(themeColor()).toBe(THEME_COLORS.app.dark)
    applySurface('/sign-in')
    expect(themeColor()).toBe(THEME_COLORS.public.dark)
    setThemePreference('light')
    expect(themeColor()).toBe(THEME_COLORS.public.light)
  })

  it('uses the header surface (app) and the site cream (public) from index.css', () => {
    for (const theme of ['light', 'dark'] as const) {
      expect(THEME_COLORS.app[theme]).toBe(cssVar('csg-surface-raised', theme))
      expect(THEME_COLORS.public[theme]).toBe(cssVar('csg-brand-cream', theme))
    }
  })

  it('gives Monaco the code token colours', () => {
    for (const theme of ['light', 'dark'] as const) {
      const c = MONACO_COLORS[theme]
      expect(c.background).toBe(cssVar('csg-code-bg', theme))
      expect(c.foreground).toBe(cssVar('csg-code-ink', theme))
      expect(c.lineNumber).toBe(cssVar('csg-code-gutter', theme))
      expect(c.keyword).toBe(cssVar('csg-syntax-keyword', theme))
      expect(c.string).toBe(cssVar('csg-syntax-string', theme))
      expect(c.number).toBe(cssVar('csg-syntax-number', theme))
      expect(c.comment).toBe(cssVar('csg-syntax-comment', theme))
      expect(c.type).toBe(cssVar('csg-syntax-type', theme))
      expect(c.function).toBe(cssVar('csg-syntax-function', theme))
    }
  })
})

describe('index.html boot script (no flash)', () => {
  const script = indexHtml.match(/<script>\s*(\(function \(\) \{[\s\S]*?PUBLIC_SURFACE[\s\S]*?\}\)\(\);)\s*<\/script>/)?.[1] || ''

  function boot(path: string) {
    document.head.innerHTML = '<meta name="color-scheme" content="light dark"><meta name="theme-color" content="#ffffff">'
    window.history.replaceState(null, '', path)
    new Function(script)()
  }

  it('runs in the head, before the app bundle', () => {
    expect(script).toBeTruthy()
    expect(indexHtml.indexOf(script)).toBeLessThan(indexHtml.indexOf('<body>'))
    expect(indexHtml.indexOf(script)).toBeLessThan(indexHtml.indexOf('src="/src/main.tsx"'))
    expect(script).toContain(`'${THEME_STORAGE_KEY}'`)
  })

  it.each([
    ['nothing saved, light OS', null, false, '/dashboard', 'light', THEME_COLORS.app.light],
    ['nothing saved, dark OS', null, true, '/dashboard', 'dark', THEME_COLORS.app.dark],
    ['Dark saved, light OS', 'dark', false, '/dashboard', 'dark', THEME_COLORS.app.dark],
    ['Light saved, dark OS', 'light', true, '/dashboard', 'light', THEME_COLORS.app.light],
    ['public page, dark OS', null, true, '/sign-in', 'dark', THEME_COLORS.public.dark],
    ['public page, light', 'light', false, '/', 'light', THEME_COLORS.public.light],
  ])('%s', (_, stored, systemDark, path, theme, color) => {
    stubSystemTheme(systemDark)
    if (stored) window.localStorage.setItem(THEME_STORAGE_KEY, stored)
    boot(path)
    expect(html.dataset.theme).toBe(theme)
    expect(html.style.colorScheme).toBe(theme)
    expect(document.querySelector('meta[name="color-scheme"]')?.getAttribute('content')).toBe(theme)
    expect(themeColor()).toBe(color)
    // The app then takes over with the same answer.
    initTheme()
    expect(html.dataset.theme).toBe(theme)
    expect(themeColor()).toBe(color)
  })

  it('falls back to light when storage and matchMedia are unavailable', () => {
    vi.stubGlobal('matchMedia', undefined)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    boot('/dashboard')
    expect(html.dataset.theme).toBe('light')
  })

  it('keeps the CSS-only fallback for a first paint without JavaScript', () => {
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)/)
  })
})

describe('ThemeChoice', () => {
  it('shows the current choice and switches on click', async () => {
    stubSystemTheme(false)
    initTheme()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => root.render(<ThemeChoice />))
    const group = container.querySelector('[role="group"]')!
    expect(group.getAttribute('aria-label')).toBe('Theme')
    const buttons = Array.from(container.querySelectorAll('button'))
    expect(buttons.map((button) => button.textContent)).toEqual(['Light', 'Dark', 'System'])
    expect(buttons.map((button) => button.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true'])
    await act(async () => buttons[1].click())
    expect(html.dataset.theme).toBe('dark')
    expect(buttons.map((button) => button.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false'])
    act(() => root.unmount())
    container.remove()
  })

  it('re-renders subscribers when the OS changes', async () => {
    const system = stubSystemTheme(false)
    initTheme()
    const seen: string[] = []
    function Probe() {
      const { theme } = useTheme()
      seen.push(theme)
      return null
    }
    const container = document.createElement('div')
    const root = createRoot(container)
    await act(async () => root.render(<Probe />))
    await act(async () => system.set(true))
    expect(seen.at(-1)).toBe('dark')
    act(() => root.unmount())
  })
})
