// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../lib/api'
import { Grading } from './Grading'
import { SubmissionDetail } from './SubmissionDetail'
import type { StudentProgressResponse, Submission } from '../../types/api'

vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }))
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => vi.fn().mockResolvedValue(true) }))
vi.mock('../../components/admin/StudentContextDrawer', () => ({ StudentContextDrawer: () => null }))
vi.mock('../../components/shared/CodeEditor', () => ({ CodeEditor: ({ value }: { value: string }) => <pre>{value}</pre>, detectLanguage: () => 'python' }))
vi.mock('../../components/shared/CodeRunner', () => ({ CodeRunner: () => null }))

const previous = { id: 1, latest_submission_id: 2, user_id: 4, user_name: 'Learner', content_block_id: 8, text: 'old work', grade: 'R', feedback: 'Old feedback', graded_by: 'Instructor', graded_at: '2026-10-20T00:00:00Z', num_submissions: 1, created_at: '2026-10-20T00:00:00Z', updated_at: '2026-10-20T00:00:00Z', content_block_title: 'Checkpoint', content_block_type: 'checkpoint', lesson_title: 'Lesson', lesson_id: 3, module_id: 2, module_name: 'Module', filename: null, language_hint: null, github_issue_url: null, github_code_url: null } satisfies Submission
const latest = { ...previous, id: 2, num_submissions: 2, grade: null, feedback: null, text: 'latest work', created_at: '2026-10-21T00:00:00Z' }
let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.spyOn(api, 'getSubmission').mockImplementation(async (id) => ({ data: { submission: id === 1 ? previous : latest }, error: null }))
  vi.spyOn(api, 'getSubmissions').mockResolvedValue({ data: { submissions: [latest, previous] }, error: null })
  vi.spyOn(api, 'getCohorts').mockResolvedValue({ data: { cohorts: [] }, error: null })
  vi.spyOn(api, 'getFeedbackSnippets').mockResolvedValue({ data: { feedback_snippets: [] }, error: null })
  vi.spyOn(api, 'gradeSubmission').mockResolvedValue({ data: null, error: 'This is a previous attempt.', status: 409, latestSubmissionId: 2 })
  window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks() })

async function renderPage(entry: string) {
  const router = createMemoryRouter([
    { path: '/admin/grading', element: <Grading /> },
    { path: '/admin/submissions/:id', element: <SubmissionDetail /> },
  ], { initialEntries: [entry] })
  await act(async () => { root.render(<RouterProvider router={router} />) })
  return router
}

describe('historical grading', () => {
  it('keeps validated enrollment context, queue filters and the return destination on the latest attempt', async () => {
    const progress = { cohort: { id: 7, name: 'Python pilot' }, modules: [{ lessons: [{ blocks: [{ id: 8 }] }] }] } as unknown as StudentProgressResponse
    vi.spyOn(api, 'getStudentProgress').mockResolvedValue({ data: progress, error: null })
    const returnTo = '/admin/grading?filter=all&cohort_id=7'
    const router = await renderPage(`/admin/submissions/1?cohort_id=7&student_id=4&queue=all&queue_cohort_id=7&return_to=${encodeURIComponent(returnTo)}`)
    const link = Array.from(container.querySelectorAll('a')).find((item) => item.textContent === 'Grade the latest attempt')!
    const context = Object.fromEntries(new URL(link.href).searchParams)
    expect(context).toEqual({ cohort_id: '7', student_id: '4', queue: 'all', queue_cohort_id: '7', return_to: returnTo })
    await act(async () => link.click())
    expect(router.state.location.pathname).toBe('/admin/submissions/2')
    expect(Object.fromEntries(new URLSearchParams(router.state.location.search))).toEqual(context)
    expect(container.textContent).toContain('latest work')
    expect(api.getStudentProgress).toHaveBeenLastCalledWith(4, 7)
  })

  it('does not forward unvalidated enrollment context or an external return destination', async () => {
    const router = await renderPage('/admin/submissions/1?cohort_id=99&student_id=999&queue=invalid&return_to=//external.example')
    const link = Array.from(container.querySelectorAll('a')).find((item) => item.textContent === 'Grade the latest attempt')!
    await act(async () => link.click())
    expect(Object.fromEntries(new URLSearchParams(router.state.location.search))).toEqual({ student_id: '4', return_to: '/admin/grading' })
  })

  it('keeps the grading list selection and filter when opening the latest attempt', async () => {
    await renderPage('/admin/grading?filter=all&cohort_id=7&submission=1')
    const link = Array.from(container.querySelectorAll('a')).find((item) => item.textContent === 'Grade the latest attempt')!
    expect(Object.fromEntries(new URL(link.href).searchParams)).toEqual({ cohort_id: '7', student_id: '4', queue: 'all', queue_cohort_id: '7', return_to: '/admin/grading?filter=all&cohort_id=7&submission=1' })
  })

  it.each(['/admin/submissions/1', '/admin/grading?filter=all&submission=1'])('keeps previous work inspectable and disables every review control at %s', async (entry) => {
    await renderPage(entry)
    expect(container.textContent).toContain('old work')
    expect(container.textContent).toContain('Previous attempt · read-only')
    expect(Array.from(container.querySelectorAll('a')).find((link) => link.textContent === 'Grade the latest attempt')?.pathname).toBe('/admin/submissions/2')
    const review = container.querySelector('fieldset')!
    expect(review.disabled).toBe(true)
    expect(review.querySelector('textarea')?.matches(':disabled')).toBe(true)
    const grade = Array.from(review.querySelectorAll('button')).find((button) => button.textContent?.includes('A'))!
    await act(async () => grade.click())
    expect(api.gradeSubmission).not.toHaveBeenCalled()
  })

  it('converts an open review to read-only after a newer attempt arrives, retaining feedback', async () => {
    vi.mocked(api.getSubmission).mockResolvedValue({ data: { submission: { ...previous, latest_submission_id: 1 } }, error: null })
    await renderPage('/admin/submissions/1')
    const input = container.querySelector('textarea')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'My review draft')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Grade A')!.click() })
    expect(container.querySelector('fieldset')?.disabled).toBe(true)
    expect(container.querySelector('textarea')?.value).toBe('My review draft')
    expect(container.textContent).toContain('Grade the latest attempt')
  })
})
