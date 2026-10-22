// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { StudentAccess } from '../../components/admin/StudentAccess'
import { StudentDetail } from './StudentDetail'
import { ConfirmProvider } from '../../contexts/ConfirmContext'
import { api } from '../../lib/api'
import type { CohortDetail, StudentProgressResponse, UserListItem } from '../../types/api'

const auth = vi.hoisted(() => ({ user: { id: 1, is_admin: true, role: 'admin' } }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => auth }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))
vi.mock('../../lib/api', () => ({
  api: Object.fromEntries(
    [
      'getCurriculum',
      'getCohorts',
      'getUser',
      'updateUser',
      'updateEnrollment',
      'deleteEnrollment',
      'createModuleAssignment',
      'updateModuleAssignment',
      'deleteModuleAssignment',
      'createLessonAssignment',
      'updateLessonAssignment',
      'deleteLessonAssignment',
      'restartEnrollment',
    ].map((name) => [name, vi.fn()])
  ),
}))
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const user = {
  id: 6,
  full_name: 'Test Learner',
  email: 'learner@example.com',
  github_username: 'learner',
  avatar_url: null,
  last_sign_in_at: null,
  last_seen_at: null,
} as UserListItem
const progress = {
  user,
  enrollment: {
    id: 11,
    status: 'active',
    access_expires_at: '2027-01-01T00:00:00Z',
    support_expires_at: '2026-12-01T00:00:00Z',
    module_assignments: [
      {
        id: 3,
        module_id: 5,
        module_name: 'Module A',
        module_type: 'prework',
        unlocked: false,
        unlock_date_override: null,
        available: false,
        next_unlock_date: null,
      },
    ],
  },
  modules: [{ id: 5, lessons: [{ id: 7, lesson_assignment: null }] }],
} as unknown as StudentProgressResponse
const cohort = {
  id: 2,
  name: 'Pilot cohort',
  curriculum_id: 4,
  status: 'active',
  cohort_type: 'standard',
} as CohortDetail
let container: HTMLDivElement, root: Root
let router: ReturnType<typeof createMemoryRouter>
const saved = vi.fn()
async function renderAccess() {
  router = createMemoryRouter([
    {
      path: '*',
      element: (
        <ConfirmProvider>
          <StudentAccess progress={progress} cohort={cohort} onSaved={saved} />
        </ConfirmProvider>
      ),
    },
  ])
  await act(async () => root.render(<RouterProvider router={router} />))
}
async function click(label: string, within: ParentNode = container) {
  const button = [...within.querySelectorAll('button')].find((item) => item.textContent === label)!
  expect(button).toBeTruthy()
  await act(async () => button.click())
}
async function mode(section: ParentNode, value: string) {
  const select = section.querySelector('select')!
  await act(async () => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })) })
}
async function type(field: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  auth.user = { id: 1, is_admin: true, role: 'admin' }
  vi.mocked(api.getCurriculum).mockResolvedValue({
    data: {
      curriculum: {
        modules: [
          { id: 5, name: 'Module A', lessons: [{ id: 7, title: 'Lesson one' }] },
          { id: 8, name: 'Module B', lessons: [] },
        ],
      },
    },
    error: null,
  } as any)
  vi.mocked(api.getCohorts).mockResolvedValue({ data: { cohorts: [] }, error: null })
  for (const method of [
    'updateModuleAssignment',
    'createModuleAssignment',
    'deleteModuleAssignment',
    'createLessonAssignment',
    'updateLessonAssignment',
    'deleteLessonAssignment',
    'updateUser',
    'updateEnrollment',
    'deleteEnrollment',
    'restartEnrollment',
  ] as const)
    vi.mocked(api[method]).mockResolvedValue({ data: null, error: null } as any)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.clearAllMocks()
})
describe('workspace Access', () => {
  it('keeps instructor overrides while hiding admin-only actions', async () => {
    auth.user = { id: 2, is_admin: false, role: 'instructor' }
    await renderAccess()
    expect(container.textContent).toContain('Follow schedule')
    expect(container.textContent).toContain('Assign module')
    expect(container.textContent).not.toContain('Edit profile')
    expect(container.textContent).not.toContain('Save enrollment')
    expect(container.textContent).not.toContain('Restart class progress')
    expect(api.getCohorts).not.toHaveBeenCalled()
    await mode(container.querySelector('[aria-label="Module A access"]')!, 'unlock')
    await act(async () =>
      container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    )
    expect(api.updateModuleAssignment).toHaveBeenCalledWith(3, { unlocked: true, unlock_date_override: null })
    expect(saved).toHaveBeenCalled()
    await click('Assign module')
    expect(api.createModuleAssignment).toHaveBeenCalledWith(11, { module_id: 8, unlocked: false })
  })
  it('can return a saved module date override to its default', async () => {
    const current = {
      ...progress,
      enrollment: {
        ...progress.enrollment,
        module_assignments: progress.enrollment.module_assignments.map((item) => ({
          ...item,
          unlock_date_override: '2026-11-01',
        })),
      },
    }
    router = createMemoryRouter([
      {
        path: '*',
        element: (
          <ConfirmProvider>
            <StudentAccess progress={current} cohort={cohort} onSaved={saved} />
          </ConfirmProvider>
        ),
      },
    ])
    await act(async () => root.render(<RouterProvider router={router} />))
    const section = container.querySelector('[aria-label="Module A access"]')!
    await click('Follow schedule', section)
    await act(async () =>
      section.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    )
    expect(api.updateModuleAssignment).toHaveBeenCalledWith(3, { unlocked: false, unlock_date_override: null })
  })

  it('saves lesson overrides and retains input when saving fails', async () => {
    await renderAccess()
    const section = container.querySelector('[aria-label="Lesson one access"]')!
    const form = section.querySelector('form')!
    await mode(section, 'date')
    await type(section.querySelector('input[type="date"]')!, '2026-11-02')
    vi.mocked(api.createLessonAssignment).mockResolvedValueOnce({ data: null, error: 'Could not save override' })
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(container.textContent).toContain('Could not save override')
    expect(section.querySelector('input[type="date"]')?.getAttribute('value')).toBe('2026-11-02')
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(api.createLessonAssignment).toHaveBeenLastCalledWith(11, {
      lesson_id: 7,
      unlocked: false,
      unlock_date_override: '2026-11-02',
    })
  })
  it.each(['button', 'empty date'])('clears a saved lesson date to schedule inheritance via %s', async (action) => {
    const current = { ...progress, modules: [{ id: 5, lessons: [{ id: 7, lesson_assignment: {
      id: 19, unlocked: false, unlock_date_override: '2026-11-02',
    } }] }] } as unknown as StudentProgressResponse
    router = createMemoryRouter([{ path: '*', element: <ConfirmProvider><StudentAccess progress={current} cohort={cohort} onSaved={saved} /></ConfirmProvider> }])
    await act(async () => root.render(<RouterProvider router={router} />))
    const section = container.querySelector('[aria-label="Lesson one access"]')!
    if (action === 'button') await click('Follow schedule', section)
    else await type(section.querySelector('input[type="date"]')!, '')
    await act(async () => section.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(api.deleteLessonAssignment).toHaveBeenCalledWith(19)
    expect(api.updateLessonAssignment).not.toHaveBeenCalled()
    expect(api.createLessonAssignment).not.toHaveBeenCalled()
  })
  it('keeps deliberate lesson locking separate from following schedule', async () => {
    await renderAccess()
    const section = container.querySelector('[aria-label="Lesson one access"]')!
    await act(async () => section.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(api.createLessonAssignment).not.toHaveBeenCalled()
    await mode(section, 'lock')
    await act(async () => section.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(api.createLessonAssignment).toHaveBeenCalledWith(11, { lesson_id: 7, unlocked: false, unlock_date_override: null })
  })
  it.each([
    ['self_paced', null, 'Starts on first course open'],
    ['guided', null, 'No expiry'],
    ['self_paced', '2026-10-01T00:00:00Z', 'No expiry'],
  ])('shows enrollment-specific support timing for %s opened %s', async (delivery, opened, expected) => {
    const current = { ...progress, enrollment: { ...progress.enrollment, first_opened_at: opened, support_expires_at: null } }
    router = createMemoryRouter([{ path: '*', element: <ConfirmProvider><StudentAccess progress={current} cohort={{ ...cohort, course_delivery: delivery } as CohortDetail} onSaved={saved} /></ConfirmProvider> }])
    await act(async () => root.render(<RouterProvider router={router} />))
    const fact = [...container.querySelectorAll('dt')].find((item) => item.textContent === 'Instructor support ends')!
    expect(fact.nextElementSibling?.textContent).toBe(expected)
  })
  it('requires typed email before the audited restart endpoint', async () => {
    await renderAccess()
    await click('Restart class progress')
    const dialog = document.querySelector('[role="dialog"]')!
    const confirm = [...dialog.querySelectorAll('button')].find(
      (button) => button.textContent === 'Restart class progress'
    )!
    expect(confirm.disabled).toBe(true)
    expect(api.restartEnrollment).not.toHaveBeenCalled()
    await type(dialog.querySelector('input')!, 'wrong@example.com')
    expect(confirm.disabled).toBe(true)
    await type(dialog.querySelector('input')!, user.email)
    expect(confirm.disabled).toBe(false)
    await act(async () => confirm.click())
    expect(api.restartEnrollment).toHaveBeenCalledWith(11, user.email, 'Restarted from student workspace Access')
    expect(container.textContent).toContain('Recovery plan and weekly follow-up are ready in Support')
  })
  it('updates the enrollment selector when restart reactivates a paused enrollment', async () => {
    function RestartHarness() {
      const [current, setCurrent] = useState({ ...progress, enrollment: { ...progress.enrollment, status: 'paused' } })
      return (
        <ConfirmProvider>
          <StudentAccess
            progress={current}
            cohort={cohort}
            onSaved={() => setCurrent({ ...current, enrollment: { ...current.enrollment, status: 'active' } })}
          />
        </ConfirmProvider>
      )
    }
    router = createMemoryRouter([{ path: '*', element: <RestartHarness /> }])
    await act(async () => root.render(<RouterProvider router={router} />))
    expect((container.querySelector('select[id$="-status"]') as HTMLSelectElement).value).toBe('paused')
    await click('Restart class progress')
    const dialog = document.querySelector('[role="dialog"]')!
    await type(dialog.querySelector('input')!, user.email)
    await click('Restart class progress', dialog)
    expect((container.querySelector('select[id$="-status"]') as HTMLSelectElement).value).toBe('active')
  })

  it('saves admin profile and enrollment changes', async () => {
    await renderAccess()
    await click('Edit profile')
    await type(container.querySelector('input[id$="-github"]')!, '')
    const profileForm = container.querySelector('input[id$="-github"]')!.closest('form')!
    await act(async () => profileForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(api.updateUser).toHaveBeenCalledWith(6, { first_name: 'Test', last_name: 'Learner', github_username: '' })
    const select = container.querySelector('select[id$="-status"]') as HTMLSelectElement
    await act(async () => {
      select.value = 'paused'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () =>
      select.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    )
    expect(api.updateEnrollment).toHaveBeenCalledWith(11, { status: 'paused' })
  })
})
describe('legacy student entry', () => {
  async function route(path: string, enrollments: any[]) {
    vi.mocked(api.getUser).mockResolvedValue({ data: { user, enrollments }, error: null })
    router = createMemoryRouter(
      [
        { path: '/admin/students/:id', element: <StudentDetail /> },
        { path: '/admin/cohorts/:cohortId/students/:id/:tab', element: <p>Enrollment workspace</p> },
      ],
      { initialEntries: [path] }
    )
    await act(async () => root.render(<RouterProvider router={router} />))
  }
  const enrollment = { id: 11, cohort_id: 2, cohort_name: 'Pilot cohort', status: 'active' }
  it.each([
    ['?cohort_id=2', 'overview'],
    ['?legacy=1&cohort_id=2', 'access'],
  ])('redirects explicit enrollment %s', async (query, tab) => {
    await route(`/admin/students/6${query}`, [])
    expect(router.state.location.pathname).toBe(`/admin/cohorts/2/students/6/${tab}`)
    expect(api.getUser).not.toHaveBeenCalled()
  })
  it('redirects one enrollment', async () => {
    await route('/admin/students/6', [enrollment])
    expect(router.state.location.pathname).toBe('/admin/cohorts/2/students/6/overview')
  })
  it('offers multiple enrollments without guessing', async () => {
    await route('/admin/students/6', [enrollment, { ...enrollment, id: 12, cohort_id: 3, cohort_name: 'Other cohort' }])
    expect(container.textContent).toContain('Choose an enrollment')
    expect(container.querySelector('a[href="/admin/cohorts/3/students/6/overview"]')).toBeTruthy()
  })
  it('shows profile and enrollment action with no enrollments', async () => {
    await route('/admin/students/6', [])
    expect(container.textContent).toContain(user.email)
    expect(container.textContent).toContain('Add to cohort')
    expect(container.textContent).not.toContain("Couldn't load")
  })
})
