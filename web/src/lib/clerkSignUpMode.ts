/**
 * Clerk's sign-up mode for this instance: "public", "restricted" (invitation
 * only), or "waitlist". Production CSG Learn is restricted, so sign-up without
 * an invitation ticket only shows Clerk's "Access restricted" screen. Clerk
 * exposes the mode only on its environment object (not a stable API), so read
 * it defensively and fall back to "unknown", which keeps Clerk's own widget.
 */
export type SignUpMode = 'public' | 'restricted' | 'waitlist' | 'unknown'

interface ClerkEnvironmentLike {
  __unstable__environment?: { userSettings?: { signUp?: { mode?: unknown } } } | null
}

export function signUpModeFrom(clerk: unknown): SignUpMode {
  try {
    const mode = (clerk as ClerkEnvironmentLike | null | undefined)?.__unstable__environment?.userSettings?.signUp?.mode
    return mode === 'public' || mode === 'restricted' || mode === 'waitlist' ? mode : 'unknown'
  } catch {
    return 'unknown'
  }
}
