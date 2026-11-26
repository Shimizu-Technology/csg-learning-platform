// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeEditorPreferences } from '../../components/shared/MarkdownEditor'
import type { ChannelSummary, MessageView as ChannelMessage, MessageSourceSummary } from '../../types/api'
import { Messages } from './Messages'

/**
 * U-4.11, L-2.8 and L-1.8: Messages chrome, real links, copy link to a
 * message, and the record a staff DM is about.
 */
const fixture = vi.hoisted(() => ({
  responses: {} as Record<string, unknown>,
  calls: vi.fn(),
  staff: true,
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => async () => false }))
vi.mock('../../contexts/AuthContext', () => ({
  useAuthContext: () => ({ user: fixture.staff
    ? { id: 1, full_name: 'Audreana', email: 'staff@example.com', role: 'instructor', is_staff: true }
    : { id: 3, full_name: 'Alex Rivera', email: 'alex@example.com', role: 'student', is_staff: false } }),
}))
vi.mock('../../contexts/CohortContext', () => ({ useCohortContext: () => ({ loading: false, selectedCohortId: 1, setSelectedCohort: vi.fn() }) }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => fixture.toast }))
vi.mock('../../lib/realtime', () => ({ subscribeToUserMessages: vi.fn(async () => Object.assign(vi.fn(), { perform: vi.fn() })), isMessageTypingEvent: () => false }))
vi.mock('../../lib/api', () => ({ api: new Proxy({}, { get: (_, key) => async (...args: unknown[]) => {
  fixture.calls(key, ...args)
  const response = fixture.responses[String(key)]
  return { data: typeof response === 'function' ? response(...args) : response ?? null, error: null }
} }) }))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const staffUser = { id: 1, full_name: 'Audreana', role: 'instructor', is_staff: true, avatar_url: null }
const student = { id: 3, full_name: 'Alex Rivera', role: 'student', is_staff: false, avatar_url: null }
const message = (id: number, extra: Partial<ChannelMessage> = {}): ChannelMessage => ({
  id, channel_id: null, direct_conversation_id: 5, parent_message_id: null, body: `Message ${id}`,
  created_at: new Date(2026, 10, 12, 9, id).toISOString(), updated_at: '', edited_at: null, deleted_at: null, pinned_at: null, pinned_by_id: null,
  mine: false, author: { id: 3, full_name: 'Alex Rivera', email: 'alex@example.com', role: 'student', avatar_url: null },
  attachments: [], reactions: [], mention_user_ids: [], ...extra,
})
const submissionSource: MessageSourceSummary = { type: 'submission', id: 812, title: 'Make Decisions with JavaScript', lesson_id: 42, cohort_id: 1, learner_path: '/lessons/42?cohort_id=1#block-7' }

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  fixture.calls.mockClear(); fixture.toast.success.mockClear(); fixture.toast.error.mockClear(); fixture.staff = true
  const dm = { id: 5, workspace_id: 1, workspace_name: 'Cohort 3', workspace_type: 'cohort', cohort_id: 1, title: 'Alex Rivera', users: [staffUser, student], unread_count: 0, last_read_at: null, latest_message: { id: 11, body: 'Message 11', author_name: 'Alex Rivera', created_at: new Date(2026, 10, 12, 9, 11).toISOString() }, muted: false }
  const channel = { id: 2, workspace_id: 1, cohort_id: 1, name: 'Class chat', visibility: 'cohort', unread_count: 0, last_read_at: null, latest_message: null, muted: false }
  fixture.responses = {
    getWorkspaces: { workspaces: [{ id: 1, cohort_id: 1, name: 'Cohort 3', workspace_type: 'cohort', member_count: 2 }, { id: 9, cohort_id: null, name: 'Alumni', workspace_type: 'community', member_count: 4 }] },
    getChannels: { channels: [channel] },
    getDirectConversations: { direct_conversations: [dm] },
    getWorkspace: { workspace: { id: 1, members: [] } }, getAvailableDirectUsers: { users: [] },
    getDirectConversation: { direct_conversation: dm, messages: [message(10), message(11)], pinned_messages: [] },
    getChannel: { channel, messages: [], pinned_messages: [] },
    createDirectMessage: (_id: number, payload: { body: string; client_message_id: string; source_type?: string; source_id?: number }) => ({
      message: message(90 + fixture.calls.mock.calls.filter(([key]) => key === 'createDirectMessage').length, {
        body: payload.body, mine: true, client_message_id: payload.client_message_id, author: { id: 1, full_name: 'Audreana', role: 'instructor', avatar_url: null },
        source: payload.source_type ? submissionSource : null,
      }),
    }),
  }
  window.localStorage.clear()
  window.matchMedia = vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia
  window.requestAnimationFrame = ((callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0)) as typeof window.requestAnimationFrame
  window.cancelAnimationFrame = ((id: number) => window.clearTimeout(id)) as typeof window.cancelAnimationFrame
  document.execCommand = vi.fn(() => false)
  HTMLElement.prototype.scrollTo = vi.fn()
  HTMLElement.prototype.scrollIntoView = vi.fn()
  Range.prototype.getClientRects = (() => []) as unknown as Range['getClientRects']
  Range.prototype.getBoundingClientRect = (() => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) })) as Range['getBoundingClientRect']
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => {}) } })
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

