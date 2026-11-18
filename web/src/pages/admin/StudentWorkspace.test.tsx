// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../lib/api'
import { StudentContextDrawer } from '../../components/admin/StudentContextDrawer'
import type { CohortDetail, StudentProgressResponse, Submission, RecoveryPlan } from '../../types/api'
import { StudentWorkspace } from './StudentWorkspace'
import { rememberRoster } from '../../lib/recordQueue'
import { clearRecordQueueCache as resetQueues } from '../../lib/recordQueueCache'

vi.mock('../../lib/api', () => ({ api: {
  getLearnerExtensions: vi.fn().mockResolvedValue({ data: { extensions: [] } }),
  getStudentCommunication: vi.fn(), createIntervention: vi.fn(), createDirectConversation: vi.fn(), getCurriculum: vi.fn(), createModuleAssignment: vi.fn(), getStudentProgress: vi.fn(), getCohort: vi.fn(), getSubmissions: vi.fn(),
  getHelpRequests: vi.fn(), getStudentWatchProgress: vi.fn(), getStudentLessonVideoProgress: vi.fn(),
  getInterventions: vi.fn(), getRecoveryPlans: vi.fn(), getLearningInsights: vi.fn(), createRecoveryPlanCheckIn: vi.fn(), updateRecoveryPlan: vi.fn(),
} }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: { id: 1, is_admin: false, is_staff: true, role: 'instructor' } }) }))
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => async () => false }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const progress: StudentProgressResponse = {
  status: { label: 'Work to review', needs_attention: true, reasons: [{ code: 'review', label: '1 latest attempt awaiting review', since: null }], ungraded_count: 1, redo_count: 0, help_request_count: 0, next_review_submission_id: 21, active_intervention_count: 0, active_intervention_id: null },
  media_summary: { recordings_completed: 0, recordings_total: 0, lesson_videos_completed: 0, lesson_videos_total: 0, videos_completed: 0 },
  enrollment: { id: 11, status: 'active', module_assignments: [] },
  user: { id: 6, full_name: 'Learner', email: 'learner@example.com', github_username: null, avatar_url: null, last_sign_in_at: null, last_seen_at: null },
  cohort: { id: 1, name: 'Cohort A', start_date: '2026-03-01', status: 'active' },
  overall_progress: { completed: 0, total: 1, percentage: 0 },
  recent_activity: [],
  modules: [{ id: 3, name: 'Shared module', module_type: 'prework', position: 1, total_blocks: 1, completed_blocks: 0, progress_percentage: 0, lessons: [{
    id: 4, title: 'Shared lesson', lesson_type: 'exercise', position: 1, release_day: 0, required: true, available: true, unlock_date: null,
    total_blocks: 1, completed_blocks: 0, completed: false, lesson_assignment: null,
    blocks: [{ id: 7, title: 'Shared exercise', block_type: 'exercise', position: 1, status: 'not_started', completed_at: null, submission: null }],
  }] }],
}
const cohort: CohortDetail = {
  id: 1, name: 'Cohort A', cohort_type: 'standard', curriculum_id: 2, curriculum_name: 'Shared curriculum', start_date: '2026-03-01', end_date: null,
  github_organization_name: null, repository_name: null, requires_github: false, status: 'active', settings: {}, enrolled_count: 1, active_count: 1, announcements: [], modules: [], students: [],
}
const submission: Submission = { module_position: null, course_delivery: null, week_number: null, cohort_id: null, enrollment_id: null, latest_submission_id: null, submission_type: null, repo_url: null, pr_url: null, live_url: null, branch: null, commit_sha: null, notes: null, submission_config: {}, rubric: null, cohort_name: null,
  id: 21, content_block_id: 7, user_id: 6, user_name: 'Learner', text: 'A work', grade: null, feedback: null, graded_by: null, graded_at: null,
  github_issue_url: null, github_code_url: null, num_submissions: 1, created_at: '2026-10-09T01:00:00Z', updated_at: '2026-10-09T01:00:00Z',
  content_block_title: 'Work from cohort A', content_block_type: 'exercise', lesson_id: 4, lesson_title: 'Shared lesson', module_id: 3, module_name: 'Shared module', filename: null, language_hint: null,
}
const otherSubmission: Submission = { ...submission, id: 22, text: 'B work', content_block_title: 'Work from cohort B', created_at: '2026-10-10T01:00:00Z' }
let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  window.requestAnimationFrame = vi.fn(() => 1)
  window.scrollTo = vi.fn() as never
  vi.mocked(api.getStudentProgress).mockImplementation(async (_, cohortId) => ({ data: { ...progress, status: { ...progress.status!, next_review_submission_id: cohortId === 2 ? 22 : 21 }, enrollment: { ...progress.enrollment, id: cohortId === 2 ? 12 : 11 }, cohort: { ...progress.cohort, id: cohortId || 1, name: cohortId === 2 ? 'Cohort B' : 'Cohort A' } }, error: null }))
  vi.mocked(api.getCohort).mockImplementation(async (cohortId) => ({ data: { cohort: { ...cohort, id: cohortId, name: cohortId === 2 ? 'Cohort B' : 'Cohort A' } }, error: null }))
  vi.mocked(api.getSubmissions).mockImplementation(async (params) => ({ data: { submissions: params?.cohort_id === '1' ? [submission] : params?.cohort_id === '2' ? [otherSubmission] : [otherSubmission, submission] }, error: null }))
  vi.mocked(api.getHelpRequests).mockResolvedValue({ data: { help_requests: [] }, error: null })
  vi.mocked(api.getStudentWatchProgress).mockResolvedValue({ data: { watch_progresses: [] }, error: null })
  vi.mocked(api.getStudentLessonVideoProgress).mockResolvedValue({ data: { lesson_videos: [] }, error: null })
  vi.mocked(api.getInterventions).mockResolvedValue({ data: { interventions: [] }, error: null })
  vi.mocked(api.getRecoveryPlans).mockResolvedValue({ data: { recovery_plans: [] }, error: null })
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.clearAllMocks() })

