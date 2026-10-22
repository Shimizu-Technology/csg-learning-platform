// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ChannelMessage, ChannelMessageEvent } from '../../types/api'
import { Messages } from './Messages'

const fixture = vi.hoisted(() => ({ responses: {} as Record<string, unknown>, calls: vi.fn(), emit: null as null | ((event: unknown) => void) }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: { id: 1, full_name: 'Staff', role: 'admin', is_staff: true } }) }))
const setCohort = vi.fn()
vi.mock('../../contexts/CohortContext', () => ({ useCohortContext: () => ({ loading: false, selectedCohortId: 1, setSelectedCohort: setCohort }) }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }))
vi.mock('../../lib/realtime', () => ({ subscribeToUserMessages: vi.fn(async (receive) => { fixture.emit = receive; return Object.assign(vi.fn(), { perform: vi.fn() }) }), isMessageTypingEvent: () => false }))
vi.mock('../../lib/api', () => ({ api: new Proxy({}, { get: (_, key) => async (...args: unknown[]) => { fixture.calls(key, ...args); return { data: fixture.responses[String(key)] ?? null, error: null } } }) }))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const message = (id: number, parent: number | null = null): ChannelMessage => ({ id, channel_id: 2, direct_conversation_id: null, parent_message_id: parent, body: `Message ${id}`, created_at: new Date(2026, 0, 1, 0, id).toISOString(), updated_at: '', edited_at: null, deleted_at: null, pinned_at: null, pinned_by_id: null, mine: false, author: { id: 3, full_name: 'Learner', email: 'l@example.com', role: 'student', avatar_url: null }, attachments: [], reactions: [], mention_user_ids: [] })
let root: Root
let container: HTMLDivElement
let frames: FrameRequestCallback[]
const scroll = vi.fn()
const anchorScroll = vi.fn()
beforeEach(() => {
  fixture.calls.mockClear(); setCohort.mockClear(); frames = []
  fixture.responses = {
    getWorkspaces: { workspaces: [{ id: 1, cohort_id: 1, name: 'Cohort', workspace_type: 'cohort', member_count: 2 }] },
    getChannels: { channels: [{ id: 2, workspace_id: 1, cohort_id: 1, name: 'General', unread_count: 200, last_read_at: null, muted: false }] },
    getDirectConversations: { direct_conversations: [] }, getWorkspace: { workspace: { id: 1, members: [] } }, getAvailableDirectUsers: { users: [] },
  }
  fixture.responses.getChannel = { channel: (fixture.responses.getChannels as { channels: unknown[] }).channels[0], messages: [message(200), message(201)], pinned_messages: [], meta: { oldest_message_id: 200, newest_message_id: 201, has_older: true, has_newer: false } }
  window.matchMedia = vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia
  window.requestAnimationFrame = vi.fn((callback) => { frames.push(callback); return frames.length })
  window.cancelAnimationFrame = vi.fn()
  HTMLElement.prototype.scrollTo = scroll.mockReset().mockImplementation(function (this: HTMLElement, options: ScrollToOptions) { this.scrollTop = Math.max(0, Number(options.top) - this.clientHeight) })
  HTMLElement.prototype.scrollIntoView = anchorScroll.mockReset()
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 2000 })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 500 })
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); window.sessionStorage.clear(); vi.restoreAllMocks() })
async function open(path: string, beforeFrames?: () => void) {
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/messages/:channelId" element={<Messages />} /></Routes></MemoryRouter>))
  if (beforeFrames) await act(async () => beforeFrames())
  for (let i = 0; i < 5; i++) await act(async () => { const pending = frames.splice(0); pending.forEach((callback) => callback(0)) })
}
it('resolves an old root outside the loaded window, opens a long thread and displays the named reply', async () => {
  const replies = Array.from({ length: 80 }, (_, index) => message(index + 110, 1))
  fixture.responses.getMessageDestination = { message_id: 150, thread_root_id: 1, channel_id: 2, direct_conversation_id: null, workspace_id: 1 }
  fixture.responses.getMessageThread = { root_message: { ...message(1), reply_count: 210 }, replies }
  await open('/messages/2?message_id=150')
  expect(fixture.calls).toHaveBeenCalledWith('getMessageDestination', 150)
  expect(fixture.calls).toHaveBeenCalledWith('getMessageThread', 1, { around_message_id: 150, message_limit: 80 })
  expect(fixture.calls).toHaveBeenCalledWith('getChannel', 2, { around_message_id: 1 })
  expect(container.querySelector('#message-150')).not.toBeNull()
  expect(anchorScroll).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' })
  expect(fixture.calls).toHaveBeenCalledWith('markChannelRead', 2, 150)
  expect(fixture.calls.mock.calls.filter(([key]) => key === 'markChannelRead').every(([, , id]) => id === 150)).toBe(true)
}, 15000)
it('highlights a root destination without opening a thread', async () => {
  fixture.responses.getMessageDestination = { message_id: 1, thread_root_id: 1, channel_id: 2, direct_conversation_id: null, workspace_id: 1 }
  ;(fixture.responses.getChannel as { messages: ChannelMessage[] }).messages.unshift(message(1))
  await open('/messages/2?message_id=1')
  expect(container.querySelector('#message-1')).not.toBeNull()
  expect(container.querySelector('[aria-label="Close thread"]')).toBeNull()
  expect(fixture.calls).toHaveBeenCalledWith('markChannelRead', 2, 1)
})
it('opens at latest despite a saved history position and leaves the unread divider available', async () => {
  window.sessionStorage.setItem('csg-message-scroll:1:channel:2', JSON.stringify({ atBottom: false, distanceFromBottom: 1200 }))
  await open('/messages/2', () => {
    const pane = container.querySelector('#message-201')?.closest('.overflow-y-auto')
    pane?.dispatchEvent(new Event('scroll', { bubbles: true }))
  })
  expect(scroll).toHaveBeenCalledWith({ top: 2000, behavior: expect.any(String) })
  expect(container.querySelector('[data-unread-divider]')).not.toBeNull()
})
it('preserves history position on a new arrival and shows the new-message jump', async () => {
  await open('/messages/2')
  const pane = container.querySelector('#message-200')?.closest('.overflow-y-auto') as HTMLElement
  expect(pane).not.toBeNull()
  await act(async () => { pane.dispatchEvent(new Event('wheel', { bubbles: true })); pane.scrollTop = 100; pane.dispatchEvent(new Event('scroll', { bubbles: true })) })
  scroll.mockClear()
  await act(async () => fixture.emit?.({ event: 'created', channel_id: 2, message: message(202) } as ChannelMessageEvent))
  for (let i = 0; i < 3; i++) await act(async () => { frames.splice(0).forEach((callback) => callback(0)) })
  expect(scroll).not.toHaveBeenCalled()
  expect(container.textContent).toContain('New messages')
})
it('does not advance any cursor when a destination cannot resolve', async () => {
  fixture.responses.getMessageThread = null
  await open('/messages/2?message_id=999')
  expect(fixture.calls.mock.calls.filter(([key]) => key === 'markChannelRead')).toHaveLength(0)
})

