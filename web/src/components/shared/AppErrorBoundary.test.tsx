// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { RouteErrorBoundary } from './AppErrorBoundary'
const capture = vi.hoisted(() => vi.fn())
vi.mock('../../lib/posthogClient', () => ({ withPostHog: (callback: (client: unknown) => void) => callback({ captureException: capture }) }))
it('reports router render failures and shows the app recovery screen', async () => {
  const error = new Error('route render failed')
  function Broken(): never { throw error }
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  const router = createMemoryRouter([{ path: '/', element: <Broken />, errorElement: <RouteErrorBoundary /> }])
  try {
    await act(async () => root.render(<RouterProvider router={router} />))
    expect(host.textContent).toContain('Something went wrong')
    expect(host.textContent).toContain('Reload')
    expect(host.textContent).not.toContain('Unexpected Application Error')
    expect(capture).toHaveBeenCalledWith(error, expect.objectContaining({ source: 'react_error_boundary' }))
  } finally { await act(async () => root.unmount()); host.remove(); router.dispose(); consoleError.mockRestore() }
})
