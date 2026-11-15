// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Grading } from './Grading'
import { SubmissionDetail } from './SubmissionDetail'
import { CohortModuleGrading } from './CohortModuleGrading'
import { HelpRequestDetail } from './HelpRequestDetail'
import { api } from '../../lib/api'
import type { HelpRequest, Submission } from '../../types/api'

// L-0.7: record pages opened from a queue show "n of N", Previous/Next and
// Back to the list, and saving moves on to the next item.

const confirm = vi.hoisted(() => vi.fn().mockResolvedValue(true))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }))
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => confirm }))
vi.mock('../../components/admin/StudentContextDrawer', () => ({ StudentContextDrawer: () => null }))
vi.mock('../../components/shared/CodeEditor', () => ({ CodeEditor: ({ value }: { value: string }) => <pre>{value}</pre>, detectLanguage: () => 'python' }))
vi.mock('../../components/shared/CodeRunner', () => ({ CodeRunner: () => null }))

const base: Submission = {
  id: 42, latest_submission_id: 42, enrollment_id: 1, cohort_id: 4, user_id: 4, user_name: 'Synthetic Learner', content_block_id: 8,
  text: 'work', grade: null, feedback: null, graded_by: null, graded_at: null, num_submissions: 1, created_at: '2026-10-22T00:00:00Z',
  updated_at: '2026-10-22T00:00:00Z', content_block_title: 'Checkpoint', content_block_type: 'exercise', lesson_title: 'Lesson', lesson_id: 3,
  module_id: 2, module_name: 'Functions', filename: null, language_hint: null, github_issue_url: null, github_code_url: null, rubric: null,
}
// A queue of three, newest first: 42, 41, 40 (each its own learner).
const make = (id: number, userId: number, day: number): Submission => ({ ...base, id, latest_submission_id: id, enrollment_id: userId, user_id: userId, content_block_id: 8, created_at: `2026-10-${day}T00:00:00Z` })
let store: Submission[]

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  confirm.mockReset().mockResolvedValue(true)
  window.localStorage.setItem('csg-editor-preferences:signed-out', JSON.stringify({ mode: 'markdown', enterSends: true }))
  window.sessionStorage.clear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  store = [make(42, 4, 22), make(41, 5, 21), make(40, 6, 20)]
  vi.spyOn(api, 'getSubmissions').mockImplementation(async () => ({ data: { submissions: store.map((item) => ({ ...item })) }, error: null }))
  vi.spyOn(api, 'getSubmission').mockImplementation(async (id) => ({ data: { submission: { ...store.find((item) => item.id === id)! } }, error: null }))
  vi.spyOn(api, 'gradeSubmission').mockImplementation(async (id, payload) => {
    store = store.map((item) => (item.id === id ? { ...item, grade: payload.grade, feedback: payload.feedback || null } : item))
    return { data: { submission: { ...store.find((item) => item.id === id)! } }, error: null }
  })
  vi.spyOn(api, 'getCohorts').mockResolvedValue({ data: { cohorts: [] }, error: null })
  vi.spyOn(api, 'getCohortModuleSubmissions').mockImplementation(async () => ({ data: { cohort_id: 4, cohort_name: 'Pilot', module_id: 2, module_name: 'Functions', students: [], exercises: [], progresses: [], submissions: store.map((item) => ({ ...item })) }, error: null }))
  vi.spyOn(api, 'getFeedbackSnippets').mockResolvedValue({ data: { feedback_snippets: [] }, error: null } as never)
  vi.spyOn(api, 'getStudentProgress').mockResolvedValue({ data: null, error: 'skip' } as never)
  vi.spyOn(api, 'getRecordRelated').mockResolvedValue({ data: null, error: 'unavailable' } as never)
  window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.querySelectorAll('[data-state="closing"]').forEach((node) => node.remove())
  vi.restoreAllMocks()
})

