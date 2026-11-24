// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CertificateVerificationPage } from './CertificateVerificationPage'
import { NotFoundRoute } from '../components/shared/NotFound'

const state = vi.hoisted(() => ({
  verifyCertificate: vi.fn(),
  auth: { isSignedIn: false, isLoading: false, accessDenied: false, user: null },
}))

vi.mock('../lib/api', () => ({ api: { verifyCertificate: state.verifyCertificate } }))
vi.mock('../contexts/AuthContext', () => ({ useAuthContext: () => state.auth }))

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.clearAllMocks()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('CertificateVerificationPage and signed-out NotFoundRoute', () => {
  it('wraps certificate 404 in PublicHeader/PublicFooter with clear recovery actions', async () => {
    state.verifyCertificate.mockResolvedValue({ data: null, error: 'Not found', status: 404 })
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/certificates/INVALIDCODE12']}>
          <Routes>
            <Route path="/certificates/:code" element={<CertificateVerificationPage />} />
          </Routes>
        </MemoryRouter>,
      )
    })
    expect(host.querySelector('header')).not.toBeNull()
    expect(host.querySelector('footer')).not.toBeNull()
    expect(host.textContent).toContain('Certificate not found')
    expect(host.textContent).toContain('12-character verification code')
    expect(host.querySelector('main a[href="/"]')?.textContent).toContain('Go to home')
    expect(host.querySelector('main a[href="/sign-in"]')?.textContent).toContain('Sign in')
    expect(host.querySelector('main a[href^="mailto:"]')?.textContent).toContain('Contact support')
  })

  it('wraps signed-out NotFoundRoute in PublicHeader/PublicFooter with Sign in and Contact support', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/missing-page']}>
          <Routes>
            <Route path="*" element={<NotFoundRoute />} />
          </Routes>
        </MemoryRouter>,
      )
    })
    expect(host.querySelector('header')).not.toBeNull()
    expect(host.querySelector('footer')).not.toBeNull()
    expect(host.textContent).toContain('Page not found')
    expect(host.querySelector('main a[href="/"]')?.textContent).toContain('Go to home')
    expect(host.querySelector('main a[href="/sign-in"]')?.textContent).toContain('Sign in')
    expect(host.querySelector('main a[href^="mailto:"]')?.textContent).toContain('Contact support')
  })
})
