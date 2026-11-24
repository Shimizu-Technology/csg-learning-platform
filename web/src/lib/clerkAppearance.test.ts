import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { CLERK_AUTH_THEME_VARIABLES, CLERK_CSS_LAYER, CLERK_THEME_VARIABLES, clerkAppearance, clerkAppearanceFor, clerkAuthAppearance, clerkAuthAppearanceFor, clerkAuthThemeVariables, clerkLocalization, clerkLocalizationFor, clerkThemeVariables } from './clerkAppearance'

const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8')
function block(selector: RegExp) {
  const start = css.search(selector)
  return css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
}
const blocks = { light: block(/^:root\s*\{/m), dark: block(/^:root\[data-theme="dark"\]\s*\{/m) }
function token(name: string, theme: 'light' | 'dark' = 'light') {
  const value = blocks[theme].match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim()
  if (!value) throw new Error(`Missing token --${name}`)
  return value
}

describe('Clerk appearance', () => {
  it.each(['light', 'dark'] as const)('maps colour roles to the CSS tokens in %s', (theme) => {
    for (const variables of [clerkThemeVariables(theme), clerkAuthThemeVariables(theme)]) {
      expect(variables.colorPrimary).toBe(token('csg-primary', theme))
      expect(variables.colorPrimaryForeground).toBe(token('csg-on-primary', theme))
      expect(variables.colorDanger).toBe(token('csg-danger-ink', theme))
      expect(variables.colorSuccess).toBe(token('csg-success-ink', theme))
      expect(variables.colorWarning).toBe(token('csg-warning-ink', theme))
      expect(variables.colorForeground).toBe(token('csg-ink', theme))
      expect(variables.colorMutedForeground).toBe(token('csg-ink-secondary', theme))
      expect(variables.colorBackground).toBe(token('csg-surface-raised', theme))
      expect(variables.colorInput).toBe(token('csg-surface-raised', theme))
      expect(variables.colorRing).toBe(token('csg-focus', theme))
      expect(variables.fontFamily).toContain('Manrope Variable')
    }
    expect(clerkThemeVariables(theme).colorBorder).toBe(token('csg-line', theme))
    expect(clerkThemeVariables(theme).colorMuted).toBe(token('csg-surface-sunken', theme))
    expect(clerkAuthThemeVariables(theme).colorBorder).toBe(token('csg-brand-line', theme))
    expect(clerkAuthThemeVariables(theme).colorMuted).toBe(token('csg-brand-cream', theme))
    expect(clerkAppearanceFor(theme).variables).toEqual(clerkThemeVariables(theme))
    expect(clerkAuthAppearanceFor(theme).variables).toEqual(clerkAuthThemeVariables(theme))
  })

  it('keeps Clerk inputs at 16px so iOS does not zoom on focus', () => {
    expect(CLERK_THEME_VARIABLES.fontSize).toBe('1rem')
    expect(CLERK_AUTH_THEME_VARIABLES.fontSize).toBe('1rem')
    expect(clerkAuthAppearance.elements.formFieldInput).toContain('text-base')
    expect(clerkAuthAppearance.elements.formFieldInput).toContain('min-h-12')
  })

  it('uses the CSG site family on the sign-in pages: cream, its borders, 6px radii, Newsreader title', () => {
    expect(CLERK_AUTH_THEME_VARIABLES.borderRadius).toBe('0.375rem')
    expect(CLERK_AUTH_THEME_VARIABLES.colorMuted).toBe(token('csg-brand-cream'))
    expect(CLERK_AUTH_THEME_VARIABLES.colorBorder).toBe(token('csg-brand-line'))
    expect(clerkAuthAppearance.elements.headerTitle).toContain('font-display')
    expect(clerkAuthAppearance.elements.formButtonPrimary).toContain('bg-action-primary')
    expect(clerkAuthAppearance.elements.formButtonPrimary).toContain('hover:bg-action-primary-hover')
  })

  it('uses the app focus ring on Clerk controls', () => {
    expect(clerkAuthAppearance.elements.formButtonPrimary).toContain('focus-visible:outline-focus')
    expect(clerkAuthAppearance.elements.formFieldInput).toContain('focus:border-focus')
  })

  it('puts Clerk styles in a CSS layer below Tailwind so appearance classes apply', () => {
    expect(clerkAppearance.cssLayerName).toBe(CLERK_CSS_LAYER)
    expect(css).toMatch(new RegExp(`@layer theme, base, ${CLERK_CSS_LAYER}, components, utilities;\\s*@import "tailwindcss";`))
  })

  it('titles the widget with the one product name', () => {
    expect(clerkLocalization.signIn.start.title).toBe('Sign in to CSG Learn')
    expect(clerkLocalization.signUp.start.title).toBe('Create your CSG Learn account')
    expect(JSON.stringify(clerkLocalization)).not.toMatch(/Learning Platform|Learning Hub|CSG Connect/)
  })

  it('uses welcoming course-enrollment copy without invitation-only wording for catalog buyers', () => {
    const courseLoc = clerkLocalizationFor('course')
    expect(courseLoc.signUp.start.subtitle).not.toMatch(/invitation/i)
    expect(courseLoc.signIn.start.actionText).not.toMatch(/invitation/i)
    expect(courseLoc.signUp.start.subtitle).toContain('continue enrolling')
  })
})
