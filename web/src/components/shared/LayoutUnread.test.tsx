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
  features: {} as Record<string, boolean>,
  channelCalls: 0,
  dmCalls: 0,
  notifications: Promise.resolve({ data: { unread_count: 0 } }),
  dms: Promise.resolve({ data: { direct_conversations: [] as { id: number; unread_count: number; muted?: boolean }[] } }),
  channels: Promise.resolve({ data: { channels: [] as { id: number; unread_count: number; muted?: boolean }[] } }),
}))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: fixture.user, enrollments: [] }) }))
vi.mock('../../contexts/CohortContext', () => ({ useCohortContext: () => ({ selectedCohort: Object.keys(fixture.features).length ? { id: 4, features: fixture.features } : null }) }))
vi.mock('../../lib/unread', async (original) => {
  const actual = await original<typeof import('../../lib/unread')>()
  return { ...actual, subscribeUnreadRefresh: (refresh: NonNullable<typeof fixture.refresh>) => { fixture.refresh = refresh; return actual.subscribeUnreadRefresh(refresh) } }
})
vi.mock('../../lib/api', () => ({ api: { getNotifications: () => fixture.notifications, getChannels: () => { fixture.channelCalls++; return fixture.channels }, getDirectConversations: () => { fixture.dmCalls++; return fixture.dms }, updatePresence: vi.fn() } }))
vi.mock('../../lib/realtime', () => ({ subscribeToUserMessages: async (callback: typeof fixture.realtime) => { fixture.realtime = callback; return vi.fn() } }))
vi.mock('./CommandPalette', () => ({ CommandPalette: () => null }))
vi.mock('./CohortSwitcher', () => ({ CohortSwitcher: ({ compact, iconOnly }: { compact?: boolean; iconOnly?: boolean }) => <span data-cohort-switcher={compact ? 'phone' : iconOnly ? 'icon' : 'sidebar'} /> }))
vi.mock('./AccountMenu', () => ({ AccountMenu: () => null }))
vi.mock('../../lib/routePreload', () => ({ preloadPrimaryRoutes: vi.fn(), preloadRoute: vi.fn() }))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  fixture.features = {}; fixture.channelCalls = 0; fixture.dmCalls = 0; fixture.realtime = null
  fixture.notifications = Promise.resolve({ data: { unread_count: 0 } })
  fixture.channels = Promise.resolve({ data: { channels: [] } })
  fixture.dms = Promise.resolve({ data: { direct_conversations: [] } })
  fixture.user = { id: 1, role: 'student', is_staff: false, enrollments: [] };
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

it('shows one switcher per phone screen: the Messages list has its own, a conversation view uses the top bar\'s (U-4.11)', async () => {
  const phoneSwitcherOn = async (path: string) => {
    await act(async () => root.unmount())
    root = createRoot(container)
    await act(async () => root.render(<MemoryRouter initialEntries={[path]}><Layout /></MemoryRouter>))
    return container.querySelector('[data-cohort-switcher="phone"]') !== null
  }
  expect(await phoneSwitcherOn('/dashboard')).toBe(true)
  expect(await phoneSwitcherOn('/messages')).toBe(false)
  expect(await phoneSwitcherOn('/messages/')).toBe(false)
  expect(await phoneSwitcherOn('/messages?message_id=4')).toBe(false)
  // On a phone the conversation replaces the list, and with it the list's switcher.
  expect(await phoneSwitcherOn('/messages/dm/4')).toBe(true)
  expect(await phoneSwitcherOn('/messages/2')).toBe(true)
})

it('hides switched-off learner links in desktop and phone navigation', async () => {
  fixture.features = { recordings: false, announcements: false };
  await act(async () => root.render(<MemoryRouter><Layout /></MemoryRouter>));
  expect(container.querySelector('a[href="/recordings"]')).toBeNull();
  expect(container.querySelector('a[href^="/announcements"]')).toBeNull();
  expect(container.querySelector('a[href="/materials"]')).not.toBeNull();
});

it.each(['admin', 'instructor'])('keeps %s management navigation with learner features off', async (role) => {
  fixture.user = { ...fixture.user, role, is_staff: true };
  fixture.features = { private_meetings: false, help_requests: false, interventions: false, announcements: false };
  await act(async () => root.render(<MemoryRouter><Layout /></MemoryRouter>));
  expect(container.querySelector('a[href^="/admin/meetings"]')).not.toBeNull();
  expect(container.querySelector('a[href^="/admin/support"]')).not.toBeNull();
  expect(container.querySelector('a[href^="/announcements"]')).not.toBeNull();
});

it.each(['admin', 'instructor'])('shows one notification bell (the phone header) with the unread count for %s', async role => {
  fixture.user = { ...fixture.user, role, is_staff: true }
  fixture.notifications = Promise.resolve({ data: { unread_count: 3 } })
  await act(async () => root.render(<MemoryRouter><Layout /></MemoryRouter>))
  const bells = [...container.querySelectorAll('a[aria-label^="Notifications"]')]
  expect(bells).toHaveLength(1)
  expect(bells[0].closest('header')).not.toBeNull()
  expect(bells[0].getAttribute('aria-label')).toBe('Notifications, 3 unread')
  expect(container.querySelector('aside a[href="/announcements?tab=inbox"]')).toBeNull()
})

