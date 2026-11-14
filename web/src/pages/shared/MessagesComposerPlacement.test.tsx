// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Editor } from '@tiptap/core'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ChannelMessage } from '../../types/api'
import { writeEditorPreferences } from '../../components/shared/MarkdownEditor'
import { Messages } from './Messages'

vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => async () => false }))
const fixture = vi.hoisted(() => ({ responses: {} as Record<string, unknown>, calls: vi.fn() }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: { id: 1, full_name: 'Staff', role: 'admin', is_staff: true } }) }))
vi.mock('../../contexts/CohortContext', () => ({ useCohortContext: () => ({ loading: false, selectedCohortId: 1, setSelectedCohort: vi.fn() }) }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }))
vi.mock('../../lib/realtime', () => ({ subscribeToUserMessages: vi.fn(async () => Object.assign(vi.fn(), { perform: vi.fn() })), isMessageTypingEvent: () => false }))
vi.mock('../../lib/api', () => ({ api: new Proxy({}, { get: (_, key) => async (...args: unknown[]) => { fixture.calls(key, ...args); return { data: await (fixture.responses[String(key)] ?? null), error: null } } }) }))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const message = (id: number, parent: number | null = null): ChannelMessage => ({ id, channel_id: 2, direct_conversation_id: null, parent_message_id: parent, body: `Message ${id}`, created_at: new Date(2026, 0, 1, 0, id).toISOString(), updated_at: '', edited_at: null, deleted_at: null, pinned_at: null, pinned_by_id: null, mine: false, author: { id: 3, full_name: 'Learner', email: 'l@example.com', role: 'student', avatar_url: null }, attachments: [], reactions: [], mention_user_ids: [] })

let root: Root
let container: HTMLDivElement
let frames: FrameRequestCallback[]
let desktop: boolean
let mediaListeners: (() => void)[]

beforeEach(() => {
  window.localStorage.clear()
  fixture.calls.mockClear(); frames = []; desktop = true; mediaListeners = []
  fixture.responses = {
    getWorkspaces: { workspaces: [{ id: 1, cohort_id: 1, name: 'Cohort', workspace_type: 'cohort', member_count: 2 }] },
    getChannels: { channels: [{ id: 2, workspace_id: 1, cohort_id: 1, name: 'General', unread_count: 0, last_read_at: null, muted: false }] },
    getDirectConversations: { direct_conversations: [] }, getWorkspace: { workspace: { id: 1, members: [] } }, getAvailableDirectUsers: { users: [] },
    getMessageDestination: { message_id: 150, thread_root_id: 1, channel_id: 2, direct_conversation_id: null, workspace_id: 1 },
    getMessageThread: { root_message: message(1), replies: [message(150, 1)] },
  }
  fixture.responses.getChannel = { channel: (fixture.responses.getChannels as { channels: unknown[] }).channels[0], messages: [message(1), message(201)], pinned_messages: [], meta: { oldest_message_id: 1, newest_message_id: 201, has_older: false, has_newer: false } }
  window.matchMedia = vi.fn(() => ({
    get matches() { return desktop },
    addEventListener: (_: string, listener: () => void) => { mediaListeners.push(listener) },
    removeEventListener: (_: string, listener: () => void) => { mediaListeners = mediaListeners.filter((item) => item !== listener) },
  })) as unknown as typeof window.matchMedia
  // Frames only run when the test says so: Rich mode's last keystroke stays unwritten until then.
  window.requestAnimationFrame = vi.fn((callback) => { frames.push(callback); return frames.length })
  window.cancelAnimationFrame = vi.fn()
  document.execCommand = vi.fn(() => false)
  HTMLElement.prototype.scrollTo = vi.fn()
  HTMLElement.prototype.scrollIntoView = vi.fn()
  Range.prototype.getClientRects = (() => []) as unknown as Range['getClientRects']
  Range.prototype.getBoundingClientRect = (() => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) })) as Range['getBoundingClientRect']
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  // Dialogs render outside the root: don't let one from an earlier test answer a query.
  document.body.innerHTML = ''
  window.localStorage.clear()
  vi.restoreAllMocks()
})

const runFrames = async () => { for (let i = 0; i < 5; i++) await act(async () => { frames.splice(0).forEach((callback) => callback(0)) }) }
const tick = (ms = 5) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
const editor = () => (container.querySelector('[aria-label="Reply in thread, rich text"]') as HTMLElement & { editor: Editor }).editor
const textarea = () => container.querySelector('textarea[aria-label="Reply in thread, Markdown"]') as HTMLTextAreaElement
const composerText = () => textarea()?.value ?? container.querySelector('[aria-label="Reply in thread, rich text"]')!.textContent

function typeRich(text: string) {
  for (const character of text) {
    act(() => {
      const { view } = editor()
      const { from, to } = view.state.selection
      view.dispatch(view.state.tr.insertText(character, from, to))
    })
  }
}

