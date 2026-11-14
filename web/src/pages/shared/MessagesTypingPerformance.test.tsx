// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Editor } from '@tiptap/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const counters = vi.hoisted(() => ({ messageRows: 0, typing: [] as boolean[] }))

vi.mock('../../lib/useMessageLongPress', () => ({
  // Every MessageRow calls this hook once per render, so it counts message-list renders.
  useMessageLongPress: () => {
    counters.messageRows += 1
    return {}
  },
}))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: { id: 1, full_name: 'Staff', email: 'staff@example.com', role: 'admin', is_staff: true } }) }))
vi.mock('../../contexts/CohortContext', () => ({ useCohortContext: () => ({ loading: false, selectedCohortId: 1, setSelectedCohort: vi.fn() }) }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }))
vi.mock('../../lib/realtime', () => ({
  subscribeToUserMessages: vi.fn(async () => Object.assign(vi.fn(), {
    perform: vi.fn((action: string, payload: { active: boolean }) => {
      if (action === 'typing') counters.typing.push(payload.active)
      return true
    }),
  })),
  isMessageTypingEvent: () => false,
}))
vi.mock('../../lib/api', () => {
  const workspace = { id: 1, cohort_id: 1, name: 'Cohort', workspace_type: 'cohort', member_count: 2, can_manage: false }
  const channel = { id: 2, workspace_id: 1, cohort_id: 1, name: 'General', unread_count: 0, last_read_at: null, latest_message: null, muted: false }
  const author = { id: 4, full_name: 'Lance', role: 'student', avatar_url: null }
  const messages = Array.from({ length: 30 }, (_, index) => ({
    id: index + 1, channel_id: 2, direct_conversation_id: null, parent_message_id: null, body: `Message **${index + 1}** with \`code\``,
    mention_user_ids: [], edited_at: null, deleted_at: null, pinned_at: null, pinned_by_id: null,
    created_at: new Date(Date.UTC(2026, 10, 15, 0, index)).toISOString(), updated_at: new Date(Date.UTC(2026, 10, 15, 0, index)).toISOString(),
    mine: false, attachments: [], reactions: [], author,
  }))
  return { api: new Proxy({}, { get: (_, key) => vi.fn(async () => {
    const responses: Record<string, unknown> = {
      getWorkspaces: { workspaces: [workspace] }, getChannels: { channels: [channel] },
      getDirectConversations: { direct_conversations: [] },
      getWorkspace: { workspace: { ...workspace, members: [] } },
      getAvailableDirectUsers: { users: [] },
      getChannel: { channel, messages, pinned_messages: [] },
    }
    return { data: responses[String(key)] || null, error: null }
  }) }) }
})

import { Messages } from './Messages'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  window.matchMedia = vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia
  window.requestAnimationFrame = ((callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0)) as typeof window.requestAnimationFrame
  window.cancelAnimationFrame = ((id: number) => window.clearTimeout(id)) as typeof window.cancelAnimationFrame
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.scrollTo = vi.fn() as unknown as Element['scrollTo']
  window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return [] } } as unknown as typeof IntersectionObserver
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('Messages composer typing performance', () => {
  it('typing a message re-renders the composer, not the message list', async () => {
    await act(async () => root.render(
      <MemoryRouter initialEntries={['/messages/2']}>
        <Routes><Route path="/messages/:channelId" element={<Messages />} /></Routes>
      </MemoryRouter>,
    ))
    await vi.waitFor(() => expect(container.textContent).toContain('Message 30'), { timeout: 3000 })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)) })

    const prose = container.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }
    expect(prose).not.toBeNull()
    const editor = prose.editor
    const before = counters.messageRows
    expect(before).toBeGreaterThan(0)

    const text = 'Good news first: your push worked. **What `git init` does:** it'
    for (const character of text) {
      await act(async () => {
        const { view } = editor
        const { from, to } = view.state.selection
        const handled = view.someProp('handleTextInput', (handler) => handler(view, from, to, character, () => view.state.tr.insertText(character, from, to)))
        if (!handled) view.dispatch(view.state.tr.insertText(character, from, to))
        // Let the per-frame flush, the composer's state and typing presence run.
        await new Promise((resolve) => setTimeout(resolve, 1))
      })
    }
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)) })

    // 63 keystrokes, zero message-row renders: the page didn't re-render.
    expect(counters.messageRows - before).toBe(0)
    // Presence went out (throttled to one "active" per 2 seconds), and the draft was saved.
    expect(counters.typing.filter(Boolean).length).toBe(1)
    const draft = JSON.parse(window.localStorage.getItem('csg-message-draft:1:channel:2:root') || '{}')
    expect(draft.body).toBe('Good news first: your push worked. **What `git init` does:** it')
  })
})
