// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Messages } from './Messages'

const state = vi.hoisted(() => ({ admin: false, type: 'community' }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: { id: 1, full_name: 'Teacher', email: 'teacher@example.com', role: state.admin ? 'admin' : 'instructor', is_staff: true, is_admin: state.admin } }) }))
vi.mock('../../contexts/CohortContext', () => ({ useCohortContext: () => ({ loading: false, selectedCohortId: 1, setSelectedCohort: vi.fn() }) }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }))
vi.mock('../../lib/realtime', () => ({ subscribeToUserMessages: vi.fn(async () => Object.assign(vi.fn(), { perform: vi.fn() })), isMessageTypingEvent: () => false }))
vi.mock('../../lib/api', () => ({ api: new Proxy({}, { get: (_, key) => vi.fn(async () => {
  // Deliberately stale can_manage=true: session role still controls community management.
  const workspace = { id: 1, cohort_id: state.type === 'cohort' ? 1 : null, name: 'Teaching workspace', workspace_type: state.type, member_count: 2, can_manage: true }
  const responses: Record<string, unknown> = {
    getWorkspaces: { workspaces: [{ ...workspace, id: 9, name: 'Other community', workspace_type: 'community' }, workspace] }, getChannels: { channels: [] },
    getDirectConversations: { direct_conversations: [] }, getWorkspace: { workspace: { ...workspace, members: [] } },
    getAvailableDirectUsers: { users: [] }, getUsers: { users: [] },
  }
  return { data: responses[String(key)] || null, error: null }
}) }) }))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  state.admin = false; state.type = 'community'
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  window.matchMedia = vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia
  window.requestAnimationFrame = vi.fn(() => 1); window.cancelAnimationFrame = vi.fn()
})
afterEach(async () => {
  await act(async () => root.unmount())
  document.querySelectorAll('[data-state="closing"]').forEach((ghost) => ghost.dispatchEvent(new Event('animationend', { bubbles: true })))
  container.remove(); window.localStorage.clear(); vi.restoreAllMocks()
})
const render = async () => act(async () => root.render(<MemoryRouter initialEntries={['/messages?workspace_id=1']}><Messages /></MemoryRouter>))

describe('workspace management authority', () => {
  it('hides community creation membership and channel controls for instructor members', async () => {
    await render()
    expect(container.textContent).toContain('Teaching workspace')
    expect(container.querySelector('[aria-label="Create workspace"]')).toBeNull()
    expect(container.querySelector('[aria-label="Create channel"]')).toBeNull()
    expect(Array.from(container.querySelectorAll('button')).some((b) => b.textContent === 'Manage')).toBe(false)
  })
  it('keeps assigned cohort channel creation for instructors', async () => {
    state.type = 'cohort'
    await render()
    expect(container.querySelector('[aria-label="Create workspace"]')).toBeNull()
    expect(container.querySelector('[aria-label="Create channel"]')).not.toBeNull()
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Create channel"]')!.click())
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Create channel')
    const target = document.querySelector<HTMLSelectElement>('[role="dialog"] select')!
    expect([...target.options].map((option) => option.textContent)).toEqual(['Teaching workspace'])
    expect(target.value).toBe('1')
  })
  it('keeps community and membership management for admins', async () => {
    state.admin = true
    await render()
    expect(container.querySelector('[aria-label="Create workspace"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Create channel"]')).not.toBeNull()
    const manage = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Manage')!
    expect(manage).toBeDefined()
    await act(async () => manage.click())
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Add member')
  })
})