it('acknowledges the visible latest root without clearing a hidden newer reply', async () => {
  const response = fixture.responses.getChannel as { messages: ChannelMessage[]; meta: { newest_message_id: number } }
  response.messages.push(message(202, 201)); response.meta.newest_message_id = 202
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return { top: this.id.startsWith('message-') ? 100 : 0, bottom: 500, left: 0, right: 100, width: 100, height: 400, x: 0, y: 0, toJSON: () => ({}) }
  })
  await open('/messages/2')
  expect(fixture.calls).toHaveBeenCalledWith('markChannelRead', 2, 201)
  expect(fixture.calls.mock.calls.filter(([key]) => key === 'markChannelRead').every(([, , id]) => id === 201)).toBe(true)
})

it('moves the unread divider back to the opening read cutoff when history loads', async () => {
  const response = fixture.responses.getChannel as { channel: { last_read_at: string }; messages: ChannelMessage[]; meta: { has_older: boolean } }
  response.channel.last_read_at = message(50).created_at
  await open('/messages/2')
  expect(container.querySelector('[data-unread-divider]')?.parentElement?.querySelector('#message-200')).not.toBeNull()
  fixture.responses.getChannel = { ...response, messages: [message(49), message(50), message(51)], meta: { ...response.meta, has_older: false } }
  const earlier = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Load earlier messages')!
  await act(async () => earlier.click())
  expect(container.querySelector('[data-unread-divider]')?.parentElement?.querySelector('#message-51')).not.toBeNull()
})