it('opens Notifications from Updates when only non-announcement notices are unread', async () => {
  fixture.user = { ...fixture.user, role: 'admin', is_staff: true }
  const api = (await import('../../lib/api')).api as unknown as { getNotifications: (params: { notification_type?: string }) => unknown }
  vi.spyOn(api, 'getNotifications').mockImplementation((params) => Promise.resolve({ data: { unread_count: params.notification_type === 'announcement' ? 0 : 4 } }))
  await act(async () => root.render(<MemoryRouter><Layout /></MemoryRouter>))
  const updates = [...container.querySelectorAll('aside a')].find((link) => link.textContent?.includes('Updates'))
  expect(updates?.getAttribute('href')).toBe('/announcements?tab=inbox')
})

it('keeps Updates on the feed while announcements are unread', async () => {
  fixture.user = { ...fixture.user, role: 'admin', is_staff: true }
  const api = (await import('../../lib/api')).api as unknown as { getNotifications: (params: { notification_type?: string }) => unknown }
  vi.spyOn(api, 'getNotifications').mockImplementation((params) => Promise.resolve({ data: { unread_count: params.notification_type === 'announcement' ? 1 : 4 } }))
  await act(async () => root.render(<MemoryRouter><Layout /></MemoryRouter>))
  const updates = [...container.querySelectorAll('aside a')].find((link) => link.textContent?.includes('Updates'))
  expect(updates?.getAttribute('href')).toBe('/announcements')
})

it('opens the phone drawer only from the bottom More, with More and Admin shown open', async () => {
  fixture.user = { ...fixture.user, role: 'admin', is_staff: true }
  await act(async () => root.render(<MemoryRouter><Layout /></MemoryRouter>))
  expect(container.querySelector('button[aria-label="Open navigation"]')).toBeNull()
  const more = container.querySelector<HTMLButtonElement>('nav[aria-label="Primary navigation"] button[aria-label="More navigation"]')
  expect(more).not.toBeNull()
  await act(async () => more!.click())
  const drawer = container.querySelector('[role="dialog"][aria-label="Site navigation"]')!
  expect(drawer.querySelector('[aria-expanded]')).toBeNull()
  expect([...drawer.querySelectorAll('section h2')].map((heading) => heading.textContent)).toContain('More')
  expect([...drawer.querySelectorAll('a')].some((link) => link.textContent?.includes('Updates'))).toBe(true)
})

it('shows the phone notification bell for students with unread/zero states and a 44px logo target', async () => {
  fixture.notifications = Promise.resolve({ data: { unread_count: 2 } })
  await act(async () => root.render(<MemoryRouter><Layout /></MemoryRouter>))
  const bell = container.querySelector('header a[href="/announcements?tab=inbox"]')
  expect(bell).not.toBeNull()
  expect(bell?.getAttribute('aria-label')).toBe('Notifications, 2 unread')
  expect(bell?.className).toContain('min-h-11')
  expect(bell?.className).toContain('min-w-11')
  expect(bell?.textContent).toContain('2')

  const logo = container.querySelector('header a[aria-label="Go to Today"]')
  expect(logo?.className).toContain('min-h-11')
  expect(logo?.className).toContain('min-w-11')

  fixture.notifications = Promise.resolve({ data: { unread_count: 0 } })
  await act(async () => fixture.refresh?.(() => true))
  expect(bell?.getAttribute('aria-label')).toBe('Notifications')
  expect(bell?.textContent).toBe('')
})

it('renders operator footer link only when operatorUrl is configured and avoids Shimizu link on alternate brands', async () => {
  await act(async () => root.render(<MemoryRouter><Layout /></MemoryRouter>))
  const defaultLink = container.querySelector('aside a[href="https://shimizu-technology.com"]')
  expect(defaultLink?.textContent).toContain('Built by Shimizu Technology')

  vi.stubEnv('VITE_OPERATOR_NAME', 'Actualize')
  vi.resetModules()
  const { Layout: PlainAltLayout } = await import('./Layout')
  await act(async () => root.render(<MemoryRouter><PlainAltLayout /></MemoryRouter>))
  expect(container.querySelector('aside')?.textContent).toContain('Built by Actualize')
  expect(container.querySelector('aside a[href="https://shimizu-technology.com"]')).toBeNull()

  vi.stubEnv('VITE_OPERATOR_URL', 'https://actualize.example')
  vi.resetModules()
  const { Layout: LinkedAltLayout } = await import('./Layout')
  await act(async () => root.render(<MemoryRouter><LinkedAltLayout /></MemoryRouter>))
  const customLink = container.querySelector('aside a[href="https://actualize.example"]')
  expect(customLink?.textContent).toContain('Built by Actualize')
  vi.unstubAllEnvs()
  vi.resetModules()
})
