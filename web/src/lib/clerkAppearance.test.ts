import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { CLERK_AUTH_THEME_VARIABLES, CLERK_CSS_LAYER, CLERK_THEME_VARIABLES, clerkAppearance, clerkAuthAppearance, clerkLocalization } from './clerkAppearance'

const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8')
function token(name: string) {
  const value = css.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim()
  if (!value) throw new Error(`Missing token --${name}`)
  return value
}

describe('Clerk appearance', () => {
  it.each([CLERK_THEME_VARIABLES, CLERK_AUTH_THEME_VARIABLES])('maps colour roles to the CSS tokens', (variables) => {
    expect(variables.colorPrimary).toBe(token('color-action-primary'))
    expect(variables.colorPrimaryForeground).toBe(token('color-on-action'))
    expect(variables.colorDanger).toBe(token('color-danger-700'))
    expect(variables.colorSuccess).toBe(token('color-success-700'))
    expect(variables.colorWarning).toBe(token('color-warning-800'))
    expect(variables.colorForeground).toBe(token('color-ink'))
    expect(variables.colorMutedForeground).toBe(token('color-ink-secondary'))
    expect(variables.colorRing).toBe(token('color-focus'))
    expect(variables.fontFamily).toContain('Manrope Variable')
  })

  it('keeps Clerk inputs at 16px so iOS does not zoom on focus', () => {
    expect(CLERK_THEME_VARIABLES.fontSize).toBe('1rem')
    expect(CLERK_AUTH_THEME_VARIABLES.fontSize).toBe('1rem')
    expect(clerkAuthAppearance.elements.formFieldInput).toContain('text-base')
    expect(clerkAuthAppearance.elements.formFieldInput).toContain('min-h-12')
  })

  it('uses the CSG site family on the sign-in pages: cream, its borders, 6px radii, Newsreader title', () => {
    expect(CLERK_AUTH_THEME_VARIABLES.borderRadius).toBe('0.375rem')
    expect(CLERK_AUTH_THEME_VARIABLES.colorMuted).toBe(token('color-brand-cream'))
    expect(CLERK_AUTH_THEME_VARIABLES.colorBorder).toBe(token('color-brand-line'))
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
})
