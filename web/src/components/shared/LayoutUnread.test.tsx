// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Layout } from './Layout'
import type { ChannelMessageEvent } from '../../types/api'
import { notifyUnreadChanged } from '../../lib/unread'
const fixture = vi.hoisted(() => ({
  user: { id: 1, role: 'student', is_staff: false, enrollments: [] },
  refresh: null as null | ((isCurrent: () => boolean) => void),
  realtime: null as null | ((event: ChannelMessageEvent) => void),
  channelCalls: 0,
  dmCalls: 0,
  notifications: Promise.resolve({ data: { unread_count: 0 } }),
  dms: Promise.resolve({ data: { direct_conversations: [] as { id: number; unread_count: number; muted?: boolean }[] } }),
  channels: Promise.resolve({ data: { channels: [] as { id: number; unread_count: number; muted?: boolean }[] } }),
}))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: fixture.user, enrollments: [] }) }))
vi.mock('../../contexts/CohortContext', () => ({ useCohortContext: () => ({ selectedCohort: null }) }))
vi.mock('../../lib/unread', async (original) => {
  const actual = await original<typeof import('../../lib/unread')>()
  return { ...actual, subscribeUnreadRefresh: (refresh: NonNullable<typeof fixture.refresh>) => { fixture.refresh = refresh; return actual.subscribeUnreadRefresh(refresh) } }
})
vi.mock('../../lib/api', () => ({ api: { getNotifications: () => fixture.notifications, getChannels: () => { fixture.channelCalls++; return fixture.channels }, getDirectConversations: () => { fixture.dmCalls++; return fixture.dms }, updatePresence: vi.fn() } }))
vi.mock('../../lib/realtime', () => ({ subscribeToUserMessages: async (callback: typeof fixture.realtime) => { fixture.realtime = callback; return vi.fn() } }))
vi.mock('./CommandPalette', () => ({ CommandPalette: () => null }))
vi.mock('./CohortSwitcher', () => ({ CohortSwitcher: () => null }))
vi.mock('./AccountMenu', () => ({ AccountMenu: () => null }))
vi.mock('../../lib/routePreload', () => ({ preloadPrimaryRoutes: vi.fn(), preloadRoute: vi.fn() }))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  fixture.channelCalls = 0; fixture.dmCalls = 0; fixture.realtime = null
  fixture.notifications = Promise.resolve({ data: { unread_count: 0 } })
  fixture.channels = Promise.resolve({ data: { channels: [] } })
  fixture.dms = Promise.resolve({ data: { direct_conversations: [] } })
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  window.matchMedia = vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.useRealTimers() })
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

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((finish) => { resolve = finish })
  return { promise, resolve }
}
const messageBadge = () => [...document.querySelectorAll('a[href="/messages"]')].at(-1)?.textContent?.replace(/\D/g, '')

it.each(['channel', 'dm'] as const)('applies unrelated server truth during a %s Cable event and runs one trailing refresh', async (type) => {
  vi.useFakeTimers()
  fixture.channels = Promise.resolve({ data: { channels: [{ id: 1, unread_count: 3 }] } })
  fixture.dms = Promise.resolve({ data: { direct_conversations: [{ id: 1, unread_count: 4 }] } })
  await act(async () => root.render(<MemoryRouter><Layout /></MemoryRouter>))
  expect(messageBadge()).toBe('7')
  const channels = deferred<Awaited<typeof fixture.channels>>()
  const dms = deferred<Awaited<typeof fixture.dms>>()
  fixture.channels = channels.promise; fixture.dms = dms.promise
  await act(async () => fixture.refresh?.(() => true))
  await act(async () => fixture.realtime?.({
    event: 'created',
    ...(type === 'channel' ? { channel: { id: 1, unread_count: 5, muted: false } } : { direct_conversation: { id: 1, unread_count: 5, muted: false } }),
  } as ChannelMessageEvent))
  await act(async () => {
    channels.resolve({ data: { channels: [{ id: 1, unread_count: 3, muted: type !== 'channel' }] } })
    dms.resolve({ data: { direct_conversations: [{ id: 1, unread_count: 0 }] } })
  })
  expect(messageBadge()).toBe('5')
  fixture.channels = Promise.resolve({ data: { channels: [{ id: 1, unread_count: 0 }] } })
  fixture.dms = Promise.resolve({ data: { direct_conversations: [{ id: 1, unread_count: 0 }] } })
  await act(async () => vi.advanceTimersByTimeAsync(350))
  expect(fixture.channelCalls).toBe(3)
  expect(fixture.dmCalls).toBe(3)
  expect(messageBadge()).toBe('')
  await act(async () => vi.advanceTimersByTimeAsync(350))
  expect(fixture.channelCalls).toBe(3)
})

it('accepts zero unread and mute changes from an authoritative refresh and coalesces bursts', async () => {
  vi.useFakeTimers()
  fixture.channels = Promise.resolve({ data: { channels: [{ id: 1, unread_count: 3 }] } })
  fixture.dms = Promise.resolve({ data: { direct_conversations: [{ id: 1, unread_count: 3 }] } })
  await act(async () => root.render(<MemoryRouter><Layout /></MemoryRouter>))
  fixture.channels = Promise.resolve({ data: { channels: [{ id: 1, unread_count: 0 }] } })
  fixture.dms = Promise.resolve({ data: { direct_conversations: [{ id: 1, unread_count: 3, muted: true }] } })
  await act(async () => {
    for (let i = 0; i < 10; i++) notifyUnreadChanged()
    await vi.advanceTimersByTimeAsync(350)
  })
  expect(messageBadge()).toBe('')
  expect(fixture.channelCalls).toBe(2)
  expect(fixture.dmCalls).toBe(2)
})