describe('student submission cohort context', () => {
  it('counts only current attempts while keeping older work in history', async () => {
    vi.mocked(api.getStudentProgress).mockResolvedValue({ data: { ...progress, status: { ...progress.status!, ungraded_count: 0, next_review_submission_id: null } }, error: null })
    vi.mocked(api.getSubmissions).mockResolvedValue({ data: { submissions: [
      { ...submission, id: 31, enrollment_id: 11, latest_submission_id: 33, grade: 'R' },
      { ...submission, id: 32, enrollment_id: 11, latest_submission_id: 33, grade: null },
      { ...submission, id: 33, enrollment_id: 11, latest_submission_id: 33, grade: 'A' },
    ] }, error: null })
    const router = createMemoryRouter([{ path: '/admin/cohorts/:cohortId/students/:id/:tab', element: <StudentWorkspace /> }], { initialEntries: ['/admin/cohorts/1/students/6/overview'] })
    await act(async () => root.render(<RouterProvider router={router} />))
    expect(container.textContent).toContain('No redo requests')
    expect(container.textContent).not.toContain('Grade next')
    const metric = Array.from(container.querySelectorAll('p')).find(p => p.textContent === 'Work waiting')!.parentElement!
    expect(metric.textContent).toContain('0')
    await act(async () => { await router.navigate('/admin/cohorts/1/students/6/work') })
    expect(container.querySelector('a[href*="/submissions/31"]')).toBeTruthy()
    expect(container.querySelector('a[href*="/submissions/32"]')).toBeTruthy()
  })

  it.each([null, 19])('checks in and completes the exact recovery plan (intervention %s)', async (interventionId) => {
    const plan: RecoveryPlan = { id: 42, source: 'manual', status: 'active', target_pace: 'One step weekly', required_scope: 'Current lesson', optional_scope: null, check_in_cadence: 'weekly', next_check_in_at: '2026-10-01T00:00:00Z', last_check_in_at: null, check_in_due: true, outcome: null, completed_at: null, created_at: '', updated_at: '', enrollment: { id: 11, status: 'active', student: { id: 6, full_name: 'Learner', email: 'learner@example.com' }, cohort: { id: 1, name: 'Cohort A' } }, owner: { id: 2, full_name: 'Staff' }, created_by: { id: 2, full_name: 'Staff' }, intervention_id: interventionId, enrollment_restart_id: null }
    vi.mocked(api.getRecoveryPlans).mockResolvedValue({ data: { recovery_plans: [plan, { ...plan, id: 43, target_pace: 'Other plan' }] }, error: null })
    const checked = { ...plan, check_in_due: false, next_check_in_at: '2026-11-01T00:00:00Z' }
    vi.mocked(api.createRecoveryPlanCheckIn).mockResolvedValueOnce({ data: null, error: 'Save failed' }).mockResolvedValue({ data: { recovery_plan: checked }, error: null })
    vi.mocked(api.updateRecoveryPlan).mockResolvedValue({ data: { recovery_plan: { ...checked, status: 'completed', outcome: 'Back on track' } }, error: null })
    const router = createMemoryRouter([{ path: '/admin/cohorts/:cohortId/students/:id/:tab', element: <StudentWorkspace /> }], { initialEntries: ['/admin/cohorts/1/students/6/support?plan_id=42'] })
    await act(async () => root.render(<RouterProvider router={router} />))
    expect(container.textContent).toContain('One step weekly')
    expect(container.textContent).not.toContain('Other plan')
    const type = async (selector: string, value: string) => {
      const field = container.querySelector(selector)!
      await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })) })
    }
    await type('textarea', 'Agreed the next step')
    const submit = async (index: number) => { await act(async () => container.querySelectorAll('form')[index].dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))) }
    await submit(0)
    expect(container.textContent).toContain('Save failed')
    expect(container.querySelector('textarea')?.value).toBe('Agreed the next step')
    await submit(0)
    expect(api.createRecoveryPlanCheckIn).toHaveBeenLastCalledWith(42, { body: 'Agreed the next step' })
    expect(container.textContent).toContain('Follow-up note saved. The next follow-up is scheduled.')
    expect(container.textContent).not.toContain('Due now')
    await type('details textarea', 'Back on track')
    await submit(1)
    expect(api.updateRecoveryPlan).toHaveBeenCalledWith(42, { status: 'completed', outcome: 'Back on track' })
    expect(container.textContent).toContain('Outcome recorded. Plan completed.')
    expect(container.querySelector('form')).toBeNull()
  })

  it('keeps Work and Grade next scoped when cohorts reuse the same content blocks', async () => {
    const router = createMemoryRouter([{ path: '/admin/cohorts/:cohortId/students/:id/:tab', element: <StudentWorkspace /> }], { initialEntries: ['/admin/cohorts/1/students/6/work'] })
    await act(async () => root.render(<RouterProvider router={router} />))
    expect(container.textContent).toContain('Work from cohort A')
    expect(container.textContent).not.toContain('Work from cohort B')
    expect(container.querySelector('a[href^="/admin/grading?cohort_id=1&student_id=6&submission=21"]')?.textContent).toContain('Grade next')

    await act(async () => { await router.navigate('/admin/cohorts/2/students/6/work') })
    expect(container.textContent).toContain('Work from cohort B')
    expect(container.textContent).not.toContain('Work from cohort A')
    expect(container.querySelector('a[href^="/admin/grading?cohort_id=2&student_id=6&submission=22"]')?.textContent).toContain('Grade next')
  })

  it.each(['progress', 'interventions'] as const)('ignores an old cohort request that finishes during %s after navigation', async (stage) => {
    let finishOld!: () => void
    if (stage === 'progress') {
      const currentImplementation = vi.mocked(api.getStudentProgress).getMockImplementation()!
      vi.mocked(api.getStudentProgress).mockImplementation((userId, cohortId) => cohortId === 1
        ? new Promise((resolve) => { finishOld = () => resolve({ data: progress, error: null }) })
        : currentImplementation(userId, cohortId))
    } else {
      vi.mocked(api.getInterventions).mockImplementation((params) => params?.enrollment_id === 11
        ? new Promise((resolve) => { finishOld = () => resolve({ data: { interventions: [] }, error: null }) })
        : Promise.resolve({ data: { interventions: [] }, error: null }))
    }
    const router = createMemoryRouter([{ path: '/admin/cohorts/:cohortId/students/:id/:tab', element: <StudentWorkspace /> }], { initialEntries: ['/admin/cohorts/1/students/6/work'] })
    await act(async () => root.render(<RouterProvider router={router} />))
    await act(async () => { await router.navigate('/admin/cohorts/2/students/6/work') })
    expect(container.textContent).toContain('Work from cohort B')
    await act(async () => finishOld())
    expect(container.textContent).toContain('Work from cohort B')
    expect(container.textContent).not.toContain('Work from cohort A')
    expect(container.querySelector('h1')?.textContent).toBe('Learner')
    expect(router.state.location.pathname).toBe('/admin/cohorts/2/students/6/work')
  })

  it('labels retained evidence for content that is no longer assigned and keeps its review link', async () => {
    const retained = structuredClone(progress)
    retained.overall_progress = { completed: 0, total: 0, percentage: 0 }
    const mod = retained.modules[0]
    mod.total_blocks = 0
    const lesson = mod.lessons[0]
    Object.assign(lesson, { assigned: false, available: false, total_blocks: 0 })
    Object.assign(lesson.blocks[0], { status: 'completed', completed_at: '2026-10-22T01:00:00Z', submission: { id: 21, grade: 'A', feedback: 'Saved feedback', submitted_at: '2026-10-22T01:00:00Z', graded_at: null } })
    lesson.blocks.push({ id: 8, title: 'Saved checkpoint', block_type: 'text', position: 2, status: 'completed', completed_at: '2026-10-22T01:00:00Z', submission: null })
    vi.mocked(api.getLearningInsights).mockResolvedValue({ data: null, error: 'No objective evidence' })
    vi.mocked(api.getStudentProgress).mockResolvedValue({ data: retained, error: null })
    const router = createMemoryRouter([{ path: '/admin/cohorts/:cohortId/students/:id/:tab', element: <StudentWorkspace /> }], { initialEntries: ['/admin/cohorts/1/students/6/learning'] })
    await act(async () => root.render(<RouterProvider router={router} />))
    const moduleDetails = container.querySelector('details')!
    await act(async () => { moduleDetails.open = true })
    expect(moduleDetails.textContent).toContain('Not currently assigned')
    expect(moduleDetails.textContent).toContain('Saved checkpoint')
    expect(moduleDetails.textContent).toContain('completed')
    expect(moduleDetails.textContent).not.toContain('Locked')
    const evidenceLink = moduleDetails.querySelector('a[href*="/submissions/21"]')
    expect(evidenceLink?.textContent).toContain('Shared exercise')
    expect(evidenceLink?.getAttribute('href')).toContain('cohort_id=1')
  })

  it.each([
    ['getSubmissions', 'work', 'Submissions', 'No submitted work'],
    ['getHelpRequests', 'support', 'Help requests', 'No support history'],
    ['getInterventions', 'support', 'Follow-up plans', 'No support history'],
    ['getRecoveryPlans', 'support', 'Return plans', 'No support history'],
    ['getStudentWatchProgress', 'overview', 'Recordings', 'Recordings completed'],
    ['getStudentLessonVideoProgress', 'overview', 'Lesson videos', 'Lesson videos completed'],
  ] as const)('recovers %s locally without claiming empty history', async (method, tab, label, falseEmpty) => {
    const mock = vi.mocked(api[method])
    const success = mock.getMockImplementation()!
    mock.mockResolvedValueOnce({ data: null, error: 'Offline' } as never)
    const router = createMemoryRouter([{ path: '/admin/cohorts/:cohortId/students/:id/:tab', element: <StudentWorkspace /> }], { initialEntries: [`/admin/cohorts/1/students/6/${tab}`] })
    await act(async () => root.render(<RouterProvider router={router} />))
    expect(container.textContent).toContain("Couldn't load")
    expect(container.textContent).not.toContain(falseEmpty)
    expect(container.querySelector('h1')?.textContent).toBe('Learner')
    const calls = vi.mocked(api.getStudentProgress).mock.calls.length
    mock.mockImplementation(success as never)
    await act(async () => (container.querySelector(`button[aria-label="Retry ${label}"]`) as HTMLButtonElement).click())
    expect(container.querySelector(`button[aria-label="Retry ${label}"]`)).toBeNull()
    expect(api.getStudentProgress).toHaveBeenCalledTimes(calls)
  })

  it('keeps successful support sections usable while another request is pending', async () => {
    vi.mocked(api.getInterventions).mockReturnValue(new Promise(() => undefined))
    const router = createMemoryRouter([{ path: '/admin/cohorts/:cohortId/students/:id/:tab', element: <StudentWorkspace /> }], { initialEntries: ['/admin/cohorts/1/students/6/support'] })
    await act(async () => root.render(<RouterProvider router={router} />))
    expect(container.textContent).toContain('No help requests')
    expect(container.querySelector('[aria-label="Follow-up plans"]')?.textContent).toContain('Loading')
    expect(container.textContent).not.toContain('No support history')
  })

  it('never shows an old student when a late secondary response arrives', async () => {
    let finish!: () => void
    vi.mocked(api.getSubmissions).mockImplementation((params) => params?.user_id === '6' ? new Promise((resolve) => { finish = () => resolve({ data: { submissions: [submission] }, error: null }) }) : Promise.resolve({ data: { submissions: [] }, error: null }))
    vi.mocked(api.getStudentProgress).mockImplementation(async (id) => ({ data: { ...progress, user: { ...progress.user, id, full_name: `Learner ${id}` } }, error: null }))
    const router = createMemoryRouter([{ path: '/admin/cohorts/:cohortId/students/:id/:tab', element: <StudentWorkspace /> }], { initialEntries: ['/admin/cohorts/1/students/6/work'] })
    await act(async () => root.render(<RouterProvider router={router} />))
    await act(async () => { await router.navigate('/admin/cohorts/1/students/9/work') })
    await act(async () => finish())
    expect(container.querySelector('h1')?.textContent).toBe('Learner 9')
    expect(container.textContent).not.toContain('Work from cohort A')
  })

  it.each(['getSubmissions', 'getHelpRequests'] as const)('drawer exposes a local %s failure with retry', async (method) => {
    vi.mocked(api[method]).mockResolvedValueOnce({ data: null, error: 'Offline' })
    const router = createMemoryRouter([{ path: '*', element: <StudentContextDrawer open cohortId={1} studentId={6} onClose={() => undefined} /> }])
    await act(async () => root.render(<RouterProvider router={router} />))
    const drawer = document.querySelector('[role="dialog"]')!
    expect(drawer.textContent).toContain("Couldn't load")
    expect(drawer.textContent).toContain('Open student page')
    expect(drawer.textContent).not.toContain(method === 'getSubmissions' ? '0to review' : '0open help')
    await act(async () => (drawer.querySelector('button[aria-label^="Retry"]') as HTMLButtonElement).click())
    expect(drawer.querySelector('button[aria-label^="Retry"]')).toBeNull()
  })

  it('keeps a successful Access save and healthy sections visible when its background refresh fails', async () => {
    vi.mocked(api.getCurriculum).mockResolvedValue({ data: { curriculum: { modules: [{ id: 3, name: 'Shared module', lessons: [] }] } }, error: null } as any)
    vi.mocked(api.createModuleAssignment).mockResolvedValue({ data: null, error: null } as any)
    vi.mocked(api.getStudentProgress).mockResolvedValueOnce({ data: progress, error: null }).mockResolvedValueOnce({ data: null, error: 'Refresh failed' })
    const router = createMemoryRouter([{ path: '/admin/cohorts/:cohortId/students/:id/:tab', element: <StudentWorkspace /> }], { initialEntries: ['/admin/cohorts/1/students/6/access'] })
    await act(async () => root.render(<RouterProvider router={router} />))
    const assign = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Assign module')!
    await act(async () => assign.click())
    expect(api.createModuleAssignment).toHaveBeenCalledWith(11, { module_id: 3, unlocked: false })
    expect(container.querySelector('h1')?.textContent).toBe('Learner')
    expect(container.textContent).toContain('Assigned Shared module.')
    expect(container.textContent).toContain("Changes saved, but this page couldn't refresh.")
    expect(container.textContent).not.toContain('Could not open this student page')
    await act(async () => { await router.navigate('/admin/cohorts/1/students/6/work') })
    expect(container.textContent).toContain('Work from cohort A')
    await act(async () => (container.querySelector('[aria-label="Retry refreshing this page"]') as HTMLButtonElement).click())
    expect(container.querySelector('[aria-label="Retry refreshing this page"]')).toBeNull()
    expect(container.textContent).toContain('Work from cohort A')
  })

  it('keeps the messaging student drawer grading link in the selected cohort', async () => {
    const router = createMemoryRouter([{ path: '*', element: <StudentContextDrawer open cohortId={1} studentId={6} onClose={() => undefined} /> }])
    await act(async () => root.render(<RouterProvider router={router} />))
    const drawer = document.querySelector('[role="dialog"]')
    expect(drawer?.querySelector('a[href*="/submissions/21"]')?.textContent).toContain('Grade next submission')
    expect(drawer?.querySelector('a[href*="/submissions/22"]')).toBeNull()
    expect(drawer?.textContent).toContain('1to review')
  })
})

