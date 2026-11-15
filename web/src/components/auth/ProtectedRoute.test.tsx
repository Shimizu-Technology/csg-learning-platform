// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
const auth = vi.hoisted(() => ({ isSignedIn: false, isLoading: false, user: { role: 'student', is_staff: false, is_admin: false }, accessDenied: false }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => auth }))
import ProtectedRoute from './ProtectedRoute'
import { SignInPage } from '../../pages/SignIn'
vi.mock('@clerk/clerk-react', () => ({
  SignIn: () => null, SignUp: () => null, useClerk: () => ({}), useUser: () => ({}), ClerkLoading: () => null, ClerkFailed: () => null,
}))
it('keeps an email DM path, query and hash through sign-in and post-sign-in navigation', async () => {
  const destination = '/messages/dm/6?message_id=42#message-42'
  const container = document.createElement('div'); const root = createRoot(container)
  const router = createMemoryRouter([
    { path: '/messages/dm/:id', element: <ProtectedRoute><p>DM destination</p></ProtectedRoute> },
    { path: '/sign-in', element: <SignInPage /> },
  ], { initialEntries: [destination] })
  try {
    auth.isSignedIn = false
    await act(async () => root.render(<RouterProvider router={router} />))
    expect(router.state.location.pathname).toBe('/sign-in')
    expect(new URLSearchParams(router.state.location.search).get('redirect_url')).toBe(destination)
    expect(router.state.location.search).toContain('redirect_url=%2Fmessages%2Fdm%2F6%3Fmessage_id%3D42%23message-42')
    auth.isSignedIn = true
    await act(async () => { await router.navigate(router.state.location.pathname + router.state.location.search) })
    expect(router.state.location.pathname + router.state.location.search + router.state.location.hash).toBe(destination)
    expect(container.textContent).toContain('DM destination')
  } finally { act(() => root.unmount()); container.remove(); auth.isSignedIn = false }
})
it('shows No access at the original URL for the wrong role, with Today and Back actions', async () => {
  auth.isSignedIn = true
  const container = document.createElement('div'); const root = createRoot(container)
  const router = createMemoryRouter([{ path: '/admin/team', element: <ProtectedRoute requiredRole="admin"><p>Secret</p></ProtectedRoute> }], { initialEntries: ['/admin/team'] })
  try {
    await act(async () => root.render(<RouterProvider router={router} />))
    expect(container.textContent).toContain('No access')
    expect(container.textContent).not.toContain('Secret')
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/dashboard')
    expect(container.querySelector('button')?.textContent).toBe('Back')
    expect(router.state.location.pathname).toBe('/admin/team')
  } finally { act(() => root.unmount()); container.remove(); auth.isSignedIn = false }
})
