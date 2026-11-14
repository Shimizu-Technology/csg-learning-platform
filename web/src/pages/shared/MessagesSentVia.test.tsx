// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ChannelMessage } from '../../types/api'
import { Messages } from './Messages'

const fixture = vi.hoisted(() => ({ responses: {} as Record<string, unknown> }))
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => async () => false }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: { id: 2, full_name: 'Student', email: 'student@example.com', role: 'student', is_staff: false } }) }))
vi.mock('../../contexts/CohortContext', () => ({ useCohortContext: () => ({ loading: false, selectedCohortId: 1, setSelectedCohort: vi.fn() }) }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }))
vi.mock('../../lib/realtime', () => ({ subscribeToUserMessages: vi.fn(async () => Object.assign(vi.fn(), { perform: vi.fn() })), isMessageTypingEvent: () => false }))
vi.mock('../../lib/api', () => ({ api: new Proxy({}, { get: (_, key) => async () => ({ data: fixture.responses[String(key)] ?? null, error: null }) }) }))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const at = new Date(2026, 0, 1, 9, 0).getTime()
const message = (id: number, body: string, minutes: number, sentVia: string | null): ChannelMessage => ({
  id, channel_id: 2, direct_conversation_id: null, parent_message_id: null, body,
  created_at: new Date(at + minutes * 60_000).toISOString(), updated_at: '', edited_at: null, deleted_at: null, pinned_at: null, pinned_by_id: null,
  mine: false, author: { id: 1, full_name: 'Leon Admin', email: 'admin@example.com', role: 'admin', avatar_url: null }, attachments: [], reactions: [], mention_user_ids: [],
  sent_via_label: sentVia,
})

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  const channel = { id: 2, workspace_id: 1, cohort_id: 1, name: 'General', unread_count: 0, last_read_at: null, latest_message: null, muted: false }
  fixture.responses = {
    getWorkspaces: { workspaces: [{ id: 1, cohort_id: 1, name: 'Cohort', workspace_type: 'cohort', member_count: 2 }] },
    getChannels: { channels: [channel] },
    getDirectConversations: { direct_conversations: [] }, getWorkspace: { workspace: { id: 1, members: [] } }, getAvailableDirectUsers: { users: [] },
    // Same author a minute apart: normally grouped, but a change of sender path must show the header.
    getChannel: { channel, messages: [message(60, 'Typed by hand', 0, null), message(61, 'Posted by assistant', 1, 'Home base')], pinned_messages: [] },
  }
  window.localStorage.clear()
  window.matchMedia = vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia
  window.requestAnimationFrame = ((callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0)) as typeof window.requestAnimationFrame
  window.cancelAnimationFrame = ((id: number) => window.clearTimeout(id)) as typeof window.cancelAnimationFrame
  HTMLElement.prototype.scrollTo = vi.fn()
  HTMLElement.prototype.scrollIntoView = vi.fn()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  window.localStorage.clear()
  vi.restoreAllMocks()
})

it('labels assistant-posted messages and does not fold them into the hand-typed group', async () => {
  await act(async () => root.render(<MemoryRouter initialEntries={['/messages/2']}><Routes><Route path="/messages/:channelId" element={<Messages />} /></Routes></MemoryRouter>))
  await vi.waitFor(() => expect(container.querySelector('#message-61')).not.toBeNull(), { timeout: 3000 })

  const human = container.querySelector('#message-60')!
  const assistant = container.querySelector('#message-61')!
  expect(human.textContent).not.toContain('Sent via')
  expect(assistant.textContent).toContain('Sent via Home base')
  expect(assistant.textContent).toContain('Leon Admin')
  expect(assistant.querySelector('svg.lucide-bot')).not.toBeNull()
})
