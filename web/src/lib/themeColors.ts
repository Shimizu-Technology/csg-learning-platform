/// <reference lib="dom" />
/*
 * Theme colours for the browser chrome, without React, so brand.ts (also
 * bundled into the Vite config and Netlify scripts) can use them.
 */

export type ResolvedTheme = 'light' | 'dark'

/**
 * Browser chrome per surface and theme (meta theme-color): the app header is
 * surface-raised, the public pages are the CSG site cream. Values mirror
 * index.css (asserted in theme.test.ts).
 */
export const THEME_COLORS = {
  app: { light: '#ffffff', dark: '#151a22' },
  public: { light: '#faf7f0', dark: '#11100d' },
} as const

/** The resolved theme currently on <html>. */
export function currentTheme(doc: Document = document): ResolvedTheme {
  return doc.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

export function ensureMeta(doc: Document, name: string) {
  let meta = doc.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)
  if (!meta) {
    meta = doc.createElement('meta')
    meta.name = name
    doc.head.appendChild(meta)
  }
  return meta
}

/** Status-bar colour for the current surface (data-surface) and theme. */
export function applyThemeColor(doc: Document = document) {
  const surface = doc.documentElement.dataset.surface === 'public' ? 'public' : 'app'
  ensureMeta(doc, 'theme-color').content = THEME_COLORS[surface][currentTheme(doc)]
}

