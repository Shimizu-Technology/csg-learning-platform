// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Profile } from './Profile'
import { api } from '../../lib/api'

vi.mock('../../lib/api', () => ({ api: Object.fromEntries(['getProfile', 'getBlockedUsers', 'getPushConfig', 'getGithubRepositoryBindings'].map(key => [key, vi.fn()])) }))
vi.mock('@clerk/clerk-react', () => ({ useClerk: () => ({ openUserProfile: vi.fn(), signOut: vi.fn() }) }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: { id: 3, role: 'student' } }) }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => vi.fn() }))
vi.mock('../../lib/studentExperience', () => ({ useStudentExperience: () => ({ v2: false }) }))
vi.mock('../../components/shared/ActivityTimeline', () => ({ ActivityTimeline: () => null }))
vi.mock('../../components/shared/ThemeChoice', () => ({ ThemeChoice: () => null }))
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
let container: HTMLDivElement, root: Root
beforeEach(() => {
  vi.clearAllMocks()
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  vi.mocked(api.getBlockedUsers).mockResolvedValue({ data: { blocked_users: [] }, error: null })
  vi.mocked(api.getPushConfig).mockResolvedValue({ data: { notifications_enabled: true }, error: null } as any)
})
afterEach(() => { act(() => root.unmount()); container.remove() })
it.each([
  ['active', true, true, true],
  ['paused', true, true, false],
  ['active', false, true, false],
  ['active', true, false, false],
])('verified username recovery for status=%s App=%s configured=%s', async (status, enabled, configured, available) => {
  vi.mocked(api.getProfile).mockResolvedValue({ data: { user: { id: 3, full_name: 'Learner', github_username: 'learner', github_identity: { id: '11', login: 'learner' } }, enrollments: [{ id: 1, cohort_id: 1, cohort_name: 'Test cohort', curriculum_name: 'Course', status, github_app_enabled: enabled, can_open: false }] }, error: null } as any)
  vi.mocked(api.getGithubRepositoryBindings).mockResolvedValue({ data: { github_identity: { id: '11', login: 'learner' }, can_connect_github: configured, bindings: [], modules: [], installations: [] }, error: null } as any)
  await act(async () => root.render(<MemoryRouter><Profile /></MemoryRouter>))
  expect((container.querySelector('#profile-github-username') as HTMLInputElement).disabled).toBe(true)
  const reconnect = [...container.querySelectorAll('button')].find(button => button.textContent === 'Reconnect GitHub')
  if (available) {
    expect(reconnect).toBeTruthy()
    expect(container.textContent).toContain('Use Reconnect GitHub below to change it.')
  } else {
    expect(reconnect).toBeUndefined()
    expect(container.textContent).not.toContain('Use Reconnect GitHub below')
    expect(container.textContent).toContain('Contact your instructor or an administrator')
  }
})
