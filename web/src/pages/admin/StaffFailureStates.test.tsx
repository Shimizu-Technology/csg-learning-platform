// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../lib/api'
import { AdminDashboard } from './AdminDashboard'
import { CohortManagement } from './CohortManagement'
import { CohortModuleGrading } from './CohortModuleGrading'
import { Grading } from './Grading'
import { SupportQueue } from './SupportQueue'

vi.mock('../../contexts/CohortContext', () => ({ useCohortContext: () => ({ selectedCohortId: 4, refreshCohorts: vi.fn() }) }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: { is_admin: true } }) }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }))
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => vi.fn().mockResolvedValue(true) }))
vi.mock('../../components/shared/CodeEditor', () => ({ CodeEditor: () => null, detectLanguage: () => 'python' }))
vi.mock('../../components/shared/CodeRunner', () => ({ CodeRunner: () => null }))

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  vi.spyOn(api, 'getCohorts').mockResolvedValue({ data: { cohorts: [] }, error: null })
  vi.spyOn(api, 'getCurricula').mockResolvedValue({ data: { curricula: [] }, error: null })
  vi.spyOn(api, 'getFeedbackSnippets').mockResolvedValue({ data: { feedback_snippets: [] }, error: null })
  window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks() })
async function render(path: string) {
  const router = createMemoryRouter([
    { path: '/admin/support', element: <SupportQueue /> },
    { path: '/admin', element: <AdminDashboard /> }, { path: '/admin/cohorts', element: <CohortManagement /> },
    { path: '/admin/grading', element: <Grading /> }, { path: '/admin/cohorts/:cohortId/modules/:moduleId/grading', element: <CohortModuleGrading /> },
  ], { initialEntries: [path] })
  await act(async () => root.render(<RouterProvider router={router} />))
  return router
}
async function click(label: string) { const button = [...container.querySelectorAll('button')].find((item) => item.textContent === label)!; expect(button).toBeTruthy(); await act(async () => button.click()) }
const dashboard = { enrolled: false, user: { id: 1, full_name: 'Staff', role: 'admin' }, attention: { generated_at: '', students: [], summary: { student_count: 0, checked_enrollment_count: 1, ungraded_count: 0, redo_count: 0, reason_counts: {} } } }