it('restores Activity query context from a direct learner workspace URL', async () => {
  const returnTo = '/admin/cohorts/1?tab=activity&activity_category=work&activity_before=80'
  const router = createMemoryRouter([{ path: '/admin/cohorts/:cohortId/students/:id/:tab', element: <StudentWorkspace /> }, { path: '/admin/cohorts/1', element: <p>Activity feed</p> }], { initialEntries: [`/admin/cohorts/1/students/6/overview?return_to=${encodeURIComponent(returnTo)}`] })
  await act(async () => root.render(<RouterProvider router={router} />))
  const back = Array.from(container.querySelectorAll('a')).find(link => link.textContent === 'Back to Activity')!
  expect(back.getAttribute('href')).toBe(returnTo)
  await act(async () => back.click())
  expect(router.state.location.pathname + router.state.location.search).toBe(returnTo)
  expect(router.state.location.state).toEqual({ restoreList: true })
})

it.each([403, 404])('renders shared No access for a restricted or missing enrollment (%s)', async status => {
  vi.mocked(api.getStudentProgress).mockResolvedValue({ data: null, error: 'Private server detail', status })
  const router = createMemoryRouter([{ path: '/admin/cohorts/:cohortId/students/:id/:tab', element: <StudentWorkspace /> }], { initialEntries: ['/admin/cohorts/1/students/6/overview'] })
  await act(async () => root.render(<RouterProvider router={router} />))
  expect(container.textContent).toContain('No access')
  expect(container.textContent).not.toContain('Private server detail')
})

