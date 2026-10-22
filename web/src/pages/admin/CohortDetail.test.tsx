// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { CohortDetail } from './CohortDetail'

const state = vi.hoisted(() => ({ getCohort: vi.fn(), createUser: vi.fn(), createEnrollment: vi.fn(), error: vi.fn(), success: vi.fn(), role: 'admin', getCohortInstructorAssignments: vi.fn() }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: { role: state.role } }) }))
vi.mock('../../lib/api', () => ({ api: state }))
vi.mock('../../lib/realtime', () => ({ subscribeToStaffPresence: async () => () => {} }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ error: state.error, success: state.success }) }))
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => vi.fn() }))
vi.mock('../../components/admin/RecordingUploadManager', () => ({ RecordingUploadManager: () => null }))

let container: HTMLDivElement
let root: Root
const button = (text: string) => [...container.querySelectorAll('button')].find((el) => el.textContent === text)!
const openAndSubmit = async () => {
  await act(async () => root.render(<MemoryRouter initialEntries={['/admin/cohorts/1/settings']}><Routes><Route path="/admin/cohorts/:id/settings" element={<CohortDetail />} /></Routes></MemoryRouter>))
  await act(async () => button('Add student').click())
  await act(async () => {
    const input = container.querySelector('#add-student-email')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'teacher@example.com')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
}
beforeEach(() => {
  vi.clearAllMocks()
  state.role = 'admin'
  state.getCohortInstructorAssignments.mockResolvedValue({ data: { instructors: [] } })
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  state.getCohort.mockResolvedValue({ data: { cohort: { id: 1, name: 'Pilot', curriculum_name: 'Python', start_date: '2026-12-01', status: 'active', modules: [], students: [], active_count: 0 } }, error: null })
})
afterEach(() => { act(() => root.unmount()); container.remove() })

it('keeps a staff account conflict in the form with an exact Team destination and no enrollment call', async () => {
  state.createUser.mockResolvedValue({ data: null, error: 'This email belongs to a staff account. Manage their role in Team.', errorCode: 'staff_account_exists' })
  await openAndSubmit()
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('staff account')
  expect(container.querySelector('a[href="/admin/team"]')?.textContent).toBe('Open Team')
  expect(state.createEnrollment).not.toHaveBeenCalled()
  expect((container.querySelector('#add-student-email') as HTMLInputElement).value).toBe('teacher@example.com')
})

it('enrolls an existing student without an account role update', async () => {
  state.createUser.mockResolvedValue({ data: { user: { id: 9, role: 'student' } }, error: null })
  state.createEnrollment.mockResolvedValue({ data: { enrollment: { id: 10 } }, error: null })
  await openAndSubmit()
  expect(state.createEnrollment).toHaveBeenCalledWith(1, 9, true)
  expect(state.success).toHaveBeenCalledWith('Added teacher@example.com to cohort')
})

it('keeps the entered email and allows retry when enrollment fails', async () => {
  state.createUser.mockResolvedValue({ data: { user: { id: 9, role: 'student' } }, error: null })
  state.createEnrollment.mockResolvedValue({ data: null, error: 'Already enrolled' })
  await openAndSubmit()
  expect(state.error).toHaveBeenCalledWith('Account found, but enrollment failed: Already enrolled')
  expect(container.querySelector('#add-student-email')).not.toBeNull()
})


it.each(['admin', 'instructor'])('shows self-paced offering controls only to admin (%s)', async (role) => {
  state.role = role
  state.getCohort.mockResolvedValue({ data: { cohort: { id: 1, name: 'Python', curriculum_name: 'Python', start_date: '2026-12-01', status: 'active', course_delivery: 'self_paced', modules: [], students: [], active_count: 0, self_paced_access_months: 12, self_paced_support_weeks: 6, public_checkout_enabled: false, offering_readiness: { curriculum_assigned: true, price_set: false, support_instructor_set: false, published_content: false, cohort_active: true } } } })
  await act(async () => root.render(<MemoryRouter initialEntries={['/admin/cohorts/1/settings']}><Routes><Route path="/admin/cohorts/:id/settings" element={<CohortDetail />} /></Routes></MemoryRouter>))
  expect(container.textContent?.includes('Course offering')).toBe(role === 'admin')
})
