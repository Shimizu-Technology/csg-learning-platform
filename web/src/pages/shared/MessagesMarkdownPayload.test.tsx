// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { markdownToEditorDoc, writeEditorPreferences } from '../../components/shared/MarkdownEditor'
import type { ChannelMessage } from '../../types/api'
import { Messages } from './Messages'

const fixture = vi.hoisted(() => ({ responses: {} as Record<string, unknown>, calls: vi.fn() }))
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => async () => false }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: { id: 1, full_name: 'Staff', email: 'staff@example.com', role: 'admin', is_staff: true } }) }))
vi.mock('../../contexts/CohortContext', () => ({ useCohortContext: () => ({ loading: false, selectedCohortId: 1, setSelectedCohort: vi.fn() }) }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }))
vi.mock('../../lib/realtime', () => ({ subscribeToUserMessages: vi.fn(async () => Object.assign(vi.fn(), { perform: vi.fn() })), isMessageTypingEvent: () => false }))
vi.mock('../../lib/api', () => ({ api: new Proxy({}, { get: (_, key) => async (...args: unknown[]) => {
  fixture.calls(key, ...args)
  const response = fixture.responses[String(key)]
  return { data: typeof response === 'function' ? response(...args) : response ?? null, error: null }
} }) }))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * Review round 3: what the composer and the edit box send to the API. Code
 * and locked Markdown must arrive byte for byte; only blank lines between
 * blocks and empty list markers are cleaned.
 */
const FENCED = '```text\nfirst\n\n\n\nsecond\n-\n```'
const INDENTED = '    a\n    -\n    b\n    *\n    > c'
const TABLE = '| a | b |\n| --- | --- |\n| 1 | 2 |'
const TYPED = `${FENCED}\n\n\n\n${INDENTED}\n\n\n\n${TABLE}\n\n-`
const STORED = `${FENCED}\n\n${INDENTED}\n\n${TABLE}`

const own = (body: string): ChannelMessage => ({
  id: 50, channel_id: 2, direct_conversation_id: null, parent_message_id: null, body,
  created_at: new Date(2026, 0, 1).toISOString(), updated_at: '', edited_at: null, deleted_at: null, pinned_at: null, pinned_by_id: null,
  mine: true, author: { id: 1, full_name: 'Staff', email: 'staff@example.com', role: 'admin', avatar_url: null }, attachments: [], reactions: [], mention_user_ids: [],
})

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  fixture.calls.mockClear()
  const channel = { id: 2, workspace_id: 1, cohort_id: 1, name: 'General', unread_count: 0, last_read_at: null, latest_message: null, muted: false }
  fixture.responses = {
    getWorkspaces: { workspaces: [{ id: 1, cohort_id: 1, name: 'Cohort', workspace_type: 'cohort', member_count: 2 }] },
    getChannels: { channels: [channel] },
    getDirectConversations: { direct_conversations: [] }, getWorkspace: { workspace: { id: 1, members: [] } }, getAvailableDirectUsers: { users: [] },
    getChannel: { channel, messages: [own('Old text')], pinned_messages: [] },
    createMessage: (_id: number, payload: { body: string; client_message_id: string }) => ({ message: { ...own(payload.body), id: 51, client_message_id: payload.client_message_id } }),
    updateMessage: (_id: number, payload: { body: string }) => ({ message: own(payload.body) }),
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

async function open() {
  await act(async () => root.render(<MemoryRouter initialEntries={['/messages/2']}><Routes><Route path="/messages/:channelId" element={<Messages />} /></Routes></MemoryRouter>))
  await vi.waitFor(() => expect(container.querySelector('#message-50')).not.toBeNull(), { timeout: 3000 })
  await tick()
}

function setSource(textarea: HTMLTextAreaElement, text: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  act(() => {
    textarea.focus()
    setValue.call(textarea, text)
    textarea.setSelectionRange(text.length, text.length)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const click = (element: Element | null) => act(async () => { (element as HTMLElement).click() })
const bodies = (key: string) => fixture.calls.mock.calls.filter(([name]) => name === key).map(([, , payload]) => (payload as { body: string }).body)

describe('message Markdown reaches the API as typed (review round 3)', () => {
  it('sends typed Markdown with code and a table unchanged, then saves an edit the same way', async () => {
    writeEditorPreferences(1, { mode: 'markdown' })
    await open()
    const composer = container.querySelector('textarea') as HTMLTextAreaElement
    setSource(composer, TYPED)
    await tick()
    await click(container.querySelector('[aria-label="Send message"]'))
    await vi.waitFor(() => expect(bodies('createMessage')).toEqual([STORED]))

    await click(container.querySelector('#message-50 [aria-label="Edit message"]'))
    await tick()
    const edit = container.querySelector('#message-50 textarea') as HTMLTextAreaElement
    expect(edit).not.toBeNull()
    setSource(edit, `Edited\n\n\n\n${TYPED}`)
    await tick()
    await click(Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Save changes'))!)
    await vi.waitFor(() => expect(bodies('updateMessage')).toEqual([`Edited\n\n${STORED}`]))
  })

  it('sends a Rich-mode draft with a code block, indented code and a locked table unchanged', async () => {
    writeEditorPreferences(1, { mode: 'rich' })
    // The draft as the composer saves it: the Rich document converted from the Markdown.
    const { doc, issues } = markdownToEditorDoc(TYPED)
    expect(issues).toEqual(['an indented code block', 'a table'])
    window.localStorage.setItem('csg-message-draft:1:channel:2:root', JSON.stringify({ version: 1, body: TYPED, content: doc }))
    await open()
    await vi.waitFor(() => expect(container.querySelector('.ProseMirror pre')).not.toBeNull())
    await click(container.querySelector('[aria-label="Send message"]'))
    await vi.waitFor(() => expect(bodies('createMessage')).toEqual([STORED]))
  })
})
