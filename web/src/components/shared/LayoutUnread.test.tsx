// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Layout } from './Layout'
const fixture = vi.hoisted(() => ({
  user: { id: 1, role: 'student', is_staff: false, enrollments: [] },
  refresh: null as null | ((isCurrent: () => boolean) => void),
  notifications: Promise.resolve({ data: { unread_count: 0 } }),
  channels: Promise.resolve({ data: { channels: [] as { id: number; unread_count: number }[] } }),
}))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: fixture.user, enrollments: [] }) }))
vi.mock('../../contexts/CohortContext', () => ({ useCohortContext: () => ({ selectedCohort: null }) }))
vi.mock('../../lib/unread', async (original) => ({ ...await original<typeof import('../../lib/unread')>(), subscribeUnreadRefresh: (refresh: typeof fixture.refresh) => { fixture.refresh = refresh; return vi.fn() } }))
vi.mock('../../lib/api', () => ({ api: { getNotifications: () => fixture.notifications, getChannels: () => fixture.channels, getDirectConversations: async () => ({ data: { direct_conversations: [] } }), updatePresence: vi.fn() } }))
vi.mock('../../lib/realtime', () => ({ subscribeToUserMessages: async () => vi.fn() }))
vi.mock('./CommandPalette', () => ({ CommandPalette: () => null }))
vi.mock('./CohortSwitcher', () => ({ CohortSwitcher: () => null }))
vi.mock('./AccountMenu', () => ({ AccountMenu: () => null }))
vi.mock('../../lib/routePreload', () => ({ preloadPrimaryRoutes: vi.fn(), preloadRoute: vi.fn() }))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  window.matchMedia = vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks() })
it('ignores both notification and message counts from an older overlapping refresh', async () => {
  let finishNotifications!: (value: typeof fixture.notifications extends Promise<infer T> ? T : never) => void
  let finishChannels!: (value: typeof fixture.channels extends Promise<infer T> ? T : never) => void
  fixture.notifications = new Promise((resolve) => { finishNotifications = resolve })
  fixture.channels = new Promise((resolve) => { finishChannels = resolve })
  await act(async () => root.render(<MemoryRouter><Layout /></MemoryRouter>))
  fixture.notifications = Promise.resolve({ data: { unread_count: 2 } })
  fixture.channels = Promise.resolve({ data: { channels: [{ id: 1, unread_count: 3 }] } })
  await act(async () => fixture.refresh?.(() => true))
  const badges = () => [...container.querySelectorAll('a[href="/announcements"], a[href="/messages"]')].map((link) => link.textContent)
  expect(badges().some((text) => text?.includes('2'))).toBe(true)
  expect(badges().some((text) => text?.includes('3'))).toBe(true)
  await act(async () => {
    finishNotifications({ data: { unread_count: 90 } })
    finishChannels({ data: { channels: [{ id: 1, unread_count: 91 }] } })
  })
  expect(badges().some((text) => text?.includes('90') || text?.includes('91'))).toBe(false)
  expect(badges().some((text) => text?.includes('2'))).toBe(true)
  expect(badges().some((text) => text?.includes('3'))).toBe(true)
})
