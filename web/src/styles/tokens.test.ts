import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8')

type Theme = 'light' | 'dark'

function declarations(block: string) {
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]))
}

/** The body of the first rule whose selector line matches. */
function ruleBody(selector: RegExp) {
  const start = css.search(selector)
  if (start < 0) throw new Error(`Missing rule ${selector}`)
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  return css.slice(open + 1, close)
}

const themeInline = declarations(ruleBody(/@theme inline\s*\{/))
const staticTheme = declarations(ruleBody(/@theme\s*\{/))
const lightVars = declarations(ruleBody(/^:root\s*\{/m))
const darkVars = declarations(ruleBody(/^:root\[data-theme="dark"\]\s*\{/m))
const systemDarkVars = declarations(ruleBody(/:root:not\(\[data-theme="light"\]\)\s*\{/))

/** Resolve `color-*` (a Tailwind role) or `csg-*` to a hex value in a theme. */
export function token(name: string, theme: Theme = 'light', seen = new Set<string>()): string {
  if (seen.has(name)) throw new Error(`Circular token ${name}`)
  seen.add(name)
  const value = theme === 'dark' && name in darkVars ? darkVars[name] : lightVars[name] ?? themeInline[name] ?? staticTheme[name]
  if (!value) throw new Error(`Missing token --${name}`)
  const alias = value.match(/^var\(--([\w-]+)\)$/)
  return alias ? token(alias[1], theme, seen) : value
}

function luminance(hex: string) {
  const clean = hex.replace('#', '')
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// [foreground role, background role, minimum ratio], checked in both themes.
const TEXT_PAIRS: Array<[string, string, number]> = [
  // Primary action (normal text: 4.5) in every interaction state
  ['color-on-action', 'color-action-primary', 4.5],
  ['color-on-action', 'color-action-primary-hover', 4.5],
  ['color-on-action', 'color-action-primary-pressed', 4.5],
  // Ruby as text and soft fills
  ['color-primary-ink', 'color-surface-raised', 4.5],
  ['color-primary-ink', 'color-surface-page', 4.5],
  ['color-primary-soft-ink', 'color-primary-soft', 4.5],
  ['color-primary-ink', 'color-primary-soft', 4.5],
  ['color-ink-secondary', 'color-surface-selected', 4.5],
  // Status badges and cards, and status text on cards
  ['color-danger-ink', 'color-danger-soft', 4.5],
  ['color-warning-ink', 'color-warning-soft', 4.5],
  ['color-success-ink', 'color-success-soft', 4.5],
  ['color-info-ink', 'color-info-soft', 4.5],
  ['color-danger-ink', 'color-surface-raised', 4.5],
  ['color-warning-ink', 'color-surface-raised', 4.5],
  ['color-success-ink', 'color-surface-raised', 4.5],
  ['color-info-ink', 'color-surface-raised', 4.5],
  ['color-ink', 'color-warning-soft', 4.5],
  ['color-ink-secondary', 'color-danger-soft', 4.5],
  ['color-ink-secondary', 'color-warning-soft', 4.5],
  // Code blocks: text, header label, line numbers and every syntax color (spec §7: syntax ≥ 5:1)
  ['color-code-ink', 'color-code-bg', 4.5],
  ['color-ink', 'color-code-inline-bg', 4.5],
  ['color-ink-muted', 'color-code-header', 4.5],
  ['color-code-gutter', 'color-code-bg', 4.5],
  ['color-syntax-keyword', 'color-code-bg', 5],
  ['color-syntax-string', 'color-code-bg', 5],
  ['color-syntax-number', 'color-code-bg', 5],
  ['color-syntax-function', 'color-code-bg', 5],
  ['color-syntax-comment', 'color-code-bg', 5],
  ['color-syntax-type', 'color-code-bg', 5],
  // Text tiers on raised, page, sunken, overlay and hover surfaces
  ['color-ink', 'color-surface-raised', 4.5],
  ['color-ink-secondary', 'color-surface-raised', 4.5],
  ['color-ink-muted', 'color-surface-raised', 4.5],
  ['color-ink', 'color-surface-page', 4.5],
  ['color-ink-secondary', 'color-surface-page', 4.5],
  ['color-ink-muted', 'color-surface-page', 4.5],
  ['color-ink-secondary', 'color-surface-sunken', 4.5],
  ['color-ink-muted', 'color-surface-sunken', 4.5],
  ['color-ink-muted', 'color-surface-overlay', 4.5],
  ['color-ink-muted', 'color-surface-hover', 4.5],
  ['color-ink-secondary', 'color-line', 4.5],
  // Public and sign-in surfaces (CSG site cream)
  ['color-ink', 'color-brand-cream', 4.5],
  ['color-ink-secondary', 'color-brand-cream', 4.5],
  ['color-ink-muted', 'color-brand-cream', 4.5],
  ['color-primary-ink', 'color-brand-cream', 4.5],
  ['color-ink-secondary', 'color-brand-cream-sunken', 4.5],
  // Inverse surface (tooltips) and media overlays
  ['color-ink-on-inverse', 'color-surface-inverse', 4.5],
  ['color-on-media', 'color-media', 4.5],
]

// Non-text UI (focus indicator, control borders, icons on solid fills):
// WCAG 1.4.11 needs 3:1. The ring sits 2px outside the control, so it is
// measured against the surrounding surface.
const UI_PAIRS: Array<[string, string, number]> = [
  ['color-focus', 'color-surface-raised', 3],
  ['color-focus', 'color-surface-page', 3],
  ['color-focus', 'color-surface-sunken', 3],
  ['color-focus', 'color-brand-cream', 3],
  ['color-line-control', 'color-surface-raised', 3],
  ['color-action-primary', 'color-surface-raised', 3],
  ['color-on-solid', 'color-success-solid', 3],
  ['color-on-solid', 'color-danger-solid', 3],
]

const THEMES: Theme[] = ['light', 'dark']

describe.each(THEMES)('design tokens (%s)', (theme) => {
  it.each(TEXT_PAIRS)('text %s on %s meets %s:1', (fg, bg, min) => {
    expect(contrast(token(fg, theme), token(bg, theme))).toBeGreaterThanOrEqual(min)
  })

  it.each(UI_PAIRS)('ui %s on %s meets %s:1', (fg, bg, min) => {
    expect(contrast(token(fg, theme), token(bg, theme))).toBeGreaterThanOrEqual(min)
  })

  it('focus ring differs from brand and danger', () => {
    const focus = token('color-focus', theme).toLowerCase()
    expect(focus).not.toBe(token('color-action-primary', theme).toLowerCase())
    expect(focus).not.toBe(token('color-danger-ink', theme).toLowerCase())
  })
})

describe('design tokens', () => {
  it('defines every role in both themes, and the system and manual dark blocks are identical', () => {
    expect(Object.keys(darkVars).sort()).toEqual(Object.keys(lightVars).filter((name) => name.startsWith('csg-')).sort())
    expect(systemDarkVars).toEqual(darkVars)
  })

  it('points every colour role at a theme variable', () => {
    for (const [name, value] of Object.entries(themeInline)) {
      expect(value, name).toMatch(/^var\(--csg-[\w-]+\)$/)
      expect(lightVars, name).toHaveProperty(value.slice(6, -1))
    }
  })

  it('matches the approved spec values (docs/design/2026-11-platform-redesign/assets/tokens.css)', () => {
    const spec = readFileSync(resolve(__dirname, '../../../docs/design/2026-11-platform-redesign/assets/tokens.css'), 'utf8')
    const specLight = declarations(spec.slice(spec.indexOf(':root {'), spec.indexOf('}', spec.indexOf(':root {'))))
    const specDark = declarations(spec.slice(spec.indexOf(':root[data-theme="dark"]')))
    // Deliberate differences: the line-number gutter is darkened so numbers pass 4.5:1.
    const differs = new Set(['csg-code-gutter'])
    for (const [name, value] of Object.entries(specLight)) {
      if (name.startsWith('csg-') && !differs.has(name)) expect(lightVars[name], `light ${name}`).toBe(value)
    }
    for (const [name, value] of Object.entries(specDark)) {
      if (name.startsWith('csg-') && !differs.has(name)) expect(darkVars[name], `dark ${name}`).toBe(value)
    }
  })

  it('keeps the brand action on the CSG family ruby values', () => {
    expect(token('color-action-primary').toLowerCase()).toBe('#9c292b')
    expect(token('color-action-primary-hover').toLowerCase()).toBe('#842225')
    expect(token('color-action-primary-pressed').toLowerCase()).toBe('#6f1c1f')
  })

  it('uses the one global focus ring', () => {
    expect(token('color-focus').toLowerCase()).toBe('#1d4ed8')
    expect(token('color-focus', 'dark').toLowerCase()).toBe('#6ea8ff')
    expect(css).toMatch(/:focus-visible\s*\{\s*outline:\s*2px solid var\(--focus-ring\);/)
    expect(css).toMatch(/--focus-ring:\s*var\(--color-focus\)/)
  })

  it('hover darkens the primary action in light and lightens it in dark', () => {
    expect(luminance(token('color-action-primary-hover'))).toBeLessThan(luminance(token('color-action-primary')))
    expect(luminance(token('color-action-primary-pressed'))).toBeLessThan(luminance(token('color-action-primary-hover')))
    expect(luminance(token('color-action-primary-hover', 'dark'))).toBeGreaterThan(luminance(token('color-action-primary', 'dark')))
  })

  it('has a dark variant keyed to data-theme', () => {
    expect(css).toContain('@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));')
  })
})

describe('motion rules', () => {
  const reducedBlocks = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n')

  it('slides the sheet on the drawer curve for 240ms', () => {
    expect(css).toMatch(/--duration-panel:\s*240ms/)
    expect(css).toMatch(/\.app-modal\s*\{\s*animation:\s*sheet-enter var\(--duration-panel\) var\(--ease-drawer\)/)
  })

  it('falls back to an opacity-only fade for the sheet under reduced motion', () => {
    expect(reducedBlocks).toMatch(/\.app-modal\.app-modal[\s\S]*animation-name:\s*overlay-enter !important/)
    const overlayKeyframes = css.match(/@keyframes overlay-enter\s*\{([\s\S]*?)\n\}/)?.[1] || ''
    expect(overlayKeyframes).toMatch(/opacity/)
    expect(overlayKeyframes).not.toMatch(/transform/)
  })

  it('closes dialogs a little faster than they open, and only fades under reduced motion', () => {
    expect(css).toMatch(/\.app-modal-overlay\[data-state="closing"\]\s*\{[^}]*pointer-events:\s*none[^}]*overlay-exit var\(--duration-local\)/)
    expect(css).toMatch(/\.app-modal-overlay\[data-state="closing"\] \.app-modal\s*\{\s*animation:\s*sheet-exit var\(--duration-local\)/)
    expect(reducedBlocks).toMatch(/\[data-state="closing"\]\s*\{[^}]*animation-name:\s*overlay-exit !important/)
    const exitKeyframes = css.match(/@keyframes overlay-exit\s*\{([\s\S]*?)\n\}/)?.[1] || ''
    expect(exitKeyframes).toMatch(/opacity/)
    expect(exitKeyframes).not.toMatch(/transform/)
  })

  it('never uses transition: all in the stylesheet', () => {
    expect(css).not.toMatch(/transition:\s*all/)
  })

  it('gates custom hover rules behind a hover-capable pointer', () => {
    const hoverRules = [...css.matchAll(/^([^\n{}@]*:hover[^\n{]*)\{/gm)].map((m) => m[1].trim())
    for (const selector of hoverRules) {
      const index = css.indexOf(selector)
      const before = css.slice(Math.max(0, index - 400), index)
      expect(before, selector).toMatch(/@media \(hover: hover\)( and \(pointer: fine\))?\s*\{[^}]*$/)
    }
  })
})