async function render(entry: string) {
  const router = createMemoryRouter([
    { path: '/admin/grading', element: <Grading /> },
    { path: '/admin/submissions/:id', element: <SubmissionDetail /> },
    { path: '/admin/cohorts/:cohortId/modules/:moduleId/grading', element: <CohortModuleGrading /> },
    { path: '/admin/help-requests/:id', element: <HelpRequestDetail /> },
    { path: '*', element: <p>Another page</p> },
  ], { initialEntries: [entry] })
  await act(async () => root.render(<RouterProvider router={router} />))
  await settle()
  return router
}
const settle = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)))
const counter = () => container.querySelector('[data-record-queue] span')?.textContent
const button = (name: string) => [...container.querySelectorAll('button')].find((item) => item.textContent?.trim() === name || item.getAttribute('aria-label') === name)
async function press(name: string) {
  const target = button(name)
  expect(target, name).toBeTruthy()
  await act(async () => target!.click())
  await settle()
}
async function key(value: string) {
  await act(async () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true })))
  await settle()
}
async function typeFeedback(value: string) {
  const textarea = container.querySelector<HTMLTextAreaElement>('textarea[id]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, value)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const record = (id: number, search: string) => `/admin/submissions/${id}?${search}`

describe('submission records from the Grading inbox', () => {
  it('grades through a queue of three with Save and next, then says the queue is done', async () => {
    const router = await render('/admin/grading')
    const open = container.querySelector<HTMLAnchorElement>('a[href^="/admin/submissions/42"]')!
    expect(open.getAttribute('href')).toContain('queue=ungraded')
    await act(async () => open.click())
    await settle()
    expect(counter()).toBe('1 of 3')
    await press('A')
    expect(router.state.location.pathname).toBe('/admin/submissions/41')
    expect(counter()).toBe('1 of 2')
    await press('B')
    expect(router.state.location.pathname).toBe('/admin/submissions/40')
    expect(counter()).toBe('1 of 1')
    await press('C')
    expect(router.state.location.pathname).toBe('/admin/submissions/40')
    expect(container.textContent).toContain('That was the last submission in this queue.')
    expect(api.gradeSubmission).toHaveBeenCalledTimes(3)
    // A saved grade leaves no draft, so moving on never asks.
    expect(confirm).not.toHaveBeenCalled()
    const back = container.querySelector<HTMLAnchorElement>('[data-back-link]')!
    expect(back.textContent).toBe('Back to Grading inbox')
    await act(async () => back.click())
    expect(router.state.location.pathname).toBe('/admin/grading')
  })

  it('steps with Previous/Next and J/K, asking first about an unsaved draft', async () => {
    const router = await render(record(41, `queue=all&return_to=${encodeURIComponent('/admin/grading?filter=all&submission=41')}`))
    expect(counter()).toBe('2 of 3')
    await typeFeedback('Unsent feedback')
    confirm.mockResolvedValueOnce(false)
    await key('j')
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(router.state.location.pathname).toBe('/admin/submissions/41')
    await press('Next submission')
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(router.state.location.pathname).toBe('/admin/submissions/40')
    // Back to the list follows you: the inbox reopens on the item you were last on.
    expect(new URLSearchParams(router.state.location.search).get('return_to')).toBe('/admin/grading?filter=all&submission=40')
    expect(counter()).toBe('3 of 3')
    expect(button('Next submission')?.hasAttribute('disabled')).toBe(true)
    await key('k')
    expect(router.state.location.pathname).toBe('/admin/submissions/41')
    expect(confirm).toHaveBeenCalledTimes(2)
  })

  it('does not take J/K from a text field', async () => {
    const router = await render(record(41, 'queue=all'))
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea[id]')!
    await act(async () => textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true })))
    expect(router.state.location.pathname).toBe('/admin/submissions/41')
  })

  it('says when someone else already graded this one and offers the first still waiting', async () => {
    store = store.map((item) => (item.id === 42 ? { ...item, grade: 'A' } : item))
    const router = await render(record(42, 'queue=ungraded'))
    expect(counter()).toBe('Not in queue · 2 left')
    expect(button('Previous submission')?.hasAttribute('disabled')).toBe(true)
    await press('Next submission')
    expect(router.state.location.pathname).toBe('/admin/submissions/41')
    expect(counter()).toBe('1 of 2')
  })

  it('shows no counter on a deep link with no queue, or with a queue value it does not know', async () => {
    await render('/admin/submissions/42')
    expect(container.querySelector('[data-record-queue]')).toBeNull()
    expect(api.getSubmissions).not.toHaveBeenCalled()
    await act(async () => root.unmount())
    root = createRoot(container)
    await render(record(42, 'queue=everything&queue_cohort_id=-4'))
    expect(container.querySelector('[data-record-queue]')).toBeNull()
    expect(api.getSubmissions).not.toHaveBeenCalled()
  })
})