const tick = (ms = 10) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })

function Elsewhere() {
  const location = useLocation()
  return <p data-elsewhere="">{`${location.pathname}${location.search}`}</p>
}

async function open(path = '/messages/dm/5', waitFor = '#message-11') {
  await act(async () => root.render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/messages" element={<Messages />} />
        <Route path="/messages/:channelId" element={<Messages />} />
        <Route path="/messages/dm/:dmId" element={<Messages />} />
        <Route path="*" element={<Elsewhere />} />
      </Routes>
    </MemoryRouter>,
  ))
  await vi.waitFor(() => expect(container.querySelector(waitFor)).not.toBeNull(), { timeout: 3000 })
  await tick()
}

const link = (name: string) => Array.from(container.querySelectorAll<HTMLAnchorElement>('a')).find((anchor) => anchor.textContent?.trim() === name)
const click = (element: Element | null | undefined, init: MouseEventInit = {}) => act(async () => {
  element!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init }))
})

function type(text: string) {
  const textarea = container.querySelector('textarea') as HTMLTextAreaElement
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  act(() => {
    textarea.focus()
    setValue.call(textarea, text)
    textarea.setSelectionRange(text.length, text.length)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const send = () => container.querySelector<HTMLButtonElement>('[aria-label="Send message"]')!

describe('inbox chrome (U-4.11)', () => {
  it('has a one-line header with the only workspace switcher, and lists each conversation once as a link', async () => {
    await open()
    const header = container.querySelector('[data-testid="inbox-header"]')!
    expect(header.querySelector('h1')?.textContent).toBe('Messages')
    expect(header.querySelector('[aria-label^="Switch cohort or community: Cohort 3"]')).not.toBeNull()
    expect(header.querySelector('[aria-label="Search messages"]')).not.toBeNull()
    expect(header.querySelector('[aria-label="New direct message"]')).not.toBeNull()
    expect(header.querySelector('[aria-label="Inbox options"]')).not.toBeNull()
    expect(container.querySelectorAll('[aria-label^="Switch cohort or community"]')).toHaveLength(1)
    // The old header cards and second channel list are gone.
    expect(container.textContent).not.toContain('Browse channels')
    expect(container.textContent).not.toContain('Cohort workspace ·')
    const rows = Array.from(container.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Cohort 3 conversations"] a'))
    expect(rows.map((row) => row.getAttribute('href'))).toEqual(['/messages/dm/5', '/messages/2'])
    expect(rows.filter((row) => row.textContent?.includes('Class chat'))).toHaveLength(1)
    expect(rows[0].getAttribute('aria-current')).toBe('page')
  })

  it('opens a row in place on a plain click and leaves ⌘/Ctrl-click and middle-click to the browser', async () => {
    await open()
    const row = container.querySelector<HTMLAnchorElement>('nav a[href="/messages/2"]')!
    const modified = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, metaKey: true })
    let handledByApp: boolean | null = null
    // Record what the app did, then stop jsdom from attempting a real navigation.
    const record = (event: Event) => { handledByApp = event.defaultPrevented; event.preventDefault() }
    window.addEventListener('click', record)
    await act(async () => { row.dispatchEvent(modified) })
    window.removeEventListener('click', record)
    expect(handledByApp).toBe(false)
    expect(fixture.calls).not.toHaveBeenCalledWith('getChannel', 2, expect.anything())
    await click(row)
    await vi.waitFor(() => expect(fixture.calls.mock.calls.some(([key, id]) => key === 'getChannel' && id === 2)).toBe(true))
  })

  it('makes Send a clear button that says why it can\'t send yet, then fills in when there is text', async () => {
    writeEditorPreferences(1, { mode: 'markdown' })
    await open()
    expect(send().getAttribute('aria-disabled')).toBe('true')
    expect(send().hasAttribute('disabled')).toBe(false)
    expect(send().dataset.sendState).toBe('blocked')
    expect(document.getElementById(send().getAttribute('aria-describedby')!)?.textContent).toBe('Write a message or attach a file to send.')
    await click(send())
    expect(fixture.calls).not.toHaveBeenCalledWith('createDirectMessage', expect.anything(), expect.anything())
    type('Hello')
    expect(send().hasAttribute('aria-disabled')).toBe(false)
    expect(send().dataset.sendState).toBe('ready')
    expect(send().dataset.variant).toBe('primary')
  })
})

describe('composer focus (U-4.11)', () => {
  it('shows one focus ring, on the composer frame, not a second one on the typing area', async () => {
    await open()
    const frame = container.querySelector('[data-md-editor]')!
    expect(frame.className).toContain('focus-within:ring-1')
    expect(frame.className).not.toContain('ring-focus/25')
    const css = readFileSync(resolve(__dirname, '../../index.css'), 'utf8').replace(/\s+/g, ' ')
    expect(css).toContain("[data-md-editor] .md-editor-surface:focus-visible, [data-md-editor] textarea:focus-visible, [data-md-editor] [role='region']:focus-visible { outline: none; }")
  })
})

describe('conversation header (U-4.11, L-2.8)', () => {
  it('gives the name room: icon actions and ⋯, with the student and cohort as real links', async () => {
    await open()
    const header = container.querySelector('section header')!
    // No full-width text buttons squeezing the name.
    expect(header.textContent).not.toContain('Student context')
    expect(header.textContent).not.toContain('Mute conversation')
    expect(header.querySelector('[aria-label="Mute conversation"]')).not.toBeNull()
    expect(header.querySelector('[aria-label="Conversation options"]')).not.toBeNull()
    expect(link('Alex Rivera')?.getAttribute('href')).toBe('/admin/cohorts/1/students/3/overview')
    expect(link('Cohort 3')?.getAttribute('href')).toBe('/admin/cohorts/1')
    await click(link('Cohort 3'))
    expect(container.querySelector('[data-elsewhere]')?.textContent).toBe('/admin/cohorts/1')
  })

  it('copies a link to the conversation from ⋯', async () => {
    await open()
    await click(container.querySelector('[aria-label="Conversation options"]'))
    await click(Array.from(container.querySelectorAll('[role="menuitem"]')).find((item) => item.textContent === 'Copy link to conversation'))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`${window.location.origin}/messages/dm/5`)
    expect(fixture.toast.success).toHaveBeenCalledWith('Link to conversation copied')
  })

  it('offers a safe return to the scoped Today inbox', async () => {
    await open('/messages/dm/5?return_to=%2Fadmin%3Fcohort_id%3D4')
    expect(Array.from(container.querySelectorAll('a')).find(a => a.textContent === 'Back to Today')?.getAttribute('href')).toBe('/admin?cohort_id=4')
  })

  it('keeps the help queue as the source record\'s way back', async () => {
    await open('/messages/dm/5?source_type=help_request&source_id=9&source_label=Loops&source_return_to=%2Fadmin%2Fsupport%3Fview%3Dactive')
    const banner = Array.from(container.querySelectorAll('a')).find((anchor) => anchor.textContent?.includes('From help request: Loops'))
    expect(banner?.getAttribute('href')).toBe('/admin/help-requests/9?return_to=%2Fadmin%2Fsupport%3Fview%3Dactive')
  })

  it('names a follow-up plan source and links back to the plan (L-2.5)', async () => {
    await open('/messages/dm/5?source_type=intervention&source_id=61&source_label=Alex+Rivera&source_return_to=%2Fadmin%2Fsupport')
    const banner = Array.from(container.querySelectorAll('a')).find((anchor) => anchor.textContent?.includes('From follow-up plan: Alex Rivera'))
    expect(banner?.getAttribute('href')).toBe('/admin/interventions/61?return_to=%2Fadmin%2Fsupport')
  })
})

describe('copy link to message (L-2.8)', () => {
  it('copies a deep link from the hover actions and from the phone actions sheet', async () => {
    await open()
    await click(container.querySelector('#message-10 [aria-label="Copy link to message"]'))
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(`${window.location.origin}/messages/dm/5?message_id=10`)
    expect(fixture.toast.success).toHaveBeenLastCalledWith('Link to message copied')
    await click(container.querySelector('#message-11 [aria-label="Open message actions"]'))
    const sheetAction = Array.from(document.querySelectorAll('[role="dialog"] button')).find((button) => button.textContent === 'Copy link to message')
    await click(sheetAction)
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(`${window.location.origin}/messages/dm/5?message_id=11`)
  })
})

describe('links inside messages (L-2.8)', () => {
  it('opens links to this app in place and other sites in a new tab', async () => {
    const getDirectConversation = fixture.responses.getDirectConversation as { messages: ChannelMessage[] }
    getDirectConversation.messages = [message(10), message(11, { body: `See [Loops](${window.location.origin}/lessons/42?cohort_id=1) or [MDN](https://developer.mozilla.org/)` })]
    await open()
    const inApp = link('Loops')!
    expect(inApp.getAttribute('href')).toBe('/lessons/42?cohort_id=1')
    expect(inApp.hasAttribute('target')).toBe(false)
    const external = link('MDN')!
    expect(external.getAttribute('target')).toBe('_blank')
    expect(external.getAttribute('rel')).toBe('noopener noreferrer')
    await click(inApp)
    expect(container.querySelector('[data-elsewhere]')?.textContent).toBe('/lessons/42?cohort_id=1')
  })
})

describe('what a staff DM is about (L-1.8)', () => {
  it('attaches the record staff opened the conversation from to the first message only', async () => {
    writeEditorPreferences(1, { mode: 'markdown' })
    await open('/messages/dm/5?source_type=submission&source_id=812&source_label=Make+Decisions+with+JavaScript')
    type('Nice work on the ticket prices')
    await click(send())
    await vi.waitFor(() => expect(fixture.calls).toHaveBeenCalledWith('createDirectMessage', 5, expect.objectContaining({ source_type: 'submission', source_id: 812 })))
    await tick()
    type('One more thing')
    await click(send())
    await vi.waitFor(() => expect(fixture.calls.mock.calls.filter(([key]) => key === 'createDirectMessage')).toHaveLength(2))
    const second = fixture.calls.mock.calls.filter(([key]) => key === 'createDirectMessage')[1][2] as Record<string, unknown>
    expect(second).not.toHaveProperty('source_type')
    const line = container.querySelector('[data-message-source]')!
    expect(line.textContent).toBe('About Make Decisions with JavaScript · Submission #812')
    expect(line.querySelector('a')?.getAttribute('href')).toBe('/admin/submissions/812?cohort_id=1')
    expect(container.querySelectorAll('[data-message-source]')).toHaveLength(1)
  })

  it('shows the learner a link to their own lesson, not the staff record', async () => {
    fixture.staff = false
    const getDirectConversation = fixture.responses.getDirectConversation as { messages: ChannelMessage[] }
    getDirectConversation.messages = [message(10), message(11, { source: submissionSource, author: { id: 1, full_name: 'Audreana', role: 'instructor', avatar_url: null } })]
    await open()
    const line = container.querySelector('[data-message-source]')!
    expect(line.textContent).toBe('About Make Decisions with JavaScript · your submission')
    expect(line.querySelector('a')?.getAttribute('href')).toBe('/lessons/42?cohort_id=1#block-7')
    expect(container.innerHTML).not.toContain('/admin/')
  })
})

describe('a failed send keeps what it is about (L-1.8)', () => {
  const sourceUrl = '/messages/dm/5?source_type=submission&source_id=812&source_label=Make+Decisions+with+JavaScript'
  const sends = () => fixture.calls.mock.calls.filter(([key]) => key === 'createDirectMessage').map((call) => call[2] as Record<string, unknown>)
  const button = (name: string) => Array.from(container.querySelectorAll('button')).find((item) => item.textContent?.trim() === name)

  /**
   * The server keeps the first send per client id: a retry with the same id
   * and source replays it, a different source is a conflict (no data). The
   * first `failures` sends commit but never answer, as on a dropped connection.
   */
  function serverThatDrops(failures: number) {
    const committed = new Map<string, string>()
    let calls = 0
    fixture.responses.createDirectMessage = (_id: number, payload: { body: string; client_message_id: string; source_type?: string; source_id?: number }) => {
      calls += 1
      const sourceKey = payload.source_type ? `${payload.source_type}:${payload.source_id}` : ''
      if (committed.has(payload.client_message_id) && committed.get(payload.client_message_id) !== sourceKey) return null
      committed.set(payload.client_message_id, sourceKey)
      if (calls <= failures) return null
      return { message: message(90 + calls, {
        body: payload.body, mine: true, client_message_id: payload.client_message_id, author: { id: 1, full_name: 'Audreana', role: 'instructor', avatar_url: null },
        source: payload.source_type ? submissionSource : null,
      }) }
    }
  }

  it('saves the source with the failure, restores it after a reload, and retries with the same id and source', async () => {
    writeEditorPreferences(1, { mode: 'markdown' })
    serverThatDrops(1)
    await open(sourceUrl)
    type('Nice work on the ticket prices')
    await click(send())
    await vi.waitFor(() => expect(button('Retry')).toBeDefined())
    const [first] = sends()
    expect(first).toMatchObject({ source_type: 'submission', source_id: 812 })
    const stored = JSON.parse(window.localStorage.getItem('csg-message-failures:1:dm:5') || '[]')
    expect(stored[0]).toMatchObject({ clientMessageId: first.client_message_id, source: { type: 'submission', id: 812, title: 'Make Decisions with JavaScript' } })

    // Reload: the failure comes back from storage with its source.
    await act(async () => root.unmount())
    root = createRoot(container)
    await open(sourceUrl)
    await vi.waitFor(() => expect(button('Retry')).toBeDefined())
    expect(container.querySelector('[data-message-source]')?.textContent).toContain('Make Decisions with JavaScript')
    await click(button('Retry'))
    await vi.waitFor(() => expect(sends()).toHaveLength(2))
    // Same client id and same source, so the committed message replays instead of a 409.
    expect(sends()[1]).toMatchObject({ client_message_id: first.client_message_id, source_type: 'submission', source_id: 812 })
    await vi.waitFor(() => expect(button('Retry')).toBeUndefined())
    expect(window.localStorage.getItem('csg-message-failures:1:dm:5')).toBeNull()
    expect(fixture.toast.error).toHaveBeenCalledTimes(1)
  })

  it('keeps the source on a retry that fails again', async () => {
    writeEditorPreferences(1, { mode: 'markdown' })
    fixture.responses.createDirectMessage = () => null
    await open(sourceUrl)
    type('Nice work')
    await click(send())
    await vi.waitFor(() => expect(button('Retry')).toBeDefined())
    await click(button('Retry'))
    await vi.waitFor(() => expect(sends()).toHaveLength(2))
    await vi.waitFor(() => expect(button('Retry')).toBeDefined())
    expect(sends()[1]).toMatchObject({ client_message_id: sends()[0].client_message_id, source_type: 'submission', source_id: 812 })
    const stored = JSON.parse(window.localStorage.getItem('csg-message-failures:1:dm:5') || '[]')
    expect(stored).toHaveLength(1)
    expect(stored[0].source).toEqual({ type: 'submission', id: 812, title: 'Make Decisions with JavaScript' })
  })

  it('gives the context to the next message when a failed send is discarded', async () => {
    writeEditorPreferences(1, { mode: 'markdown' })
    serverThatDrops(1)
    await open(sourceUrl)
    type('First try')
    await click(send())
    await vi.waitFor(() => expect(button('Discard')).toBeDefined())
    await click(button('Discard'))
    expect(container.querySelector('[data-message-source]')).toBeNull()
    type('Second try')
    await click(send())
    await vi.waitFor(() => expect(sends()).toHaveLength(2))
    expect(sends()[1]).toMatchObject({ body: 'Second try', source_type: 'submission', source_id: 812 })
    expect(sends()[1].client_message_id).not.toBe(sends()[0].client_message_id)
    await tick()
    // Once that send succeeds, the context has gone out: the next message is plain.
    type('Third')
    await click(send())
    await vi.waitFor(() => expect(sends()).toHaveLength(3))
    expect(sends()[2]).not.toHaveProperty('source_type')
  })

  it('holds the context while a failure can still be retried, and frees it once that failure is gone', async () => {
    writeEditorPreferences(1, { mode: 'markdown' })
    serverThatDrops(1)
    await open(sourceUrl)
    type('First try')
    await click(send())
    await vi.waitFor(() => expect(button('Retry')).toBeDefined())
    // A send while the failure is still retryable doesn't duplicate the context.
    type('Unrelated')
    await click(send())
    await vi.waitFor(() => expect(sends()).toHaveLength(2))
    expect(sends()[1]).not.toHaveProperty('source_type')
    await tick()
    await click(button('Discard'))
    type('Again')
    await click(send())
    await vi.waitFor(() => expect(sends()).toHaveLength(3))
    expect(sends()[2]).toMatchObject({ source_type: 'submission', source_id: 812 })
  })
})

describe('source chip (L-1.8)', () => {
  it('makes the whole chip the link, 44px tall on phones and compact on desktop', async () => {
    fixture.staff = false
    const getDirectConversation = fixture.responses.getDirectConversation as { messages: ChannelMessage[] }
    getDirectConversation.messages = [message(10), message(11, { source: submissionSource })]
    await open()
    const chip = container.querySelector('[data-message-source] > a')!
    expect(chip.getAttribute('href')).toBe('/lessons/42?cohort_id=1#block-7')
    expect(chip.textContent).toBe('About Make Decisions with JavaScript · your submission')
    expect(chip.className).toContain('min-h-11')
    expect(chip.className).toContain('sm:min-h-0')
    expect(container.querySelectorAll('[data-message-source] a')).toHaveLength(1)
  })

  it('shows a lesson the learner can\'t open yet as plain text', async () => {
    fixture.staff = false
    const getDirectConversation = fixture.responses.getDirectConversation as { messages: ChannelMessage[] }
    getDirectConversation.messages = [message(10), message(11, { source: { type: 'lesson', id: null, title: '', lesson_id: null, cohort_id: 1, learner_path: null } })]
    await open()
    const line = container.querySelector('[data-message-source]')!
    expect(line.textContent).toBe('About a lesson')
    expect(line.querySelector('a')).toBeNull()
  })
})

describe('jump to latest (U-4.11)', () => {
  it('sits in the corner and the feed makes room for it instead of covering the last message', async () => {
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 2000 })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 500 })
    try {
      await open()
      const pane = container.querySelector('#message-10')!.closest('.overflow-y-auto') as HTMLElement
      pane.scrollTop = 0
      await act(async () => { pane.dispatchEvent(new Event('wheel', { bubbles: true })); pane.dispatchEvent(new Event('scroll', { bubbles: true })) })
      const jump = container.querySelector('[data-jump-latest]')!
      expect(jump).not.toBeNull()
      expect(jump.className).toContain('right-3')
      expect(jump.className).not.toContain('-translate-x-1/2')
      expect(pane.className).toContain('pb-16')
    } finally {
      delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight
      delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight
    }
  })
})