it.each([true, false])('advances anchored thread reads only after intentional scrolling (desktop=%s)', async (desktop) => {
  window.matchMedia = vi.fn(() => ({ matches: desktop, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia
  fixture.responses.getMessageDestination = { message_id: 150, thread_root_id: 1, channel_id: 2, direct_conversation_id: null, workspace_id: 1 }
  fixture.responses.getMessageThread = { root_message: message(1), replies: [message(150, 1), message(151, 1), message(152, 1)], meta: { has_older: true, has_newer: true, oldest_message_id: 150, newest_message_id: 152 } }
  let displayedId = 151
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const top = this.id.startsWith('message-') ? (this.id === `message-${displayedId}` ? 100 : 900) : 0
    return { top, bottom: top + 500, left: 0, right: 100, width: 100, height: 500, x: 0, y: top, toJSON: () => ({}) }
  })
  await open('/messages/2?message_id=150')
  const pane = container.querySelector('#message-151')?.closest('.overflow-y-auto') as HTMLElement
  fixture.calls.mockClear()
  await act(async () => pane.dispatchEvent(new Event('scroll', { bubbles: true })))
  expect(fixture.calls.mock.calls.filter(([key]) => key === 'markChannelRead')).toHaveLength(0)
  await act(async () => { pane.dispatchEvent(new Event('wheel', { bubbles: true })); pane.dispatchEvent(new Event('scroll', { bubbles: true })) })
  expect(fixture.calls).toHaveBeenCalledWith('markChannelRead', 2, 151)
  displayedId = 150
  fixture.calls.mockClear()
  await act(async () => pane.dispatchEvent(new Event('scroll', { bubbles: true })))
  expect(fixture.calls.mock.calls.filter(([key]) => key === 'markChannelRead')).toHaveLength(0)
})
it('preserves latest and anchor through late image/viewport layout, then relinquishes on intent', async () => {
  const callbacks: ResizeObserverCallback[] = []
  vi.stubGlobal('ResizeObserver', class { constructor(callback: ResizeObserverCallback) { callbacks.push(callback) } observe() {} disconnect() {} })
  const imageMessage = message(201)
  imageMessage.attachments = [{ id: 1, filename: 'large.png', content_type: 'image/png', byte_size: 1, image: true, url: '/late.png' }]
  ;(fixture.responses.getChannel as { messages: ChannelMessage[] }).messages = [message(200), imageMessage]
  await open('/messages/2')
  const image = container.querySelector('img[src="/late.png"]')!
  expect(image.getAttribute('width')).toBe('640')
  expect(image.getAttribute('height')).toBe('360')
  const pane = image.closest('.overflow-y-auto') as HTMLElement
  pane.scrollTop = 0
  await act(async () => callbacks.at(-1)!([], {} as ResizeObserver))
  expect(pane.scrollTop).toBeGreaterThan(0)
  await act(async () => pane.dispatchEvent(new Event('wheel', { bubbles: true })))
  pane.scrollTop = 100
  await act(async () => callbacks.at(-1)!([], {} as ResizeObserver))
  expect(pane.scrollTop).toBe(100)
  vi.unstubAllGlobals()
})

it('keeps a contiguous bounded thread window separate from feed replies and pages both ways', async () => {
  fixture.responses.getMessageDestination = { message_id: 150, thread_root_id: 1, channel_id: 2, direct_conversation_id: null, workspace_id: 1 }
  ;(fixture.responses.getChannel as { messages: ChannelMessage[] }).messages = [message(1), message(20, 1), message(150, 1)]
  fixture.responses.getMessageThread = { root_message: message(1), replies: [message(149, 1), message(150, 1)], meta: { oldest_message_id: 149, newest_message_id: 150, has_older: true, has_newer: true } }
  await open('/messages/2?message_id=150')
  expect(container.querySelector('#message-20')).toBeNull()
  expect(container.querySelector('#message-150')).not.toBeNull()
  expect(fixture.calls.mock.calls.filter(([key]) => key === 'getMessageThread')).toHaveLength(1)
  fixture.responses.getMessageThread = { root_message: message(1), replies: [message(148, 1)], meta: { oldest_message_id: 148, newest_message_id: 148, has_older: false, has_newer: true } }
  await act(async () => Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Load earlier replies')!.click())
  expect(fixture.calls).toHaveBeenCalledWith('getMessageThread', 1, { before_message_id: 149, message_limit: 80 })
  expect(container.querySelector('#message-148')).not.toBeNull()
  fixture.responses.getMessageThread = { root_message: message(1), replies: [message(151, 1)], meta: { oldest_message_id: 151, newest_message_id: 151, has_older: true, has_newer: false } }
  await act(async () => Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Load newer replies')!.click())
  expect(fixture.calls).toHaveBeenCalledWith('getMessageThread', 1, { after_message_id: 150, message_limit: 80 })
  expect(container.querySelector('#message-151')).not.toBeNull()
})

it.each([true, false])('queues historical live replies behind a counted latest action (desktop=%s)', async (desktop) => {
  window.matchMedia = vi.fn(() => ({ matches: desktop, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia
  fixture.responses.getMessageDestination = { message_id: 150, thread_root_id: 1, channel_id: 2, direct_conversation_id: null, workspace_id: 1 }
  fixture.responses.getMessageThread = { root_message: message(1), replies: [message(149, 1), message(150, 1), message(151, 1)], meta: { oldest_message_id: 149, newest_message_id: 151, has_older: true, has_newer: true } }
  await open('/messages/2?message_id=150')
  const pane = container.querySelector('#message-150')!.closest('.overflow-y-auto') as HTMLElement
  await act(async () => { pane.dispatchEvent(new Event('wheel', { bubbles: true })); pane.scrollTop = 100; pane.dispatchEvent(new Event('scroll', { bubbles: true })) })
  fixture.calls.mockClear()
  await act(async () => { fixture.emit?.({ event: 'created', channel_id: 2, message: message(601, 1) }); fixture.emit?.({ event: 'created', channel_id: 2, message: message(601, 1) }) })
  expect(container.querySelector('#message-601')).toBeNull()
  expect(container.textContent).toContain('New replies (1)')
  // Focus/reconnect refreshes must preserve the same contiguous window as Cable.
  fixture.responses.getChannel = { channel: (fixture.responses.getChannels as { channels: unknown[] }).channels[0], messages: [message(1), message(601, 1)], meta: { oldest_message_id: 1, newest_message_id: 601, has_older: true, has_newer: false } }
  await act(async () => window.dispatchEvent(new Event('focus')))
  expect(container.querySelector('#message-601')).toBeNull()
  expect(container.querySelector('#message-150')).not.toBeNull()
  expect(container.textContent).toContain('New replies (1)')
  fixture.responses.getMessageThread = { root_message: message(1), replies: [message(152, 1), message(153, 1)], meta: { oldest_message_id: 152, newest_message_id: 153, has_older: true, has_newer: true } }
  await act(async () => Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Load newer replies')!.click())
  for (let i = 0; i < 3; i++) await act(async () => frames.splice(0).forEach((callback) => callback(0)))
  expect(pane.scrollTop).toBe(100)
  expect(container.querySelector('#message-601')).toBeNull()
  expect(fixture.calls.mock.calls.filter(([key]) => key === 'markChannelRead')).toHaveLength(0)
  fixture.responses.getMessageThread = { root_message: message(1), replies: [message(600, 1), message(601, 1)], meta: { oldest_message_id: 600, newest_message_id: 601, has_older: true, has_newer: false } }
  await act(async () => Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'New replies (1)')!.click())
  for (let i = 0; i < 3; i++) await act(async () => frames.splice(0).forEach((callback) => callback(0)))
  expect(fixture.calls).toHaveBeenCalledWith('getMessageThread', 1, { message_limit: 80 })
  expect(container.querySelector('#message-601')).not.toBeNull()
  expect(container.querySelector('#message-150')).toBeNull()
  expect(container.textContent).not.toContain('New replies (1)')
}, 15000)