describe('submission records from a module grading page', () => {
  const moduleReturn = (search: string) => `cohort_id=4&return_to=${encodeURIComponent(`/admin/cohorts/4/modules/2/grading?${search}`)}`

  it('walks the module page queue and keeps its selection for Back', async () => {
    const router = await render(record(42, moduleReturn('view=queue&filter=ungraded&review=42')))
    expect(api.getCohortModuleSubmissions).toHaveBeenCalledWith(4, 2)
    expect(counter()).toBe('1 of 3')
    await press('Next submission')
    expect(router.state.location.pathname).toBe('/admin/submissions/41')
    expect(new URLSearchParams(router.state.location.search).get('return_to')).toBe('/admin/cohorts/4/modules/2/grading?view=queue&filter=ungraded&review=41')
    await press('A')
    expect(router.state.location.pathname).toBe('/admin/submissions/40')
  })

  it('ignores a module queue the viewer cannot open', async () => {
    vi.mocked(api.getCohortModuleSubmissions).mockResolvedValue({ data: null, error: 'You do not have access to this cohort.', status: 403 } as never)
    await render(record(42, moduleReturn('view=queue')))
    expect(container.querySelector('[data-record-queue]')).toBeNull()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('You do not have access')
  })

  it('never builds a queue from an unsafe return path', async () => {
    await render(record(42, `return_to=${encodeURIComponent('//evil.example/admin/cohorts/4/modules/2/grading')}`))
    expect(api.getCohortModuleSubmissions).not.toHaveBeenCalled()
    expect(container.querySelector('[data-record-queue]')).toBeNull()
  })
})

describe('help requests from Support', () => {
  const help = (id: number, urgency: 'urgent' | 'normal'): HelpRequest => ({
    id, cohort: { id: 3, name: 'Cohort 3' }, context_type: 'lesson', context_source: 'primary', context_id: 40, context_label: `Question ${id}`,
    context_path: '/lessons/40', category: 'concept', urgency, status: 'open', message: 'Synthetic question', staff_response: null,
    acknowledged_at: null, resolved_at: null, canceled_at: null, created_at: '2026-11-12T09:00:00Z', updated_at: '2026-11-12T09:00:00Z', owner: null,
    student: { id: 9, full_name: 'Synthetic Student', email: 'student@example.com' },
  } as HelpRequest)
  let requests: HelpRequest[]
  beforeEach(() => {
    requests = [help(4, 'urgent'), help(5, 'normal'), help(6, 'urgent')]
    vi.spyOn(api, 'getHelpRequest').mockImplementation(async (id) => ({ data: { help_request: requests.find((item) => item.id === id)! }, error: null }))
    vi.spyOn(api, 'getSupportQueue').mockImplementation(async () => ({ data: { support_queue: { help_requests: requests.filter((item) => item.status !== 'resolved'), recently_resolved: requests.filter((item) => item.status === 'resolved'), students: [], interventions: [], recovery_plans: [], summary: {} } }, error: null }) as never)
    vi.spyOn(api, 'updateHelpRequest').mockImplementation(async (id, payload) => {
      requests = requests.map((item) => (item.id === id ? { ...item, status: payload.status as HelpRequest['status'], staff_response: payload.staff_response ?? null } : item))
      return { data: { help_request: requests.find((item) => item.id === id)! }, error: null }
    })
  })
  const fromSupport = (id: number) => `/admin/help-requests/${id}?return_to=${encodeURIComponent('/admin/support?urgency=urgent')}`

  it('walks the filtered Support list and resolves into the next request', async () => {
    const router = await render(fromSupport(4))
    expect(counter()).toBe('1 of 2')
    expect(container.querySelector('[data-back-link]')?.textContent).toBe('Back to Support')
    await press('Respond & resolve')
    const textarea = document.querySelector<HTMLTextAreaElement>('#help-record-response, [role="dialog"] textarea')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'Try the loop again.')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => document.querySelector<HTMLFormElement>('[role="dialog"] form')!.requestSubmit())
    await settle()
    expect(api.updateHelpRequest).toHaveBeenCalledWith(4, expect.objectContaining({ status: 'resolved' }))
    expect(router.state.location.pathname).toBe('/admin/help-requests/6')
    expect(counter()).toBe('1 of 1')
  })

  it('asks before Next leaves an unsent response', async () => {
    const router = await render(fromSupport(4))
    await press('Respond & resolve')
    const textarea = document.querySelector<HTMLTextAreaElement>('[role="dialog"] textarea')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'Half-written')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    await settle()
    document.querySelectorAll('[data-state="closing"]').forEach((node) => node.remove())
    confirm.mockResolvedValueOnce(false)
    await press('Next help request')
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(router.state.location.pathname).toBe('/admin/help-requests/4')
    await press('Next help request')
    expect(router.state.location.pathname).toBe('/admin/help-requests/6')
  })

  it('has no counter when opened from anywhere else', async () => {
    await render('/admin/help-requests/4')
    expect(container.querySelector('[data-record-queue]')).toBeNull()
    expect(api.getSupportQueue).not.toHaveBeenCalled()
  })
})
