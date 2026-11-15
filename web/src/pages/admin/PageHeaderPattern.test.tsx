// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api } from '../../lib/api'
import { AdminDashboard } from './AdminDashboard'
import { CohortManagement } from './CohortManagement'
import { ContentManagement } from './ContentManagement'
import { Grading } from './Grading'
import { StudentManagement } from './StudentManagement'
import { SupportQueue } from './SupportQueue'

// U-6.3 / T-8: list and hub pages share one header: title, a context line,
// the scope control when the page can be filtered by cohort, actions on the
// right, and Refresh (where a page keeps it) in the ⋯ menu.

vi.mock('../../contexts/CohortContext', () => ({ useCohortContext: () => ({ cohorts: [{ id: 3, name: 'Cohort 3' }, { id: 4, name: 'Cohort 4' }], selectedCohortId: null, refreshCohorts: vi.fn() }) }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: { id: 1, is_admin: true, is_staff: true } }) }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }))
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => vi.fn().mockResolvedValue(true) }))
vi.mock('../../contexts/UploadContext', () => ({ useUpload: () => ({ attachUpload: vi.fn() }) }))
vi.mock('../../lib/realtime', () => ({ subscribeToStaffPresence: () => Promise.resolve(() => undefined) }))

const cohort = (id: number) => ({ id, name: `Cohort ${id}`, curriculum_name: 'Web development', modules: [], status: 'active', start_date: '2026-10-01' })
let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  vi.spyOn(api, 'getDashboard').mockResolvedValue({ data: { dashboard: { user: { full_name: 'Sam Staff' }, cohorts: [], attention: { generated_at: '', students: [], summary: { student_count: 2, checked_enrollment_count: 4, ungraded_count: 1, redo_count: 0, reason_counts: {} } } } }, error: null } as never)
  vi.spyOn(api, 'getCohorts').mockResolvedValue({ data: { cohorts: [cohort(3), cohort(4)] }, error: null } as never)
  vi.spyOn(api, 'getCurricula').mockResolvedValue({ data: { curricula: [] }, error: null } as never)
  vi.spyOn(api, 'getSubmissions').mockResolvedValue({ data: { submissions: [] }, error: null } as never)
  vi.spyOn(api, 'getFeedbackSnippets').mockResolvedValue({ data: { feedback_snippets: [] }, error: null } as never)
  vi.spyOn(api, 'getUsers').mockResolvedValue({ data: { users: [] }, error: null } as never)
  vi.spyOn(api, 'getSupportQueue').mockResolvedValue({ data: { support_queue: { students: [], summary: { open_help_count: 3, active_intervention_count: 0, due_follow_up_count: 0, due_recovery_check_in_count: 0 }, interventions: [], help_requests: [], recovery_plans: [], recently_resolved: [] } }, error: null } as never)
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks() })

async function render(path: string) {
  const router = createMemoryRouter([
    { path: '/admin', element: <AdminDashboard /> },
    { path: '/admin/grading', element: <Grading /> },
    { path: '/admin/support', element: <SupportQueue /> },
    { path: '/admin/cohorts', element: <CohortManagement /> },
    { path: '/admin/students', element: <StudentManagement /> },
    { path: '/admin/content', element: <ContentManagement /> },
  ], { initialEntries: [path] })
  await act(async () => root.render(<RouterProvider router={router} />))
  await act(async () => { await Promise.resolve() })
  return router
}

const header = () => container.querySelector('[data-page-header]')!
const menuItems = async () => {
  const more = header().querySelector<HTMLButtonElement>('button[aria-label="More actions"]')
  if (!more) return []
  await act(async () => more.click())
  return [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)
}

it.each([
  ['/admin', 'Good to see you, Sam', /2 learners need you/, true, true],
  ['/admin/grading', 'Grading', /0 attempts waiting for review across cohorts/, true, true],
  ['/admin/support', 'Support', /3 open requests/, true, true],
  ['/admin/cohorts', 'Cohorts', /2 cohorts/, false, true],
  ['/admin/students', 'Students', /enrollments? across/, true, false],
  ['/admin/content', 'Content', /0 curricula/, false, false],
])('%s uses the page header: title, context line, scope and Refresh in ⋯', async (path, title, context, scoped, refresh) => {
  await render(path)
  expect(container.querySelectorAll('[data-page-header]')).toHaveLength(1)
  expect(header().querySelector('h1')?.textContent).toBe(title)
  expect(header().querySelector('.app-eyebrow')).toBeNull()
  expect(header().querySelector('[data-page-context]')?.textContent).toMatch(context)
  expect(Boolean(header().querySelector('[data-scope-control]'))).toBe(scoped)
  if (scoped) expect(header().querySelector('[data-scope-control]')?.textContent).toContain('Showing:All cohorts')
  // No loose Refresh button anywhere on the page; where refresh stays, it's in ⋯.
  expect([...container.querySelectorAll('button')].some((button) => /^Refresh/.test(button.textContent || ''))).toBe(false)
  expect((await menuItems()).includes('Refresh')).toBe(refresh)
})

it.each(['/admin', '/admin/grading', '/admin/support'])('%s shows a cohort filter as tinted, named scope and clears it from the control', async (path) => {
  const router = await render(`${path}?cohort_id=3`)
  const scope = header().querySelector('[data-scope-control]')!
  expect(scope.getAttribute('data-scope-control')).toBe('filtered')
  expect(scope.className).toContain('bg-primary-50')
  expect(scope.textContent).toContain('Showing:Cohort 3')
  const select = scope.querySelector('select')!
  expect(select.labels?.[0]?.textContent).toBe('Showing cohort')
  await act(async () => {
    select.value = ''
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(new URLSearchParams(router.state.location.search).get('cohort_id')).toBeNull()
})

it('Students shows its cohort filter in the header scope control', async () => {
  vi.mocked(api.getDashboard).mockResolvedValue({ data: { dashboard: { cohorts: [{ cohort: { id: 3, name: 'Cohort 3', start_date: '2026-10-10', status: 'active', enrolled_count: 0, active_count: 0 }, ungraded_count: 0, students: [] }] } }, error: null } as never)
  await render('/admin/students?cohort_id=3')
  expect(header().querySelector('[data-scope-control]')?.getAttribute('data-scope-control')).toBe('filtered')
  expect(header().querySelector('[data-scope-control]')?.textContent).toContain('Cohort 3')
})

it.each([['/admin/content', 'New curriculum'], ['/admin/cohorts', 'New cohort']])('%s puts its primary action on the right of the title', async (path, action) => {
  await render(path)
  expect(header().querySelector('[data-page-actions]')?.textContent).toContain(action)
})
