// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Profile } from './Profile'
import { api } from '../../lib/api'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('../../lib/api', () => ({ api: Object.fromEntries(['getProfile', 'getBlockedUsers', 'getPushConfig', 'getNudgePreference', 'updateNudgePreference'].map(key => [key, vi.fn()])) }))
vi.mock('@clerk/clerk-react', () => ({ useClerk: () => ({ openUserProfile: vi.fn(), signOut: vi.fn() }) }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: { id: 3, role: 'student' } }) }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => toast }))
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => vi.fn() }))
vi.mock('../../lib/studentExperience', () => ({ useStudentExperience: () => ({ v2: true }) }))
vi.mock('../../components/shared/ActivityTimeline', () => ({ ActivityTimeline: () => null }))
vi.mock('../../components/shared/ThemeChoice', () => ({ ThemeChoice: () => null }))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let container: HTMLDivElement, root: Root
const enrollment = { id: 1, cohort_id: 1, cohort_name: 'Python pilot', curriculum_name: 'Python', status: 'active', enrolled_at: null, can_open: true }
beforeEach(() => {
  vi.clearAllMocks()
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  vi.mocked(api.getBlockedUsers).mockResolvedValue({ data: { blocked_users: [] }, error: null })
  vi.mocked(api.getPushConfig).mockResolvedValue({ data: { notifications_enabled: true }, error: null } as never)
})
afterEach(() => { act(() => root.unmount()); container.remove() })

async function mount(enrollments: object[]) {
  vi.mocked(api.getProfile).mockResolvedValue({ data: { user: { id: 3, full_name: 'Learner', github_username: null }, enrollments }, error: null } as never)
  await act(async () => root.render(<MemoryRouter><Profile /></MemoryRouter>))
}
const reminderSwitch = () => container.querySelector<HTMLButtonElement>('button[aria-label="Course reminders"]')

it('hides course reminders unless an active enrollment sends them', async () => {
  await mount([enrollment, { ...enrollment, id: 2, status: 'dropped', learner_nudges_enabled: true }])
  expect(container.textContent).not.toContain('Course reminders')
  expect(api.getNudgePreference).not.toHaveBeenCalled()
})

it('turns optional reminders off and explains that access reminders always arrive', async () => {
  vi.mocked(api.getNudgePreference).mockResolvedValue({ data: { learner_nudges_enabled: true }, error: null })
  vi.mocked(api.updateNudgePreference).mockResolvedValue({ data: { learner_nudges_enabled: false }, error: null })
  await mount([{ ...enrollment, learner_nudges_enabled: true }])
  expect(container.textContent).toContain('Reminders that your course access is ending always arrive.')
  expect(reminderSwitch()!.getAttribute('aria-checked')).toBe('true')
  await act(async () => reminderSwitch()!.click())
  expect(api.updateNudgePreference).toHaveBeenCalledWith(false)
  expect(reminderSwitch()!.getAttribute('aria-checked')).toBe('false')
  expect(toast.success).toHaveBeenCalledWith('Course reminders turned off')
})

it('offers a retry when the preference does not load, and keeps the switch on a failed save', async () => {
  vi.mocked(api.getNudgePreference).mockResolvedValueOnce({ data: null, error: 'Offline' }).mockResolvedValueOnce({ data: { learner_nudges_enabled: true }, error: null })
  vi.mocked(api.updateNudgePreference).mockResolvedValue({ data: null, error: 'Server error' })
  await mount([{ ...enrollment, learner_nudges_enabled: true }])
  expect(reminderSwitch()).toBeNull()
  const retry = [...container.querySelectorAll('button')].find(button => button.textContent === 'Retry')!
  await act(async () => retry.click())
  await act(async () => reminderSwitch()!.click())
  expect(reminderSwitch()!.getAttribute('aria-checked')).toBe('true')
  expect(toast.error).toHaveBeenCalledWith('Server error')
})
