// @vitest-environment jsdom

import { act, Component, startTransition, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Messages } from './Messages'

vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: { id: 1, full_name: 'Staff', email: 'staff@example.com', role: 'admin', is_staff: true } }) }))
vi.mock('../../contexts/CohortContext', () => ({ useCohortContext: () => ({ loading: false, selectedCohortId: 1, setSelectedCohort: vi.fn() }) }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }))
vi.mock('../../lib/realtime', () => ({ subscribeToUserMessages: vi.fn(async () => Object.assign(vi.fn(), { perform: vi.fn() })), isMessageTypingEvent: () => false }))
vi.mock('../../lib/api', () => {
  const workspace = { id: 1, cohort_id: 1, name: 'Cohort', workspace_type: 'cohort', member_count: 2, can_manage: false }
  const channel = { id: 2, workspace_id: 1, cohort_id: 1, name: 'General', unread_count: 0, last_read_at: null, latest_message: null, muted: false }
  const conversation = { id: 8, workspace_id: 1, cohort_id: 1, title: 'Learner', users: [], unread_count: 0, last_read_at: null, latest_message: null, muted: false }
  return { api: new Proxy({}, { get: (_, key) => vi.fn(async () => {
    const responses: Record<string, unknown> = {
      getWorkspaces: { workspaces: [workspace] }, getChannels: { channels: [channel] },
      getDirectConversations: { direct_conversations: [conversation] },
      getWorkspace: { workspace: { ...workspace, members: [] } },
      getAvailableDirectUsers: { users: [] },
      getDirectConversation: { direct_conversation: conversation, messages: [], pinned_messages: [] },
      getChannel: { channel, messages: [], pinned_messages: [] },
    }
    return { data: responses[String(key)] || null, error: null }
  }) }) }
})

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() { return this.state.error ? <p role="alert">{this.state.error.message}</p> : this.props.children }
}

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  window.matchMedia = vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia
  window.requestAnimationFrame = vi.fn(() => 1)
  window.cancelAnimationFrame = vi.fn()
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('Messages editor lifecycle', () => {
  it.each(['/messages/dm/8', '/messages/2'])('opens %s when concurrent rendering delays the first commit and restores its saved draft', async (route) => {
    const targetKey = route.includes('/dm/') ? 'dm:8' : 'channel:2'
    window.localStorage.setItem(`csg-message-draft:1:${targetKey}:root`, JSON.stringify({ version: 1, body: 'Saved QA draft', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Saved QA draft' }] }] } }))
    function SlowSibling() {
      const until = performance.now() + 1
      while (performance.now() < until) { /* Force React to yield before committing. */ }
      return null
    }
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = false
    startTransition(() => root.render(
      <Boundary>
        <MemoryRouter initialEntries={[route]}>
          <Routes><Route path="/messages/dm/:dmId" element={<Messages />} /><Route path="/messages/:channelId" element={<Messages />} /></Routes>
        </MemoryRouter>
        {Array.from({ length: 100 }, (_, index) => <SlowSibling key={index} />)}
      </Boundary>,
    ))
    await vi.waitFor(() => expect(container.textContent).not.toBe(''), { timeout: 2000 })
    await vi.waitFor(() => expect(container.textContent).not.toContain('Loading'), { timeout: 2000 })
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.textContent).toContain('Saved QA draft')
    expect(container.querySelector('[contenteditable="true"]')).not.toBeNull()
  })
})
