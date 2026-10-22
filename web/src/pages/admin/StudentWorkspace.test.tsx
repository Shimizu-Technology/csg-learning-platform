// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../lib/api'
import { StudentContextDrawer } from '../../components/admin/StudentContextDrawer'
import type { CohortDetail, StudentProgressResponse, Submission, RecoveryPlan } from '../../types/api'
import { StudentWorkspace } from './StudentWorkspace'

vi.mock('../../lib/api', () => ({ api: {
  getStudentProgress: vi.fn(), getCohort: vi.fn(), getSubmissions: vi.fn(),
  getHelpRequests: vi.fn(), getStudentWatchProgress: vi.fn(), getStudentLessonVideoProgress: vi.fn(),
  getInterventions: vi.fn(), getRecoveryPlans: vi.fn(), getLearningInsights: vi.fn(), createRecoveryPlanCheckIn: vi.fn(), updateRecoveryPlan: vi.fn(),
} }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const progress: StudentProgressResponse = {
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
const submission: Submission = {
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
  vi.mocked(api.getStudentProgress).mockImplementation(async (_, cohortId) => ({ data: { ...progress, enrollment: { ...progress.enrollment, id: cohortId === 2 ? 12 : 11 }, cohort: { ...progress.cohort, id: cohortId || 1, name: cohortId === 2 ? 'Cohort B' : 'Cohort A' } }, error: null }))
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
    expect(container.textContent).toContain('Check-in saved. Next check-in scheduled.')
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
    expect(container.querySelector('a[href*="/submissions/21"]')?.textContent).toContain('Grade next')

    await act(async () => { await router.navigate('/admin/cohorts/2/students/6/work') })
    expect(container.textContent).toContain('Work from cohort B')
    expect(container.textContent).not.toContain('Work from cohort A')
    expect(container.querySelector('a[href*="/submissions/22"]')?.textContent).toContain('Grade next')
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

  it('keeps the messaging student drawer grading link in the selected cohort', async () => {
    const router = createMemoryRouter([{ path: '*', element: <StudentContextDrawer open cohortId={1} studentId={6} onClose={() => undefined} /> }])
    await act(async () => root.render(<RouterProvider router={router} />))
    const drawer = document.querySelector('[role="dialog"]')
    expect(drawer?.querySelector('a[href*="/submissions/21"]')?.textContent).toContain('Grade next submission')
    expect(drawer?.querySelector('a[href*="/submissions/22"]')).toBeNull()
    expect(drawer?.textContent).toContain('1to review')
  })
})