describe('composer power interactions', () => {
  it('opens inline edit on the latest own message when pressing ArrowUp in an empty composer', async () => {
    writeEditorPreferences(1, { mode: 'markdown' })
    const getDirectConversation = fixture.responses.getDirectConversation as { messages: ChannelMessage[] }
    getDirectConversation.messages = [
      message(10),
      message(11, { body: 'My last reply', mine: true, author: { id: 1, full_name: 'Audreana', email: 'staff@example.com', role: 'instructor', avatar_url: null } }),
    ]
    await open()
    const composer = container.querySelector('textarea') as HTMLTextAreaElement
    expect(composer).not.toBeNull()
    act(() => {
      composer.focus()
      composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }))
    })
    await vi.waitFor(() => expect(container.querySelector('#message-11 textarea')?.textContent).toBe('My last reply'))
  })

  it('shows a thumbnail preview for pending image attachments before send', async () => {
    const createObjectURL = vi.fn(() => 'blob:mock-screenshot')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
    await open()
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
    const file = new File(['png-bytes'], 'terminal-error.png', { type: 'image/png' })
    Object.defineProperty(input, 'files', { configurable: true, value: [file] })
    act(() => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const previewImg = container.querySelector<HTMLImageElement>('[data-pending-attachments] img')
    expect(previewImg).not.toBeNull()
    expect(previewImg?.getAttribute('src')).toBe('blob:mock-screenshot')
    expect(previewImg?.getAttribute('alt')).toBe('terminal-error.png')
    await click(container.querySelector('[aria-label="Remove terminal-error.png"]'))
    expect(container.querySelector('[data-pending-attachments]')).toBeNull()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-screenshot')
  })
})

