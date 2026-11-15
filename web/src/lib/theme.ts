import { useSyncExternalStore } from 'react'
import { applyThemeColor, ensureMeta, type ResolvedTheme } from './themeColors'

export { THEME_COLORS, applyThemeColor, currentTheme, type ResolvedTheme } from './themeColors'

/*
 * Light / Dark / System (U-6.1, design spec §7). The choice is per device:
 * stored in localStorage (when it is available) and applied as
 * <html data-theme="light|dark">. index.html runs the same resolution before
 * the bundle loads, so the first paint is already in the right theme; this
 * module keeps it in step afterwards and follows the OS setting while the
 * choice is System.
 */

export type ThemePreference = 'system' | 'light' | 'dark'

/** Read by the index.html boot script too; keep the two in step (theme.test.ts). */
export const THEME_STORAGE_KEY = 'csg-learn:theme'
export const THEME_PREFERENCES: readonly ThemePreference[] = ['light', 'dark', 'system']

const DARK_QUERY = '(prefers-color-scheme: dark)'

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark'
}

export function readThemePreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  } catch {
    return 'system'
  }
}

function writeThemePreference(preference: ThemePreference) {
  try {
    if (preference === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY)
    else window.localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // Private mode or blocked storage: the choice lasts for this page only.
  }
}

function darkQuery(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(DARK_QUERY) : null
}

export function resolveTheme(preference: ThemePreference, systemDark = Boolean(darkQuery()?.matches)): ResolvedTheme {
  if (preference === 'system') return systemDark ? 'dark' : 'light'
  return preference
}

export function applyTheme(theme: ResolvedTheme, doc: Document = document) {
  const root = doc.documentElement
  root.dataset.theme = theme
  root.style.colorScheme = theme
  ensureMeta(doc, 'color-scheme').content = theme
  applyThemeColor(doc)
}

// ---------- Store ----------

type Snapshot = { preference: ThemePreference; theme: ResolvedTheme }

let snapshot: Snapshot | null = null
const listeners = new Set<() => void>()
let detach: (() => void) | null = null

function compute(preference: ThemePreference): Snapshot {
  return { preference, theme: resolveTheme(preference) }
}

function update(next: Snapshot) {
  const changed = !snapshot || snapshot.preference !== next.preference || snapshot.theme !== next.theme
  snapshot = next
  applyTheme(next.theme)
  if (changed) listeners.forEach((listener) => listener())
}

function getSnapshot(): Snapshot {
  if (!snapshot) snapshot = compute(readThemePreference())
  return snapshot
}

function attach() {
  if (detach || typeof window === 'undefined') return
  const query = darkQuery()
  // Follow the OS while the choice is System.
  const onSystemChange = () => { if (getSnapshot().preference === 'system') update(compute('system')) }
  // Another tab changed the choice.
  const onStorage = (event: StorageEvent) => { if (event.key === null || event.key === THEME_STORAGE_KEY) update(compute(readThemePreference())) }
  query?.addEventListener?.('change', onSystemChange)
  window.addEventListener('storage', onStorage)
  detach = () => {
    query?.removeEventListener?.('change', onSystemChange)
    window.removeEventListener('storage', onStorage)
    detach = null
  }
}

/** Start following the stored choice and the OS setting. Called once from main.tsx. */
export function initTheme() {
  update(compute(readThemePreference()))
  attach()
}

export function setThemePreference(preference: ThemePreference) {
  writeThemePreference(preference)
  update(compute(preference))
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  attach()
  return () => { listeners.delete(listener) }
}

export function useTheme() {
  const { preference, theme } = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return { preference, theme, setPreference: setThemePreference }
}

/** Test helper: forget the cached snapshot and listeners. */
export function resetThemeForTests() {
  detach?.()
  snapshot = null
  listeners.clear()
}