describe('roster queue (L-0.7)', () => {
  const origin = { returnTo: '/admin/students?filter=quiet', returnLabel: 'Students · Quiet' }
  const routes = [{ path: '/admin/cohorts/:cohortId/students/:id/:tab?', element: <StudentWorkspace /> }]
  const student = (id: number) => ({ enrollment_id: 100 + id, user_id: id, full_name: `Synthetic ${id}`, email: `s${id}@example.com`, github_username: null }) as unknown as CohortDetail['students'][number]
  const enrolled = (byCohort: Record<number, number[]>) => vi.mocked(api.getCohort).mockImplementation(async (cohortId) => (
    byCohort[cohortId] ? { data: { cohort: { ...cohort, id: cohortId, name: `Cohort ${cohortId}`, students: byCohort[cohortId].map(student) } }, error: null } : { data: null, error: 'You do not have access to this cohort.', status: 403 }
  ))
  const queue = () => container.querySelector('[data-record-queue]')
  beforeEach(() => {
    window.sessionStorage.clear()
    resetQueues()
  })

  it('walks the filtered list it was opened from, keeping the tab and the way back', async () => {
    enrolled({ 1: [5, 6, 7] })
    rememberRoster(1, origin.returnTo, [{ cohortId: 1, userId: 5 }, { cohortId: 1, userId: 6 }, { cohortId: 1, userId: 7 }])
    const router = createMemoryRouter(routes, { initialEntries: [{ pathname: '/admin/cohorts/1/students/6/work', state: origin }] })
    await act(async () => root.render(<RouterProvider router={router} />))
    expect(queue()?.textContent).toContain('2 of 3')
    await act(async () => queue()!.querySelector<HTMLButtonElement>('[aria-label="Next student"]')!.click())
    expect(router.state.location.pathname).toBe('/admin/cohorts/1/students/7/work')
    expect(queue()?.textContent).toContain('3 of 3')
    expect(queue()!.querySelector('[aria-label="Next student"]')?.hasAttribute('disabled')).toBe(true)
    expect(container.querySelector('[data-back-link]')?.textContent).toBe('Back to Students · Quiet')
    expect(container.querySelector('[data-back-link]')?.getAttribute('href')).toBe(origin.returnTo)
  })

  it('shows no counter for a student the list did not show, or with no list', async () => {
    enrolled({ 1: [5, 6] })
    rememberRoster(1, origin.returnTo, [{ cohortId: 1, userId: 5 }])
    const router = createMemoryRouter(routes, { initialEntries: [{ pathname: '/admin/cohorts/1/students/6/overview', state: origin }] })
    await act(async () => root.render(<RouterProvider router={router} />))
    expect(queue()).toBeNull()
    await act(async () => router.navigate('/admin/cohorts/1/students/5/overview'))
    expect(queue()).toBeNull()
  })

  it('ignores a roster another account remembered in this tab', async () => {
    enrolled({ 1: [5, 6, 7] })
    rememberRoster(2, origin.returnTo, [{ cohortId: 1, userId: 5 }, { cohortId: 1, userId: 6 }, { cohortId: 1, userId: 7 }])
    const router = createMemoryRouter(routes, { initialEntries: [{ pathname: '/admin/cohorts/1/students/6/overview', state: origin }] })
    await act(async () => root.render(<RouterProvider router={router} />))
    expect(container.textContent).toContain('Cohort 1')
    expect(queue()).toBeNull()
  })

  it('counts and steps only through students the viewer can still open', async () => {
    // Student 7 left cohort 1 since the list rendered; cohort 2 is checked with the viewer's own access.
    enrolled({ 1: [5, 6], 2: [8] })
    rememberRoster(1, origin.returnTo, [{ cohortId: 1, userId: 5 }, { cohortId: 1, userId: 6 }, { cohortId: 1, userId: 7 }, { cohortId: 2, userId: 8 }])
    const router = createMemoryRouter(routes, { initialEntries: [{ pathname: '/admin/cohorts/1/students/6/overview', state: origin }] })
    await act(async () => root.render(<RouterProvider router={router} />))
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
    expect(queue()?.textContent).toContain('2 of 3')
    await act(async () => queue()!.querySelector<HTMLButtonElement>('[aria-label="Next student"]')!.click())
    expect(router.state.location.pathname).toBe('/admin/cohorts/2/students/8/overview')
  })

  it('hides the counter when a cohort in the roster cannot be checked', async () => {
    enrolled({ 1: [5, 6] })
    rememberRoster(1, origin.returnTo, [{ cohortId: 1, userId: 5 }, { cohortId: 1, userId: 6 }, { cohortId: 9, userId: 8 }])
    const router = createMemoryRouter(routes, { initialEntries: [{ pathname: '/admin/cohorts/1/students/6/overview', state: origin }] })
    await act(async () => root.render(<RouterProvider router={router} />))
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
    expect(container.textContent).toContain('Cohort 1')
    expect(api.getCohort).toHaveBeenCalledWith(9, expect.any(AbortSignal))
    expect(queue()).toBeNull()
  })
})

