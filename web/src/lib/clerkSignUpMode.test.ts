import { describe, expect, it } from 'vitest'
import { signUpModeFrom } from './clerkSignUpMode'

describe('signUpModeFrom', () => {
  it('reads the sign-up mode from the Clerk environment', () => {
    expect(signUpModeFrom({ __unstable__environment: { userSettings: { signUp: { mode: 'restricted' } } } })).toBe('restricted')
    expect(signUpModeFrom({ __unstable__environment: { userSettings: { signUp: { mode: 'public' } } } })).toBe('public')
  })

  it('falls back to unknown (keep the Clerk widget) when the shape changes', () => {
    expect(signUpModeFrom(undefined)).toBe('unknown')
    expect(signUpModeFrom({})).toBe('unknown')
    expect(signUpModeFrom({ __unstable__environment: null })).toBe('unknown')
    expect(signUpModeFrom({ __unstable__environment: { userSettings: { signUp: { mode: 'something_new' } } } })).toBe('unknown')
    const throwing = { get __unstable__environment() { throw new Error('nope') } }
    expect(signUpModeFrom(throwing)).toBe('unknown')
  })
})