function typeSource(text: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  act(() => {
    const field = textarea()
    setValue.call(field, field.value + text)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function resize(toDesktop: boolean) {
  desktop = toDesktop
  await act(async () => { mediaListeners.forEach((listener) => listener()) })
}

it.each(['rich', 'markdown'] as const)('keeps every %s keystroke in the thread composer across the 1024px breakpoint (review round 4)', async (mode) => {
  writeEditorPreferences(1, { mode })
  const type = mode === 'rich' ? typeRich : typeSource
  await act(async () => rootRender())
  await runFrames()
  expect(container.querySelector('[aria-label="Close thread"]')).not.toBeNull()

  // A saved draft, then a newer edit that is still pending (no frame, no 250 ms autosave).
  type('saved')
  await runFrames()
  await tick(320)
  type(' pending')
  await resize(false)
  await tick()
  expect(composerText()).toBe('saved pending')

  // And back to desktop, again with an edit pending.
  type(' more')
  await resize(true)
  await tick()
  expect(composerText()).toBe('saved pending more')

  // The new composer's autosave never writes the stale draft over the newer text.
  await runFrames()
  await tick(320)
  const key = Object.keys(window.localStorage).find((item) => item.startsWith('csg-message-draft:'))!
  expect(JSON.parse(window.localStorage.getItem(key)!).body).toBe('saved pending more')
}, 15000)

it.each([
  ['thread', 'Edit message'], ['feed', 'Edit message'], ['thread', 'More message actions'], ['feed', 'More message actions'],
] as const)('a thread root edited from the %s (%s) has one edit surface, and saving sends what was typed there (review round 4)', async (startIn, via) => {
  const mine = { ...message(1), mine: true, body: 'Original root' }
  fixture.responses.getMessageThread = { root_message: mine, replies: [message(150, 1)] }
  ;(fixture.responses.getChannel as { messages: ChannelMessage[] }).messages[0] = mine
  fixture.responses.updateMessage = { message: { ...mine, body: 'Original root edited', edited_at: new Date(2026, 0, 2).toISOString() } }
  await act(async () => rootRender())
  await runFrames()
  const threadPanel = container.querySelector('[aria-label="Close thread"]')!.closest('aside')!
  const rootRows = Array.from(container.querySelectorAll('#message-1'))
  expect(rootRows).toHaveLength(2)
  const startRow = rootRows.find((row) => threadPanel.contains(row) === (startIn === 'thread'))!
  await act(async () => (startRow.querySelector(`button[aria-label="${via}"]`) as HTMLButtonElement).click())
  await runFrames()
  if (via === 'More message actions') {
    // The actions sheet (the narrow thread panel and phones): its Edit opens where the sheet was opened from.
    const sheetEdit = Array.from(container.ownerDocument.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Edit message')!
    await act(async () => sheetEdit.click())
    await runFrames()
  }

  const surfaces = container.querySelectorAll('[aria-label="Edit message, rich text"]')
  expect(surfaces).toHaveLength(1)
  expect(startRow.contains(surfaces[0])).toBe(true)

  const edit = (surfaces[0] as HTMLElement & { editor: Editor }).editor
  act(() => { edit.commands.focus('end'); edit.commands.insertContent(' edited') })
  const save = Array.from(startRow.querySelectorAll('button')).find((button) => button.textContent === 'Save changes')!
  await act(async () => save.click())
  await runFrames()
  expect(fixture.calls).toHaveBeenCalledWith('updateMessage', 1, expect.objectContaining({ body: 'Original root edited' }))
}, 15000)

function rootRender() {
  root.render(<MemoryRouter initialEntries={['/messages/2?message_id=150']}><Routes><Route path="/messages/:channelId" element={<Messages />} /></Routes></MemoryRouter>)
}

it.each(['rich', 'markdown'] as const)('one file dropped on the %s composer is attached once (review round 4)', async (mode) => {
  writeEditorPreferences(1, { mode })
  await act(async () => rootRender())
  await runFrames()
  const target = mode === 'rich'
    ? container.querySelector('[aria-label="Reply in thread, rich text"]') as HTMLElement
    : textarea()
  // ProseMirror finds the drop position from the pointer; jsdom has no layout, so point at the editor.
  document.elementFromPoint = (() => target.querySelector('p') ?? target) as typeof document.elementFromPoint
  const file = new File(['notes'], 'notes.txt', { type: 'text/plain' })
  const drop = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(drop, 'dataTransfer', { value: { files: [file], types: ['Files'], getData: () => '' } })
  Object.assign(drop, { clientX: 1, clientY: 1 })
  await act(async () => { target.dispatchEvent(drop) })
  await runFrames()
  expect(drop.defaultPrevented).toBe(true)
  expect(container.querySelectorAll('button[aria-label="Remove notes.txt"]')).toHaveLength(1)
}, 15000)
