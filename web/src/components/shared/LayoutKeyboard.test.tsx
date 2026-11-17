// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { Layout } from './Layout'

const keyboard = vi.hoisted(() => vi.fn())
vi.mock('../../lib/visualViewport', () => ({ useKeyboardAwareViewport: keyboard }))
vi.mock('../../contexts/AuthContext', () => ({
  useAuthContext: () => ({
    user: { id: 1, role: 'admin', is_staff: true, is_admin: true },
    enrollments: [],
  }),
}))
vi.mock('../../contexts/CohortContext', () => ({ useCohortContext: () => ({ cohorts: [] }) }))
vi.mock('../../lib/api', () => ({
  api: {
    getNotifications: async () => ({ data: { unread_count: 0 } }),
    getChannels: async () => ({ data: { channels: [] } }),
    getDirectConversations: async () => ({ data: { direct_conversations: [] } }),
    updatePresence: vi.fn(),
  },
}))
vi.mock('../../lib/realtime', () => ({ subscribeToUserMessages: async () => () => {} }))
vi.mock('./CommandPalette', () => ({ CommandPalette: () => null }))
vi.mock('./AccountMenu', () => ({ AccountMenu: () => null }))
vi.mock('../../lib/routePreload', () => ({ preloadPrimaryRoutes: vi.fn(), preloadRoute: vi.fn() }))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

it.each([
  ['/admin/cohorts/1?tab=settings', true],
  ['/admin/cohorts/1/students/3/access', true],
  ['/admin/cohorts/1/students/3/learning', true],
  ['/messages/dm/1', true],
  ['/admin/cohorts', false],
  ['/admin/students', false],
])('keyboard viewport detection on %s is %s', async (url, enabled) => {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () =>
      root.render(
        <MemoryRouter initialEntries={[url]}>
          <Layout />
        </MemoryRouter>,
      ),
    )
    expect(keyboard).toHaveBeenLastCalledWith(enabled)
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