describe('honest staff failures', () => {
  it('shows dashboard error and retry, then healthy empty state only after success', async () => {
    vi.spyOn(api, 'getDashboard').mockResolvedValueOnce({ data: null, error: 'Network unavailable' }).mockResolvedValueOnce({ data: { dashboard }, error: null })
    await render('/admin')
    expect(container.querySelector('[role=alert]')?.textContent).toContain('Network unavailable')
    expect(container.textContent).not.toContain('Everyone’s on track')
    await click('Retry')
    expect(container.textContent).toContain('Everyone’s on track')
    expect(container.textContent).toContain('released unfinished work')
  })
  it('keeps saved dashboard data and labels refresh failure', async () => {
    vi.spyOn(api, 'getDashboard').mockResolvedValueOnce({ data: { dashboard }, error: null }).mockResolvedValueOnce({ data: null, error: 'Offline' })
    await render('/admin'); await click('Refresh')
    expect(container.textContent).toContain('Good to see you, Staff')
    expect(container.textContent).toContain('may be out of date')
  })
  it('labels cached dashboard responses as stale even when data is present', async () => {
    vi.spyOn(api, 'getDashboard').mockResolvedValueOnce({ data: { dashboard }, error: null }).mockResolvedValueOnce({ data: { dashboard }, error: 'Offline', fromCache: true })
    await render('/admin'); await click('Refresh')
    expect(container.textContent).toContain('may be out of date')
    expect(container.textContent).toContain('Offline')
  })
  it('never presents a failed grading inbox as caught up and recovers on retry', async () => {
    vi.spyOn(api, 'getSubmissions').mockResolvedValueOnce({ data: null, error: 'Inbox unavailable' }).mockResolvedValueOnce({ data: { submissions: [] }, error: null })
    await render('/admin/grading')
    expect(container.textContent).toContain('Inbox unavailable')
    expect(container.textContent).not.toContain('All caught up!')
    await click('Retry'); expect(container.textContent).toContain('All caught up!')
    vi.mocked(api.getSubmissions).mockResolvedValueOnce({ data: null, error: 'Offline' })
    await click('Refresh inbox'); expect(container.textContent).toContain('may be out of date')
  })
  it('never presents a failed cohort list as an empty school', async () => {
    vi.mocked(api.getCohorts).mockResolvedValueOnce({ data: null, error: 'Cohorts unavailable' })
    await render('/admin/cohorts')
    expect(container.textContent).toContain('Cohorts unavailable')
    expect(container.textContent).not.toContain('No cohorts yet')
    await click('Retry'); expect(container.textContent).toContain('No cohorts yet')
    vi.mocked(api.getCohorts).mockResolvedValueOnce({ data: null, error: 'Offline' })
    await click('Refresh cohorts'); expect(container.textContent).toContain('may be out of date')
  })
  it('shows a recoverable grading matrix failure', async () => {
    vi.spyOn(api, 'getCohortModuleSubmissions').mockResolvedValue({ data: null, error: 'Matrix unavailable' })
    await render('/admin/cohorts/4/modules/2/grading')
    expect(container.textContent).toContain('Matrix unavailable')
    await click('Retry'); expect(api.getCohortModuleSubmissions).toHaveBeenCalledTimes(2)
  })
  it('retains grading matrix data after refresh failure and replaces it on recovery', async () => {
    const matrix = { cohort_id: 4, cohort_name: 'Python pilot', module_id: 2, module_name: 'Functions', requires_github: false, repository_name: '', students: [], exercises: [], progresses: [], submissions: [] }
    vi.spyOn(api, 'getCohortModuleSubmissions').mockResolvedValueOnce({ data: matrix, error: null }).mockResolvedValueOnce({ data: null, error: 'Offline matrix' }).mockResolvedValueOnce({ data: { ...matrix, module_name: 'Recovered module' }, error: null })
    await render('/admin/cohorts/4/modules/2/grading'); await click('Refresh grading')
    expect(container.textContent).toContain('Functions')
    expect(container.textContent).toContain('may be out of date')
    await click('Retry'); expect(container.textContent).toContain('Recovered module')
    expect(container.textContent).not.toContain('may be out of date')
  })
  it('does not enable grading matrix review after a cached detail failure', async () => {
    const row = { id: 42, user_id: 4, user_name: 'Learner', content_block_id: 8, text: 'preview', grade: null, feedback: null, created_at: '2026-10-21', content_block_title: 'Work', lesson_title: 'Lesson' }
    const matrix = { cohort_id: 4, cohort_name: 'Python pilot', module_id: 2, module_name: 'Functions', requires_github: false, repository_name: '', students: [{ user_id: 4, full_name: 'Learner', email: 'learner@example.com', github_username: null, total_exercises: 1, submitted: 1, ungraded: 1, graded: 0, redo: 0 }], exercises: [{ id: 8, title: 'Work', filename: null, release_day: 0, lesson_title: 'Lesson', requires_submission: true, submission_type: 'text_submission' }], progresses: [], submissions: [row] }
    vi.spyOn(api, 'getCohortModuleSubmissions').mockResolvedValue({ data: matrix, error: null } as never)
    vi.spyOn(api, 'getSubmission').mockResolvedValue({ data: { submission: row }, error: 'Cached details unavailable', fromCache: true } as never)
    await render('/admin/cohorts/4/modules/2/grading')
    const cell = container.querySelector<HTMLButtonElement>('button[title="Awaiting review — Click to grade"]')!
    expect(cell).toBeTruthy(); await act(async () => cell.click())
    expect(container.textContent).toContain('Cached details unavailable')
    expect(container.querySelector('textarea')).toBeNull()
    expect([...document.querySelectorAll('button')].some((button) => ['A', 'B', 'C', 'Redo'].includes(button.textContent?.trim() ?? ''))).toBe(false)
  })
  it('ignores a late grid detail response after close and all grading shortcuts', async () => {
    const row = { id: 42, user_id: 4, user_name: 'Learner', content_block_id: 8, text: 'preview', grade: null, feedback: null, created_at: '2026-10-21', content_block_title: 'Work', lesson_title: 'Lesson' }
    const matrix = { cohort_id: 4, cohort_name: 'Python pilot', module_id: 2, module_name: 'Functions', requires_github: false, repository_name: '', students: [{ user_id: 4, full_name: 'Learner', email: 'learner@example.com', github_username: null, total_exercises: 1, submitted: 1, ungraded: 1, graded: 0, redo: 0 }], exercises: [{ id: 8, title: 'Work', filename: null, release_day: 0, lesson_title: 'Lesson', requires_submission: true, submission_type: 'text_submission' }], progresses: [], submissions: [row] }
    vi.spyOn(api, 'getCohortModuleSubmissions').mockResolvedValue({ data: matrix, error: null } as never)
    let resolveDetail!: (value: unknown) => void
    vi.spyOn(api, 'getSubmission').mockImplementation(() => new Promise((resolve) => { resolveDetail = resolve }) as never)
    const grade = vi.spyOn(api, 'gradeSubmission')
    await render('/admin/cohorts/4/modules/2/grading')
    await act(async () => container.querySelector<HTMLButtonElement>('button[title="Awaiting review — Click to grade"]')!.click())
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    await act(async () => resolveDetail({ data: { submission: row }, error: null }))
    for (const key of ['a', 'b', 'c', 'r']) await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(grade).not.toHaveBeenCalled()
  })
  it('shows loading feedback while queue details are pending', async () => {
    const row = { id: 42, user_id: 4, user_name: 'Learner', content_block_id: 8, text: 'preview', grade: null, feedback: null, created_at: '2026-10-21', content_block_title: 'Work', lesson_title: 'Lesson' }
    const matrix = { cohort_id: 4, cohort_name: 'Python pilot', module_id: 2, module_name: 'Functions', requires_github: false, repository_name: '', students: [{ user_id: 4, full_name: 'Learner', email: 'learner@example.com', github_username: null, total_exercises: 1, submitted: 1, ungraded: 1, graded: 0, redo: 0 }], exercises: [{ id: 8, title: 'Work', filename: null, release_day: 0, lesson_title: 'Lesson', requires_submission: true, submission_type: 'text_submission' }], progresses: [], submissions: [row] }
    vi.spyOn(api, 'getCohortModuleSubmissions').mockResolvedValue({ data: matrix, error: null } as never)
    vi.spyOn(api, 'getSubmission').mockImplementation(() => new Promise(() => {}) as never)
    await render('/admin/cohorts/4/modules/2/grading')
    const queue = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Ungraded queue'))!
    await act(async () => queue.click())
    expect(container.textContent).toContain('Loading submission details...')
    expect(container.querySelector('textarea')).toBeNull()
  })
  it('opens student context from attention and labels create case with the learner', async () => {
    const student = { enrollment_id: 1, user_id: 18, cohort_id: 4, full_name: 'Maya Santos', email: 'maya@example.com', cohort_name: 'Python pilot', reasons: [], next_action: { label: 'Review work', web_path: '/admin/submissions/42' }, active_intervention_id: null }
    vi.spyOn(api, 'getSupportQueue').mockResolvedValue({ data: { support_queue: { students: [student], summary: {}, interventions: [], help_requests: [], recovery_plans: [], recently_resolved: [] } }, error: null } as never)
    vi.spyOn(api, 'getStudentProgress').mockResolvedValue({ data: null, error: 'Context fixture' })
    vi.spyOn(api, 'getHelpRequests').mockResolvedValue({ data: { help_requests: [] }, error: null } as never)
    vi.spyOn(api, 'getSubmissions').mockResolvedValue({ data: { submissions: [] }, error: null })
    await render('/admin/support?cohort_id=4')
    expect(container.querySelector('button[aria-label="Create case for Maya Santos"]')).not.toBeNull()
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="View context for Maya Santos"]')!.click())
    expect(api.getStudentProgress).toHaveBeenCalledWith(18, 4)
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  })
  it('does not enable review from a list row after detail load failure', async () => {
    const row = { id: 42, user_id: 4, user_name: 'Learner', content_block_id: 8, text: 'incomplete preview', grade: null, feedback: null, created_at: '2026-10-21', content_block_title: 'Work', lesson_title: 'Lesson' }
    vi.spyOn(api, 'getSubmissions').mockResolvedValue({ data: { submissions: [row] }, error: null } as never)
    vi.spyOn(api, 'getSubmission').mockResolvedValue({ data: { submission: row }, error: 'Details unavailable', fromCache: true } as never)
    const grade = vi.spyOn(api, 'gradeSubmission')
    await render('/admin/grading?submission=42')
    expect(container.textContent).toContain('Details unavailable')
    expect(container.querySelector('textarea')).toBeNull()
    expect(grade).not.toHaveBeenCalled()
    await click('Retry'); expect(api.getSubmission).toHaveBeenCalledTimes(2)
  })
})
