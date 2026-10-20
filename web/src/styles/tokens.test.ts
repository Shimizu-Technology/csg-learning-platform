import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8')

/** Resolve a `--color-*` token from index.css to a hex value (follows var() aliases). */
function token(name: string, seen = new Set<string>()): string {
  if (seen.has(name)) throw new Error(`Circular token ${name}`)
  seen.add(name)
  const match = css.match(new RegExp(`--${name}:\\s*([^;]+);`))
  if (!match) throw new Error(`Missing token --${name}`)
  const value = match[1].trim()
  const alias = value.match(/^var\(--([\w-]+)\)$/)
  return alias ? token(alias[1], seen) : value
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

const WHITE = '#ffffff'

// [foreground token, background token or hex, minimum ratio]
const TEXT_PAIRS: Array<[string, string, number]> = [
  // Primary action (normal text: 4.5) in every interaction state
  ['color-on-action', 'color-action-primary', 4.5],
  ['color-on-action', 'color-action-primary-hover', 4.5],
  ['color-on-action', 'color-action-primary-pressed', 4.5],
  ['color-ruby-700', WHITE, 4.5],
  ['color-ruby-700', 'color-ruby-50', 4.5],
  // Status badges and cards
  ['color-danger-700', 'color-danger-50', 4.5],
  ['color-warning-800', 'color-warning-50', 4.5],
  ['color-success-700', 'color-success-50', 4.5],
  ['color-pending-700', 'color-pending-50', 4.5],
  ['color-info-800', 'color-info-50', 4.5],
  // Text tiers on raised, page, and sunken surfaces
  ['color-ink', 'color-surface-raised', 4.5],
  ['color-ink-secondary', 'color-surface-raised', 4.5],
  ['color-ink-muted', 'color-surface-raised', 4.5],
  ['color-ink', 'color-surface-page', 4.5],
  ['color-ink-secondary', 'color-surface-page', 4.5],
  ['color-ink-muted', 'color-surface-page', 4.5],
  ['color-ink-secondary', 'color-surface-sunken', 4.5],
  ['color-ink-muted', 'color-surface-sunken', 4.5],
  ['color-ink-muted', 'color-pending-50', 4.5],
  ['color-slate-500', 'color-surface-page', 4.5],
  // Public and sign-in surfaces (CSG site cream)
  ['color-ink', 'color-brand-cream', 4.5],
  ['color-ink-secondary', 'color-brand-cream', 4.5],
  ['color-ink-muted', 'color-brand-cream', 4.5],
  ['color-ruby-700', 'color-brand-cream', 4.5],
  ['color-ink-secondary', 'color-brand-cream-sunken', 4.5],
  ['color-on-action', 'color-action-primary', 4.5],
  // Inverse surface
  [WHITE, 'color-surface-inverse', 4.5],
]

// Non-text UI (focus indicator, icons): WCAG 1.4.11 needs 3:1. The ring sits
// 2px outside the control, so it is measured against the surrounding surface.
const UI_PAIRS: Array<[string, string, number]> = [
  ['color-focus', 'color-surface-raised', 3],
  ['color-focus', 'color-surface-page', 3],
  ['color-ruby-600', 'color-surface-raised', 3],
]

const resolveColor = (value: string) => (value.startsWith('#') ? value : token(value))

describe('design tokens', () => {
  it.each(TEXT_PAIRS)('text %s on %s meets %s:1', (fg, bg, min) => {
    expect(contrast(resolveColor(fg), resolveColor(bg))).toBeGreaterThanOrEqual(min)
  })

  it.each(UI_PAIRS)('ui %s on %s meets %s:1', (fg, bg, min) => {
    expect(contrast(resolveColor(fg), resolveColor(bg))).toBeGreaterThanOrEqual(min)
  })

  it('keeps the brand action on the CSG family ruby values', () => {
    expect(token('color-action-primary').toLowerCase()).toBe('#9c292b')
    expect(token('color-action-primary-hover').toLowerCase()).toBe('#842225')
    expect(token('color-action-primary-pressed').toLowerCase()).toBe('#6f1c1f')
  })

  it('no longer maps primary to Tailwind red', () => {
    expect(token('color-primary-600').toLowerCase()).toBe('#9c292b')
    expect(token('color-primary-500').toLowerCase()).not.toBe('#ef4444')
  })

  it('focus ring differs from brand and danger and is used by the global :focus-visible rule', () => {
    const focus = token('color-focus').toLowerCase()
    expect(focus).toBe('#1d4ed8')
    expect(focus).not.toBe(token('color-action-primary').toLowerCase())
    expect(focus).not.toBe(token('color-danger-700').toLowerCase())
    expect(css).toMatch(/:focus-visible\s*\{\s*outline:\s*2px solid var\(--focus-ring\);/)
    expect(css).toMatch(/--focus-ring:\s*var\(--color-focus\)/)
  })

  it('hover darkens the primary action instead of lightening it', () => {
    expect(luminance(token('color-action-primary-hover'))).toBeLessThan(luminance(token('color-action-primary')))
    expect(luminance(token('color-action-primary-pressed'))).toBeLessThan(luminance(token('color-action-primary-hover')))
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
