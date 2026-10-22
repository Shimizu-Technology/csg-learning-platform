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
  const replies = Array.from({ length: 210 }, (_, index) => message(index + 2, 1))
  fixture.responses.getMessageThread = { root_message: message(1), replies }
  await open('/messages/2?message_id=150')
  expect(fixture.calls).toHaveBeenCalledWith('getMessageThread', 150)
  expect(fixture.calls).toHaveBeenCalledWith('getChannel', 2, { around_message_id: 1 })
  expect(container.querySelector('#message-150')).not.toBeNull()
  expect(anchorScroll).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' })
  expect(fixture.calls).toHaveBeenCalledWith('markChannelRead', 2, 150)
  expect(fixture.calls.mock.calls.filter(([key]) => key === 'markChannelRead').every(([, , id]) => id === 150)).toBe(true)
})
it('highlights a root destination without opening a thread', async () => {
  fixture.responses.getMessageThread = { root_message: message(1), replies: [] }
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
