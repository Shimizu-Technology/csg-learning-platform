import { PRODUCT_NAME, SCHOOL_NAME } from './brand'

/**
 * Clerk components use the same colour roles as the rest of CSG Learn so the
 * widget reads as part of the page rather than a third-party embed. Values
 * mirror the tokens in index.css (asserted in clerkAppearance.test.ts).
 */
const FONT_SANS = '"Manrope Variable", "Avenir Next", sans-serif'

const SHARED_VARIABLES = {
  colorPrimary: '#9c292b', // --color-action-primary
  colorPrimaryForeground: '#ffffff', // --color-on-action
  colorDanger: '#b91c1c', // --color-danger-700
  colorSuccess: '#15803d', // --color-success-700
  colorWarning: '#92400e', // --color-warning-800
  colorForeground: '#0f172a', // --color-ink
  colorMutedForeground: '#475569', // --color-ink-secondary
  colorNeutral: '#0f172a',
  colorInputForeground: '#0f172a',
  colorInput: '#ffffff',
  colorRing: '#1d4ed8', // --color-focus
  colorShadow: '#0f172a',
  fontFamily: FONT_SANS,
  fontFamilyButtons: FONT_SANS,
  // 16px base keeps Clerk inputs at 16px, so iOS Safari never zooms on focus.
  fontSize: '1rem',
} as const

/** Inside the working app (account menu, profile): neutral surfaces, 12px controls. */
export const CLERK_THEME_VARIABLES = {
  ...SHARED_VARIABLES,
  colorBackground: '#ffffff',
  colorMuted: '#f3f2ee', // --color-surface-sunken
  colorBorder: '#e2e8f0', // --color-line
  borderRadius: '0.75rem',
} as const

/** Sign-in and sign-up pages: the CSG site's cream family and 6px radii. */
export const CLERK_AUTH_THEME_VARIABLES = {
  ...SHARED_VARIABLES,
  colorBackground: '#ffffff',
  colorMuted: '#faf7f0', // --color-brand-cream
  colorBorder: '#ded7c9', // --color-brand-line
  borderRadius: '0.375rem',
} as const

/** Same focus ring as the rest of the app: 2px focus blue, 2px offset. */
const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus'

/** Must match the `@layer … clerk …` order declared at the top of index.css. */
export const CLERK_CSS_LAYER = 'clerk'

export const clerkAppearance = {
  cssLayerName: CLERK_CSS_LAYER,
  variables: CLERK_THEME_VARIABLES,
  elements: {
    formFieldInput: 'text-base',
  },
}

export const clerkAuthAppearance = {
  variables: CLERK_AUTH_THEME_VARIABLES,
  elements: {
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
    formFieldAction: 'font-semibold text-ruby-700 hover:text-ruby-800',
    identityPreviewEditButton: 'text-ruby-700 hover:text-ruby-800',
    footer: 'rounded-none border-t border-brand-line bg-brand-cream',
    footerActionText: 'text-sm text-ink-secondary',
    footerActionLink: `text-sm font-bold text-ruby-700 underline underline-offset-4 hover:text-ruby-800 ${focusRing}`,
    alertText: 'text-sm',
  },
}

/**
 * Clerk otherwise titles its widget with the instance's application name
 * configured in the Clerk dashboard. Use the one product name instead.
 */
export const clerkLocalization = {
  signIn: {
    start: {
      title: `Sign in to ${PRODUCT_NAME}`,
      subtitle: 'Welcome back. Use the email from your invitation.',
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