describe('premium chat inbox, header, reactions, media, and threads', () => {
  it('renders user avatars in inbox rows and conversation header, plus Draft badges and filter pills', async () => {
    window.localStorage.setItem(
      'csg-message-draft:1:channel:2:root',
      JSON.stringify({ version: 1, body: 'Remember to push before class', content: { type: 'doc', content: [] } }),
    )
    await open()
    const header = container.querySelector('section header')!
    expect(header.querySelector('[data-avatar]')).not.toBeNull()
    const dmRow = container.querySelector('nav a[href="/messages/dm/5"]')!
    expect(dmRow.querySelector('[data-avatar]')).not.toBeNull()
    const channelRow = container.querySelector('nav a[href="/messages/2"]')!
    expect(channelRow.querySelector('[data-draft-preview]')?.textContent).toContain('Draft: Remember to push before class')

    // Filter pills switch between Direct and Group chats.
    const filterGroup = container.querySelector('[aria-label="Filter conversations"]')!
    const directBtn = Array.from(filterGroup.querySelectorAll('button')).find((b) => b.textContent === 'Direct')!
    await click(directBtn)
    expect(container.querySelectorAll('nav a')).toHaveLength(1)
    expect(container.querySelector('nav a')?.getAttribute('href')).toBe('/messages/dm/5')

    const groupBtn = Array.from(filterGroup.querySelectorAll('button')).find((b) => b.textContent === 'Group chats')!
    await click(groupBtn)
    expect(container.querySelectorAll('nav a')).toHaveLength(1)
    expect(container.querySelector('nav a')?.getAttribute('href')).toBe('/messages/2')
  })

  it('toggles a reaction pill in one click and opens Who reacted from the details button', async () => {
    const getDirectConversation = fixture.responses.getDirectConversation as { messages: ChannelMessage[] }
    const reactedMsg = message(11, {
      reactions: [{ emoji: '\u{1F44D}', count: 1, reacted: false, users: [{ id: 3, full_name: 'Alex Rivera', avatar_url: null }] }],
    })
    getDirectConversation.messages = [message(10), reactedMsg]
    fixture.responses.reactMessage = {
      message: {
        ...reactedMsg,
        reactions: [{ emoji: '\u{1F44D}', count: 2, reacted: true, users: [{ id: 3, full_name: 'Alex Rivera', avatar_url: null }, { id: 1, full_name: 'Audreana', avatar_url: null }] }],
      },
    }
    await open()
    const pill = container.querySelector('#message-11 [aria-label^="Thumbs up: 1"]') as HTMLButtonElement
    expect(pill).not.toBeNull()
    await click(pill)
    expect(fixture.calls).toHaveBeenCalledWith('reactMessage', 11, '\u{1F44D}')
    const whoBtn = container.querySelector('#message-11 [aria-label="Who reacted"]') as HTMLButtonElement
    await click(whoBtn)
    expect(document.body.textContent).toContain('Who reacted')
  })

  it('shows inline pin button in header when pins exist, natural aspect ratio for single images, and Slack-style thread summary', async () => {
    const getDirectConversation = fixture.responses.getDirectConversation as { messages: ChannelMessage[]; pinned_messages: ChannelMessage[] }
    const pinned = message(10, { pinned_at: new Date().toISOString() })
    const rootWithImageAndReply = message(11, {
      reply_count: 1,
      attachments: [{ id: 501, filename: 'error.png', content_type: 'image/png', byte_size: 4096, image: true, url: 'https://example.com/error.png' }],
    })
    const reply = message(12, { parent_message_id: 11, body: 'Try git restore first' })
    getDirectConversation.messages = [pinned, rootWithImageAndReply, reply]
    getDirectConversation.pinned_messages = [pinned]
    await open()

    // Inline pin shortcut in header has a stable accessible name paired with aria-pressed.
    const pinButton = container.querySelector('section header [aria-label="Pinned messages (1)"]')
    expect(pinButton).not.toBeNull()
    expect(pinButton?.getAttribute('aria-pressed')).toBe('false')

    // Natural-aspect-ratio single image (no aspect-video crop).
    const img = container.querySelector('#message-11 img') as HTMLImageElement
    expect(img).not.toBeNull()
    expect(img.className).toContain('object-contain')
    expect(img.className).not.toContain('aspect-video')

    // Thread summary bar shows reply count and participant avatar.
    const threadBtn = Array.from(container.querySelectorAll('#message-11 button')).find((b) => b.textContent?.includes('1 reply'))!
    expect(threadBtn).toBeTruthy()
    expect(threadBtn.querySelector('[data-avatar]')).not.toBeNull()
  })

  it('guards Alt+Arrow shortcuts in editable inputs and cycles only visible filtered conversations', async () => {
    await open()
    // Focus composer surface: Alt+ArrowDown must NOT switch away from DM 5.
    const editor = container.querySelector('[data-md-editor] .md-editor-surface') as HTMLElement
    editor.focus()
    act(() => {
      editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true }))
    })
    expect(container.querySelector('nav a[data-selected="true"]')?.getAttribute('href')).toBe('/messages/dm/5')

    // Filter to Direct only (1 conversation visible): Alt+ArrowDown from body must NOT open the hidden group chat.
    const filterGroup = container.querySelector('[aria-label="Filter conversations"]')!
    const directBtn = Array.from(filterGroup.querySelectorAll('button')).find((b) => b.textContent === 'Direct')!
    await click(directBtn)
    ;(document.activeElement as HTMLElement | null)?.blur()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true }))
    })
    expect(container.querySelector('nav a[data-selected="true"]')?.getAttribute('href')).toBe('/messages/dm/5')
  })

  it('attributes You: strictly by author_id and clears phantom thread summaries when the last reply is deleted', async () => {
    const getChannels = fixture.responses.getChannels as { channels: ChannelSummary[] }
    getChannels.channels = [
      {
        ...getChannels.channels[0],
        // Same display name as viewer (Audreana) but different author_id: must NOT show "You:".
        latest_message: { id: 901, body: 'Hello from another Audreana', created_at: new Date().toISOString(), author_id: 99, author_name: 'Audreana' },
      },
    ]
    const getDirectConversation = fixture.responses.getDirectConversation as { messages: ChannelMessage[] }
    const rootMsg = message(11, { reply_count: 1 })
    const onlyReply = message(12, { parent_message_id: 11, body: 'Only reply', mine: true })
    getDirectConversation.messages = [rootMsg, onlyReply]
    fixture.responses.getMessageThread = {
      root_message: rootMsg,
      replies: [onlyReply],
      meta: { oldest_message_id: 12, newest_message_id: 12, has_older: false, has_newer: false },
    }
    fixture.responses.deleteMessage = { deleted: true }

    await open()
    const channelRow = container.querySelector('nav a[href="/messages/2"]')!
    expect(channelRow.textContent).toContain('Audreana: Hello from another Audreana')
    expect(channelRow.textContent).not.toContain('You: Hello from another Audreana')

    // Open thread and delete the only reply -> phantom "1 reply" summary disappears from the feed.
    const threadBtn = Array.from(container.querySelectorAll('#message-11 button')).find((b) => b.textContent?.includes('1 reply'))!
    await click(threadBtn)
    const threadDeleteBtn = container.querySelector('aside #message-12 [aria-label="Delete message"]') as HTMLButtonElement
    await click(threadDeleteBtn)
    const confirmDelete = Array.from(document.querySelectorAll('[role="dialog"] button')).find((b) => b.textContent === 'Delete message') as HTMLButtonElement
    await click(confirmDelete)
    expect(container.querySelector('#message-11')?.textContent).not.toContain('1 reply')
  })

  it('closes the image lightbox on Escape without closing the open desktop thread panel', async () => {
    const getDirectConversation = fixture.responses.getDirectConversation as { messages: ChannelMessage[] }
    const rootMsg = message(11, {
      reply_count: 1,
      attachments: [{ id: 501, filename: 'error.png', content_type: 'image/png', byte_size: 4096, image: true, url: 'https://example.com/error.png' }],
    })
    const reply = message(12, { parent_message_id: 11, body: 'Looks good' })
    getDirectConversation.messages = [rootMsg, reply]
    fixture.responses.getMessageThread = {
      root_message: rootMsg,
      replies: [reply],
      meta: { oldest_message_id: 12, newest_message_id: 12, has_older: false, has_newer: false },
    }
    await open()

    // Open desktop thread panel, then open image lightbox.
    const threadBtn = Array.from(container.querySelectorAll('#message-11 button')).find((b) => b.textContent?.includes('1 reply'))!
    await click(threadBtn)
    expect(container.querySelector('[aria-label="Close thread"]')).not.toBeNull()

    const imgBtn = container.querySelector('#message-11 [aria-label="Open image error.png"]') as HTMLButtonElement
    await click(imgBtn)
    expect(document.querySelector('[aria-label="Close image preview"]')).not.toBeNull()

    // First Escape closes lightbox ONLY; thread panel stays open.
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
    expect(document.querySelector('[aria-label="Close image preview"]')).toBeNull()
    expect(container.querySelector('[aria-label="Close thread"]')).not.toBeNull()

    // Second Escape closes the desktop thread panel.
    ;(document.activeElement as HTMLElement | null)?.blur()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
    expect(container.querySelector('[aria-label="Close thread"]')).toBeNull()
  })

  it('does not crash when window.localStorage getter throws', async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Blocked', 'SecurityError')
      },
    })
    try {
      await open()
      expect(container.querySelector('nav a[href="/messages/dm/5"]')).not.toBeNull()
    } finally {
      if (originalDescriptor) Object.defineProperty(window, 'localStorage', originalDescriptor)
    }
  })
})
