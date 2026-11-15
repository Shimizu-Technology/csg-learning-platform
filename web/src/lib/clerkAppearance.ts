import { PRODUCT_NAME, SCHOOL_NAME } from './brand'

/**
 * Clerk components use the same colour roles as the rest of CSG Learn so the
 * widget reads as part of the page rather than a third-party embed. Values
 * mirror the tokens in index.css (asserted in clerkAppearance.test.ts).
 */
const FONT_SANS = '"Manrope Variable", "Avenir Next", sans-serif'

/** Clerk takes colour strings, not CSS variables: one set per theme, mirroring index.css. */
const PALETTE = {
  light: {
    primary: '#9c292b', // --csg-primary
    onPrimary: '#ffffff', // --csg-on-primary
    danger: '#b91c1c', // --csg-danger-ink
    success: '#15803d', // --csg-success-ink
    warning: '#92400e', // --csg-warning-ink
    ink: '#0f172a', // --csg-ink
    inkSecondary: '#475569', // --csg-ink-secondary
    raised: '#ffffff', // --csg-surface-raised
    sunken: '#f3f2ee', // --csg-surface-sunken
    line: '#e2e8f0', // --csg-line
    focus: '#1d4ed8', // --csg-focus
    brandCream: '#faf7f0', // --csg-brand-cream
    brandLine: '#ded7c9', // --csg-brand-line
    shadow: '#0f172a',
  },
  dark: {
    primary: '#b23e40',
    onPrimary: '#ffffff',
    danger: '#f88a8a',
    success: '#5fd38d',
    warning: '#f5c04a',
    ink: '#e8ecf2',
    inkSecondary: '#b4bdca',
    raised: '#151a22',
    sunken: '#10141a',
    line: '#262d38',
    focus: '#6ea8ff',
    brandCream: '#11100d',
    brandLine: '#302c25',
    shadow: '#000000',
  },
} as const

export type ClerkTheme = keyof typeof PALETTE

function sharedVariables(theme: ClerkTheme) {
  const c = PALETTE[theme]
  return {
    colorPrimary: c.primary,
    colorPrimaryForeground: c.onPrimary,
    colorDanger: c.danger,
    colorSuccess: c.success,
    colorWarning: c.warning,
    colorForeground: c.ink,
    colorMutedForeground: c.inkSecondary,
    colorNeutral: c.ink,
    colorInputForeground: c.ink,
    colorInput: c.raised,
    colorRing: c.focus,
    colorShadow: c.shadow,
    colorBackground: c.raised,
    fontFamily: FONT_SANS,
    fontFamilyButtons: FONT_SANS,
    // 16px base keeps Clerk inputs at 16px, so iOS Safari never zooms on focus.
    fontSize: '1rem',
  }
}

/** Inside the working app (account menu, profile): neutral surfaces, 12px controls. */
export function clerkThemeVariables(theme: ClerkTheme) {
  const c = PALETTE[theme]
  return { ...sharedVariables(theme), colorMuted: c.sunken, colorBorder: c.line, borderRadius: '0.75rem' }
}

/** Sign-in and sign-up pages: the CSG site's cream family and 6px radii. */
export function clerkAuthThemeVariables(theme: ClerkTheme) {
  const c = PALETTE[theme]
  return { ...sharedVariables(theme), colorMuted: c.brandCream, colorBorder: c.brandLine, borderRadius: '0.375rem' }
}

export const CLERK_THEME_VARIABLES = clerkThemeVariables('light')
export const CLERK_AUTH_THEME_VARIABLES = clerkAuthThemeVariables('light')

/** Same focus ring as the rest of the app: 2px focus blue, 2px offset. */
const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus'

/** Must match the `@layer … clerk …` order declared at the top of index.css. */
export const CLERK_CSS_LAYER = 'clerk'

export function clerkAppearanceFor(theme: ClerkTheme) {
  return {
    cssLayerName: CLERK_CSS_LAYER,
    variables: clerkThemeVariables(theme),
    elements: {
      formFieldInput: 'text-base',
    },
  }
}

export const clerkAppearance = clerkAppearanceFor('light')

const AUTH_ELEMENTS = {
  rootBox: 'mx-auto w-full',
  cardBox: 'w-full max-w-none rounded-md border border-brand-line shadow-none',
  card: 'rounded-none border-0 bg-surface-raised px-5 py-7 shadow-none sm:px-8',
  footerAction: 'flex-wrap justify-center gap-x-1',
  header: 'items-start text-left',
  headerTitle: 'font-display text-[1.75rem] font-medium leading-tight tracking-[-0.02em] text-ink',
  headerSubtitle: 'text-sm leading-6 text-ink-secondary',
  socialButtonsBlockButton: `min-h-12 rounded-md border border-solid border-brand-line-strong shadow-none text-base font-semibold text-ink hover:bg-brand-cream active:bg-brand-cream-sunken ${focusRing}`,
  dividerLine: 'bg-brand-line',
  dividerText: 'text-ink-muted',
  formFieldLabel: 'text-sm font-semibold text-ink',
  formFieldInput: `min-h-12 rounded-md border border-solid border-brand-line-strong bg-surface-raised shadow-none text-base text-ink focus:border-focus focus:ring-2 focus:ring-focus/25`,
  otpCodeFieldInput: 'text-base',
  formButtonPrimary: `min-h-12 rounded-md bg-action-primary bg-none after:hidden text-base font-bold normal-case text-on-action shadow-none hover:bg-action-primary-hover active:bg-action-primary-pressed ${focusRing}`,
  formFieldAction: 'font-semibold text-primary-ink hover:text-primary-soft-ink',
  identityPreviewEditButton: 'text-primary-ink hover:text-primary-soft-ink',
  footer: 'rounded-none border-t border-brand-line bg-brand-cream',
  footerActionText: 'text-sm text-ink-secondary',
  footerActionLink: `text-sm font-bold text-primary-ink underline underline-offset-4 hover:text-primary-soft-ink ${focusRing}`,
  alertText: 'text-sm',
}

export function clerkAuthAppearanceFor(theme: ClerkTheme) {
  return { variables: clerkAuthThemeVariables(theme), elements: AUTH_ELEMENTS }
}

export const clerkAuthAppearance = clerkAuthAppearanceFor('light')

/**
 * Clerk otherwise titles its widget with the instance's application name
 * configured in the Clerk dashboard. Use the one product name instead.
 */
export const clerkLocalization = {
  signIn: {
    start: {
      title: `Sign in to ${PRODUCT_NAME}`,
      // The page already says "Welcome back"; the card doesn't repeat it (S-19).
      subtitle: 'Enter your email to continue.',
      actionText: 'Have an invitation?',
      actionLink: 'Sign up',
    },
    password: { subtitle: `Enter the password for your ${PRODUCT_NAME} account.` },
    emailCode: { subtitle: `to continue to ${PRODUCT_NAME}` },
  },
  signUp: {
    start: {
      title: `Create your ${PRODUCT_NAME} account`,
      subtitle: `Use the email address your ${SCHOOL_NAME} invitation was sent to.`,
      actionText: 'Already have an account?',
      actionLink: 'Sign in',
    },
    emailCode: { subtitle: `to continue to ${PRODUCT_NAME}` },
    continue: { subtitle: `to continue to ${PRODUCT_NAME}` },
  },
}