it('uses shared counts and next review even when history differs; every metric is a focused link', async () => {
  vi.mocked(api.getStudentProgress).mockResolvedValue({ data: { ...progress, status: { ...progress.status!, ungraded_count: 7, redo_count: 4, help_request_count: 2, next_review_submission_id: 99 } }, error: null })
  const router = createMemoryRouter([{ path: '/admin/cohorts/:cohortId/students/:id/:tab', element: <StudentWorkspace /> }], { initialEntries: ['/admin/cohorts/1/students/6/overview'] })
  await act(async () => root.render(<RouterProvider router={router} />))
  expect(container.querySelector('[role="note"]')?.textContent).toContain('Why flagged')
  expect(container.querySelector('[role="note"]')?.textContent).toContain('1 latest attempt awaiting review')
  const grade = container.querySelector('a[href^="/admin/grading?"]')!
  expect(grade.textContent).toContain('Grade next (7)')
  const gradingUrl = new URL(grade.getAttribute('href')!, 'https://local')
  expect(gradingUrl.pathname).toBe('/admin/grading')
  expect(Object.fromEntries(gradingUrl.searchParams)).toMatchObject({ cohort_id: '1', student_id: '6', submission: '99' })
  expect(new URL(grade.getAttribute('href')!, 'https://local').searchParams.get('return_to')).toBe('/admin/cohorts/1/students/6/overview')
  const metric = (label: string) => [...container.querySelectorAll('a')].find(link => [...link.querySelectorAll('p')].some(p => p.textContent === label))!
  expect(metric('Work waiting').textContent).toContain('7')
  expect(metric('Work waiting').getAttribute('href')).toBe('/admin/grading?cohort_id=1&student_id=6&return_to=%2Fadmin%2Fcohorts%2F1%2Fstudents%2F6%2Foverview&filter=ungraded')
  expect(metric('Redo open').getAttribute('href')).toBe('/admin/cohorts/1/students/6/work?filter=redo')
  expect(metric('Open support').getAttribute('href')).toBe('/admin/support?cohort_id=1&student_id=6&return_to=%2Fadmin%2Fcohorts%2F1%2Fstudents%2F6%2Foverview&view=active')
  expect(metric('Learning progress').getAttribute('href')).toBe('/admin/cohorts/1/students/6/learning')
  expect(metric('Recordings completed').getAttribute('href')).toContain('/learning#recordings')
  expect(metric('Lesson videos completed').getAttribute('href')).toContain('/learning#lesson-videos')
})

