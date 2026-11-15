// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./contexts/AuthContext', () => ({ useAuthContext: () => ({ isSignedIn: false, isLoading: true }) }))
vi.mock('./pages/Home', () => ({ HomePage: () => <p>Marketing landing</p> }))
vi.mock('@clerk/clerk-react', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ClerkLoading: ({ children }: { children: ReactNode }) => <>{children}</>,
  ClerkFailed: () => null,
}))

import { RouteLoadingFallback, RouteTitle } from './App'
import { PRODUCT_NAME } from './lib/brand'

const roots: Array<() => Promise<void>> = []
async function mount(path: string, element: ReactNode) {
  const node = document.createElement('div')
  const root = createRoot(node)
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}>{element}</MemoryRouter>))
  roots.push(async () => act(async () => root.unmount()))
  return node
}
afterEach(async () => { while (roots.length) await roots.pop()!() })

describe('route loading fallback (S-19)', () => {
  it.each(['/sign-in', '/sign-up'])('%s shows a neutral sign-in loading state, not an app skeleton', async (path) => {
    const node = await mount(path, <RouteLoadingFallback />)
    expect(node.querySelector('[data-testid="auth-loading-shell"]')).not.toBeNull()
    expect(node.textContent).toContain('Loading sign-in')
    expect(node.textContent).not.toContain('Loading...')
  })

  it('app routes keep the app skeleton', async () => {
    const node = await mount('/dashboard', <RouteLoadingFallback />)
    expect(node.querySelector('[data-testid="auth-loading-shell"]')).toBeNull()
  })
})

describe('RouteTitle', () => {
  it.each([
    ['/admin/lessons/4/edit', `Edit lesson · ${PRODUCT_NAME}`],
    ['/admin/cohorts/3', `Cohort · ${PRODUCT_NAME}`],
    ['/admin', `Today · ${PRODUCT_NAME}`],
  ])('sets document.title for %s', async (path, title) => {
    await mount(path, <RouteTitle />)
    expect(document.title).toBe(title)
  })
})
