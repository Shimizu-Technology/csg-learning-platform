// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { StudentManagement } from './StudentManagement'
import { api } from '../../lib/api'
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: { is_admin: true } }) }))
vi.mock('../../lib/realtime', () => ({ subscribeToStaffPresence: async () => () => undefined }))
vi.mock('../../lib/api', () => ({ api: { getDashboard: vi.fn(), getUsers: vi.fn() } }))
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
let root: Root, container: HTMLDivElement
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const learner = {
    user_id: 6,
    full_name: 'Learner',
    email: 'learner@example.com',
    github_username: null,
    progress_percentage: 0,
    completed_blocks: 0,
    total_blocks: 1,
    last_sign_in_at: null,
    last_seen_at: null,
    last_activity_at: null,
    blocks_this_week: 0,
    submissions_this_week: 0,
    enrollment_status: 'active',
  }
  vi.mocked(api.getDashboard).mockResolvedValue({
    data: {
      dashboard: {
        cohorts: [1, 2].map((id) => ({
          cohort: { id, name: `Cohort ${id}`, enrolled_count: 1, active_count: 1, status: 'active' },
          students: [{ ...learner, user_id: id + 5 }],
          ungraded_count: 0,
        })),
      },
    },
    error: null,
  } as any)
  vi.mocked(api.getUsers).mockResolvedValue({
    data: { users: [{ id: 9, full_name: 'Unenrolled learner', email: 'none@example.com', enrollments: [] }] },
    error: null,
  } as any)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.clearAllMocks()
})
it('keeps the school directory, cohort filter and enrollment destinations in the URL', async () => {
  const router = createMemoryRouter([{ path: '/admin/students', element: <StudentManagement /> }], {
    initialEntries: ['/admin/students'],
  })
  await act(async () => root.render(<RouterProvider router={router} />))
  expect(container.querySelector('a[href="/admin/students/9"]')).toBeTruthy()
  const filter = container.querySelector('[aria-label="Filter students by cohort"]') as HTMLSelectElement
  await act(async () => {
    filter.value = '2'
    filter.dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(router.state.location.search).toContain('cohort_id=2')
  expect(container.querySelector('a[href="/admin/cohorts/2/students/7/overview"]')).toBeTruthy()
  expect(container.querySelector('a[href="/admin/cohorts/1/students/6/overview"]')).toBeNull()
  expect(container.querySelector('a[href="/admin/students/9"]')).toBeNull()
})
