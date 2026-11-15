// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { CohortSettingsEntry } from './CohortSettingsEntry'
const auth = vi.hoisted(() => ({ admin: false }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: { is_admin: auth.admin } }) }))
it.each([true, false].flatMap(admin => ['', '#students', '#recordings', '#schedule', '#communication', '#curriculum', '#unknown'].map(hash => ({ admin, hash }))))('normalizes legacy settings $admin $hash', async ({ admin, hash }) => {
  auth.admin = admin
  const container = document.createElement('div'); const root = createRoot(container)
  const router = createMemoryRouter([{ path: '/admin/cohorts/:id/settings', element: <CohortSettingsEntry /> }, { path: '/admin/cohorts/:id', element: <p>Teaching workspace</p> }], { initialEntries: [`/admin/cohorts/4/settings${hash}`] })
  try {
    await act(async () => root.render(<RouterProvider router={router} />))
    expect(container.textContent).toBe('Teaching workspace')
    const sections: Record<string, string> = { '#students': 'students', '#recordings': 'recordings', '#schedule': 'schedule', '#communication': 'communication' }; const tab = sections[hash] || (admin ? 'settings' : 'overview'); expect(router.state.location.pathname + router.state.location.search).toBe(`/admin/cohorts/4?${tab === 'overview' ? 'settings_notice=1' : `tab=${tab}`}`)
  } finally { act(() => root.unmount()) }
})