it('switches the same student enrollment without losing the current tab or origin', async () => {
  const original = vi.mocked(api.getStudentProgress).getMockImplementation()!
  vi.mocked(api.getStudentProgress).mockImplementation(async (...args) => {
    const result = await original(...args)
    return { ...result, data: { ...result.data!, enrollments: [{ id: 11, cohort_id: 1, cohort_name: 'Cohort A', status: 'active' }, { id: 12, cohort_id: 2, cohort_name: 'Cohort B', status: 'paused' }] } }
  })
  const origin = { returnTo: '/admin/students?q=Learner', returnLabel: 'Students' }
  const router = createMemoryRouter([{ path: '/admin/cohorts/:cohortId/students/:id/:tab', element: <StudentWorkspace /> }], { initialEntries: [{ pathname: '/admin/cohorts/1/students/6/work', state: origin }] })
  await act(async () => root.render(<RouterProvider router={router} />))
  const select = container.querySelector<HTMLSelectElement>('[aria-label="Switch student enrollment"]')!
  expect(select).not.toBeNull()
  await act(async () => { select.value = '2'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  expect(router.state.location.pathname).toBe('/admin/cohorts/2/students/6/work')
  expect(router.state.location.state).toMatchObject(origin)
  expect(container.textContent).toContain('Work from cohort B')
  expect(container.textContent).not.toContain('Work from cohort A')
})

it('filters current redo attempts and retains the filter in submission return paths', async () => {
  vi.mocked(api.getSubmissions).mockResolvedValue({ data: { submissions: [{ ...submission, id: 30, grade: 'R', latest_submission_id: 31 }, { ...submission, id: 31, grade: 'A', latest_submission_id: 31 }, { ...submission, id: 32, content_block_id: 7, enrollment_id: 99, grade: 'R', latest_submission_id: 32 }] }, error: null })
  const router = createMemoryRouter([{ path: '/admin/cohorts/:cohortId/students/:id/:tab', element: <StudentWorkspace /> }], { initialEntries: ['/admin/cohorts/1/students/6/work?filter=redo'] })
  await act(async () => root.render(<RouterProvider router={router} />))
  const work = container.querySelector('a[href*="/submissions/32"]')!
  expect(work).not.toBeNull()
  expect(container.querySelector('a[href*="/submissions/30"]')).toBeNull()
  expect(new URL(work.getAttribute('href')!, 'https://local').searchParams.get('return_to')).toBe('/admin/cohorts/1/students/6/work?filter=redo')
})

it('scopes Support links and keeps the inline target 44px tall', async () => {
  const router = createMemoryRouter([{ path: '/admin/cohorts/:cohortId/students/:id/:tab', element: <StudentWorkspace /> }], { initialEntries: ['/admin/cohorts/1/students/6/support'] })
  await act(async () => root.render(<RouterProvider router={router} />))
  const links = [...container.querySelectorAll('a')].filter(link => link.textContent?.includes('Open Support'))
  expect(links.length).toBeGreaterThan(0)
  expect(links.every(link => link.getAttribute('href') === '/admin/support?cohort_id=1')).toBe(true)
  expect(links.every(link => link.className.includes('min-h-11'))).toBe(true)
})

it('starts an enrollment-scoped follow-up and keeps a failed draft for retry', async () => {
  vi.mocked(api.createIntervention).mockResolvedValueOnce({ data: null, error: 'Save failed' }).mockResolvedValueOnce({ data: { intervention: { id: 42 } }, error: null } as never)
  const router = createMemoryRouter([{ path: '/admin/cohorts/:cohortId/students/:id/:tab', element: <StudentWorkspace /> }, { path: '/admin/interventions/:id', element: <p>Saved plan</p> }], { initialEntries: ['/admin/cohorts/1/students/6/overview'] })
  await act(async () => root.render(<RouterProvider router={router} />))
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === 'Start follow-up plan')!.click())
  const modal = document.querySelector('[role="dialog"]')!
  await act(async () => {
    const textarea = modal.querySelector('textarea')!
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'Meet to review the exercise')
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    const date = modal.querySelector('input')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(date, '2026-12-01T16:00')
    date.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const submit = () => act(async () => modal.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  await submit()
  expect(modal.textContent).toContain('Save failed')
  expect(modal.querySelector('textarea')?.value).toBe('Meet to review the exercise')
  await submit()
  expect(api.createIntervention).toHaveBeenLastCalledWith(expect.objectContaining({ enrollment_id: 11, action_summary: 'Meet to review the exercise', next_follow_up_at: '2026-12-01T06:00:00.000Z' }))
  expect(router.state.location.pathname).toBe('/admin/interventions/42')
  expect(new URLSearchParams(router.state.location.search).get('return_to')).toBe('/admin/cohorts/1/students/6/overview')
})

it('opens an existing follow-up instead of offering a duplicate plan', async () => {
  vi.mocked(api.getStudentProgress).mockResolvedValue({ data: { ...progress, status: { ...progress.status!, active_intervention_id: 42, active_intervention_count: 1 } }, error: null })
  const router = createMemoryRouter([{ path: '/admin/cohorts/:cohortId/students/:id/:tab', element: <StudentWorkspace /> }], { initialEntries: ['/admin/cohorts/1/students/6/overview'] })
  await act(async () => root.render(<RouterProvider router={router} />))
  expect([...container.querySelectorAll('button')].some(button => button.textContent === 'Start follow-up plan')).toBe(false)
  const link = container.querySelector('a[href*="/interventions/42"]')!
  expect(link.textContent).toBe('Open follow-up plan')
  expect(new URL(link.getAttribute('href')!, 'https://local').searchParams.get('return_to')).toBe('/admin/cohorts/1/students/6/overview')
})

it('keeps enrollment work reviewable after its curriculum content changes', async () => {
  vi.mocked(api.getSubmissions).mockResolvedValue({ data: { submissions: [{ ...submission, content_block_id: 999, content_block_title: 'Retained curriculum work' }] }, error: null })
  const router = createMemoryRouter([{ path: '/admin/cohorts/:cohortId/students/:id/:tab', element: <StudentWorkspace /> }], { initialEntries: ['/admin/cohorts/1/students/6/work'] })
  await act(async () => root.render(<RouterProvider router={router} />))
  expect(container.textContent).toContain('Retained curriculum work')
  expect([...container.querySelectorAll('a')].some(link => link.textContent?.includes('Retained curriculum work') && link.href.includes('/submissions/21'))).toBe(true)
})


it('does not redirect to an old student plan when a save finishes after changing students', async () => {
  let finish!: () => void
  vi.mocked(api.createIntervention).mockImplementation(() => new Promise(resolve => { finish = () => resolve({ data: { intervention: { id: 42 } }, error: null } as never) }))
  vi.mocked(api.getStudentProgress).mockImplementation(async (id) => ({ data: { ...progress, user: { ...progress.user, id, full_name: `Learner ${id}` } }, error: null }))
  const router = createMemoryRouter([{ path: '/admin/cohorts/:cohortId/students/:id/:tab', element: <StudentWorkspace /> }, { path: '/admin/interventions/:id', element: <p>Old saved plan</p> }], { initialEntries: ['/admin/cohorts/1/students/6/overview'] })
  await act(async () => root.render(<RouterProvider router={router} />))
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === 'Start follow-up plan')!.click())
  const modal = document.querySelector('[role="dialog"]')!
  await act(async () => {
    const textarea = modal.querySelector('textarea')!
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'An old enrollment plan')
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    const date = modal.querySelector('input')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(date, '2026-12-01T16:00')
    date.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => { modal.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
  await act(async () => { await router.navigate('/admin/cohorts/1/students/9/overview') })
  await act(async () => finish())
  expect(router.state.location.pathname).toBe('/admin/cohorts/1/students/9/overview')
  expect(container.querySelector('h1')?.textContent).toBe('Learner 9')
})

it('disables the profile Message action when the server reports a block', async () => {
  const original = vi.mocked(api.getStudentProgress).getMockImplementation()!
  vi.mocked(api.getStudentProgress).mockImplementation(async (...args) => {
    const result = await original(...args)
    return { ...result, data: result.data ? { ...result.data, can_message: false } : null }
  })
  const router = createMemoryRouter([{ path: '/admin/cohorts/:cohortId/students/:id/:tab', element: <StudentWorkspace /> }], { initialEntries: ['/admin/cohorts/1/students/6/overview'] })
  await act(async () => root.render(<RouterProvider router={router} />))
  expect([...container.querySelectorAll('button')].find(button => button.textContent === 'Message')?.disabled).toBe(true)
})
