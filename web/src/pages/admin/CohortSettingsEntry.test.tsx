// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { CohortSettingsEntry } from './CohortSettingsEntry'
const auth = vi.hoisted(() => ({ admin: false }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: { is_admin: auth.admin } }) }))
it.each([true, false])('normalizes legacy settings for admin=%s', async (admin) => {
  auth.admin = admin
  const container = document.createElement('div'); const root = createRoot(container)
  const router = createMemoryRouter([{ path: '/admin/cohorts/:id/settings', element: <CohortSettingsEntry><p>Settings editor</p></CohortSettingsEntry> }, { path: '/admin/cohorts/:id', element: <p>Teaching workspace</p> }], { initialEntries: ['/admin/cohorts/4/settings'] })
  try {
    await act(async () => root.render(<RouterProvider router={router} />))
    expect(container.textContent).toBe(admin ? 'Settings editor' : 'Teaching workspace')
    expect(router.state.location.pathname + router.state.location.search).toBe(admin ? '/admin/cohorts/4/settings' : '/admin/cohorts/4?tab=recordings&settings_notice=1')
  } finally { act(() => root.unmount()) }
})
