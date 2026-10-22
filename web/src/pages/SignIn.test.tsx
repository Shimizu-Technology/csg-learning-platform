import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const clerkState = vi.hoisted(() => ({ value: { loaded: true, __unstable__environment: { userSettings: { signUp: { mode: 'restricted' as string } } } } as Record<string, unknown> }))

vi.mock('@clerk/clerk-react', () => ({
  SignIn: (props: { signUpUrl: string; forceRedirectUrl?: string }) => <div data-testid="clerk-sign-in" data-switch={props.signUpUrl} data-return={props.forceRedirectUrl} />,
  SignUp: (props: { signInUrl: string; forceRedirectUrl?: string }) => <div data-testid="clerk-sign-up" data-switch={props.signInUrl} data-return={props.forceRedirectUrl} />,
  useClerk: () => clerkState.value,
  useUser: () => ({ user: null }),
  ClerkLoading: () => null,
  ClerkFailed: () => null,
}))
vi.mock('../contexts/AuthContext', () => ({
  useAuthContext: () => ({ isSignedIn: false, accessDenied: false, sessionError: null, syncSession: vi.fn() }),
}))

import { SignInPage, SignUpPage } from './SignIn'

function render(url: string) {
  return renderToStaticMarkup(<MemoryRouter initialEntries={[url]}><SignUpPage /></MemoryRouter>)
}
const withMode = (mode: string | undefined, loaded = true) => {
  clerkState.value = mode === undefined
    ? { loaded }
    : { loaded, __unstable__environment: { userSettings: { signUp: { mode } } } }
}
const showsHelp = (html: string) => html.includes('Use the link in your invitation email') && !html.includes('clerk-sign-up')
const showsWidget = (html: string) => html.includes('clerk-sign-up') && !html.includes('Use the link in your invitation email')

describe('SignUpPage branches', () => {
  beforeEach(() => withMode('restricted'))

  it('restricted mode without a ticket: invitation guidance instead of a dead-end widget', () => {
    expect(showsHelp(render('/sign-up'))).toBe(true)
  })

  it('restricted mode with an empty ticket is still treated as no invitation', () => {
    expect(showsHelp(render('/sign-up?__clerk_ticket='))).toBe(true)
  })

  it('restricted mode with a ticket: Clerk widget and "Accept your invitation."', () => {
    const html = render('/sign-up?__clerk_ticket=abc&__clerk_status=sign_up')
    expect(showsWidget(html)).toBe(true)
    expect(html).toContain('Accept your invitation.')
  })

  it('public mode: Clerk widget', () => {
    withMode('public')
    expect(showsWidget(render('/sign-up'))).toBe(true)
  })

  it('unknown mode (unreadable environment): Clerk widget', () => {
    withMode(undefined)
    expect(showsWidget(render('/sign-up'))).toBe(true)
  })

  it('before Clerk has loaded: no guidance yet', () => {
    withMode('restricted', false)
    expect(showsWidget(render('/sign-up'))).toBe(true)
  })
})


describe('course acquisition auth', () => {
  it('keeps the validated offering candidate through signup and sign-in switches', () => {
    withMode('public')
    const signup = render('/sign-up?offering_id=13')
    expect(signup).toContain('data-switch="/sign-in?offering_id=13"')
    expect(signup).toContain('data-return="/courses?offering_id=13"')
    const signin = renderToStaticMarkup(<MemoryRouter initialEntries={['/sign-in?offering_id=13']}><SignInPage /></MemoryRouter>)
    expect(signin).toContain('data-switch="/sign-up?offering_id=13"')
    expect(signin).toContain('data-return="/courses?offering_id=13"')
  })
})
