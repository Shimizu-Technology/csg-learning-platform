/**
 * Clerk components (sign-in, user profile, account menu) use the same colour
 * roles as the rest of CSG Learn. Values mirror the tokens in index.css.
 * Layout and branding of the auth pages themselves are handled separately.
 */
export const CLERK_THEME_VARIABLES = {
  colorPrimary: '#9c292b',
  colorDanger: '#b91c1c',
  colorSuccess: '#15803d',
  colorWarning: '#92400e',
  colorText: '#0f172a',
  colorTextSecondary: '#475569',
  colorBackground: '#ffffff',
  colorInputBackground: '#ffffff',
  colorInputText: '#0f172a',
  colorNeutral: '#0f172a',
  fontFamily: '"Manrope Variable", "Avenir Next", sans-serif',
  borderRadius: '0.75rem',
} as const

export const clerkAppearance = {
  variables: CLERK_THEME_VARIABLES,
}
