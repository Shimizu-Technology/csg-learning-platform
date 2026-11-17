// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { withLeaveGuard } from '../../test/TestRouter'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Grading } from './Grading'
import { SubmissionDetail } from './SubmissionDetail'
import { CohortModuleGrading } from './CohortModuleGrading'
import { HelpRequestDetail } from './HelpRequestDetail'
import { api } from '../../lib/api'
import type { HelpRequest, Submission } from '../../types/api'
import { clearRecordQueueCache } from '../../lib/recordQueueCache'
import { DISCARD_DRAFT_CONFIRMATION } from '../../lib/submissionQueue'

// L-0.7: record pages opened from a queue show "n of N", Previous/Next and
// Back to the list, and saving moves on to the next item.

const confirm = vi.hoisted(() => vi.fn().mockResolvedValue(true))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }))
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => confirm }))
// Queue sharing is per signed-in viewer; tests that need it sign one in.
const auth = vi.hoisted(() => ({ user: null as null | { id: number; is_staff: boolean; is_admin: boolean } }))
vi.mock('../../contexts/AuthContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../contexts/AuthContext')>()
  return { ...actual, useAuthContext: () => (auth.user ? { ...actual.useAuthContext(), user: auth.user as never } : actual.useAuthContext()) }
})
vi.mock('../../components/admin/StudentContextDrawer', () => ({ StudentContextDrawer: () => null }))
vi.mock('../../components/shared/CodeEditor', () => ({ CodeEditor: ({ value }: { value: string }) => <pre>{value}</pre>, detectLanguage: () => 'python' }))
vi.mock('../../components/shared/CodeRunner', () => ({ CodeRunner: () => null }))

const base: Submission = { module_position: null, course_delivery: null, week_number: null, submission_type: null, pr_url: null, live_url: null, branch: null, notes: null, submission_config: {}, cohort_name: null, repo_url: null, commit_sha: null,
  id: 42, latest_submission_id: 42, enrollment_id: 1, cohort_id: 4, user_id: 4, user_name: 'Synthetic Learner', content_block_id: 8,
  text: 'work', grade: null, feedback: null, graded_by: null, graded_at: null, num_submissions: 1, created_at: '2026-10-22T00:00:00Z',
  updated_at: '2026-10-22T00:00:00Z', content_block_title: 'Checkpoint', content_block_type: 'exercise', lesson_title: 'Lesson', lesson_id: 3,
  module_id: 2, module_name: 'Functions', filename: null, language_hint: null, github_issue_url: null, github_code_url: null, rubric: null,
}
// Three submissions, 42 newest and 40 oldest (each its own learner). Grading lists them oldest first: 40, 41, 42.
const make = (id: number, userId: number, day: number): Submission => ({ ...base, id, latest_submission_id: id, enrollment_id: userId, user_id: userId, content_block_id: 8, created_at: `2026-10-${day}T00:00:00Z` })
let store: Submission[]

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  auth.user = null
  clearRecordQueueCache()
  confirm.mockReset().mockResolvedValue(true)
  window.localStorage.setItem('csg-editor-preferences:signed-out', JSON.stringify({ mode: 'markdown', enterSends: true }))
  window.localStorage.setItem('csg-editor-preferences:1', JSON.stringify({ mode: 'markdown', enterSends: true }))
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
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.querySelectorAll('[data-state="closing"]').forEach((node) => node.remove())
  vi.restoreAllMocks()
})

async function render(entry: string) {
  const router = createMemoryRouter(withLeaveGuard([
    { path: '/admin/grading', element: <Grading /> },
    { path: '/admin/submissions/:id', element: <SubmissionDetail /> },
    { path: '/admin/cohorts/:cohortId/modules/:moduleId/grading', element: <CohortModuleGrading /> },
    { path: '/admin/help-requests/:id', element: <HelpRequestDetail /> },
    { path: '*', element: <p>Another page</p> },
  ]), { initialEntries: [entry] })
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

describe('submission records from Grading', () => {
  it('grades through a queue of three with Save and next, then says the queue is done', async () => {
    // Grading lists the oldest first (40, 41, 42); the open review's header opens its record page.
    const router = await render('/admin/grading?submission=40')
    const open = container.querySelector<HTMLAnchorElement>('[data-record-header] a[href^="/admin/submissions/40"]')!
    expect(open.getAttribute('href')).toContain('queue=ungraded')
    await act(async () => open.click())
    await settle()
    expect(counter()).toBe('1 of 3')
    await press('A')
    expect(router.state.location.pathname).toBe('/admin/submissions/41')
    expect(counter()).toBe('1 of 2')
    // Save and next opens the next review at its top, even after grading at the bottom on a phone.
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'instant' })
    await press('B')
    expect(router.state.location.pathname).toBe('/admin/submissions/42')
    expect(counter()).toBe('1 of 1')
    await press('C')
    expect(router.state.location.pathname).toBe('/admin/submissions/42')
    expect(container.textContent).toContain('That was the last submission in this queue.')
    expect(api.gradeSubmission).toHaveBeenCalledTimes(3)
    // A saved grade leaves no draft, so moving on never asks.
    expect(confirm).not.toHaveBeenCalled()
    const back = container.querySelector<HTMLAnchorElement>('[data-back-link]')!
    expect(back.textContent).toBe('Back to Grading')
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
    // Oldest first, as the Grading list showed it: 40, 41, 42.
    expect(router.state.location.pathname).toBe('/admin/submissions/42')
    // Back to the list follows you: the inbox reopens on the item you were last on.
    expect(new URLSearchParams(router.state.location.search).get('return_to')).toBe('/admin/grading?filter=all&submission=42')
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
    expect(api.getCohortModuleSubmissions).toHaveBeenCalledWith(4, 2, expect.any(AbortSignal))
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

describe('unsaved feedback and browser navigation', () => {
  it('asks before browser Back leaves a record opened from Grading, and keeps the draft on Keep editing', async () => {
    const router = await render('/admin/grading?submission=42')
    await act(async () => container.querySelector<HTMLAnchorElement>('[data-record-header] a[href^="/admin/submissions/42"]')!.click())
    await settle()
    await typeFeedback('Unsent feedback')
    confirm.mockResolvedValueOnce(false)
    await act(async () => router.navigate(-1))
    await settle()
    expect(confirm).toHaveBeenCalledExactlyOnceWith(DISCARD_DRAFT_CONFIRMATION)
    expect(router.state.location.pathname).toBe('/admin/submissions/42')
    expect(container.querySelector<HTMLTextAreaElement>('textarea[id]')!.value).toBe('Unsent feedback')
    const unload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(unload)
    expect(unload.defaultPrevented).toBe(true)
    await act(async () => router.navigate(-1))
    await settle()
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(router.state.location.pathname).toBe('/admin/grading')
  })

  it('asks before a query-only change replaces the inline review, but not for one that keeps it', async () => {
    const router = await render('/admin/grading?filter=all&submission=42')
    await typeFeedback('Unsent feedback')
    confirm.mockResolvedValueOnce(false)
    await act(async () => router.navigate('/admin/grading?filter=all&submission=41'))
    await settle()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(router.state.location.search).toBe('?filter=all&submission=42')
    expect(container.querySelector<HTMLTextAreaElement>('textarea[id]')!.value).toBe('Unsent feedback')
    await act(async () => router.navigate('/admin/grading?filter=all&submission=42#note', { replace: true }))
    await settle()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(container.querySelector<HTMLTextAreaElement>('textarea[id]')!.value).toBe('Unsent feedback')
  })

  it('lets a successful save move on without asking, and stops guarding reload', async () => {
    const router = await render(record(42, 'queue=all'))
    await typeFeedback('Nice work')
    await press('A')
    expect(router.state.location.pathname).toBe('/admin/submissions/41')
    expect(confirm).not.toHaveBeenCalled()
    const unload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(unload)
    expect(unload.defaultPrevented).toBe(false)
  })
})

describe('queue requests', () => {
  beforeEach(() => {
    auth.user = { id: 1, is_staff: true, is_admin: true }
    store = [make(42, 4, 22), make(41, 5, 21), make(40, 6, 20), make(39, 7, 19), make(38, 8, 18), make(37, 9, 17)]
  })

  it('makes one queue request for five rapid Next presses, and asks again after a grade', async () => {
    const router = await render(record(42, 'queue=all'))
    expect(counter()).toBe('1 of 6')
    for (let step = 0; step < 5; step += 1) await act(async () => button('Next submission')!.click())
    await settle()
    expect(router.state.location.pathname).toBe('/admin/submissions/37')
    expect(counter()).toBe('6 of 6')
    expect(api.getSubmissions).toHaveBeenCalledTimes(1)
    // Grading invalidates the queue; the next record fetches it fresh.
    await press('Previous submission')
    expect(api.getSubmissions).toHaveBeenCalledTimes(1)
    await press('A')
    expect(router.state.location.pathname).toBe('/admin/submissions/37')
    expect(api.getSubmissions).toHaveBeenCalledTimes(2)
  })

  it('aborts a queue request when the record is left, and drops its late answer', async () => {
    const pending: Array<{ signal?: AbortSignal; resolve: () => void }> = []
    vi.mocked(api.getSubmissions).mockImplementation((_params, signal) => new Promise((resolve) => {
      pending.push({ signal, resolve: () => resolve({ data: { submissions: store.map((item) => ({ ...item })) }, error: null }) })
    }))
    const router = await render(record(42, 'queue=all'))
    expect(pending).toHaveLength(1)
    await act(async () => router.navigate('/elsewhere'))
    await settle()
    expect(pending[0].signal?.aborted).toBe(true)
    await act(async () => pending[0].resolve())
    await act(async () => router.navigate(record(42, 'queue=all')))
    await settle()
    // The aborted request is not reused: coming back asks again.
    expect(pending).toHaveLength(2)
    expect(counter()).toBeUndefined()
    await act(async () => pending[1].resolve())
    await settle()
    expect(counter()).toBe('1 of 6')
  })

  it('ignores a queue answer that arrives after sign-out', async () => {
    let finish!: () => void
    vi.mocked(api.getSubmissions).mockImplementation(() => new Promise((resolve) => {
      finish = () => resolve({ data: { submissions: store.map((item) => ({ ...item })) }, error: null })
    }))
    await render(record(42, 'queue=all'))
    clearRecordQueueCache()
    await act(async () => finish())
    await settle()
    expect(counter()).toBeUndefined()
  })

  it('refetches a remembered queue when the next record was graded elsewhere, and says it left the queue', async () => {
    store = store.slice(0, 3)
    const router = await render(record(42, 'queue=ungraded'))
    expect(counter()).toBe('1 of 3')
    expect(api.getSubmissions).toHaveBeenCalledTimes(1)
    // Another instructor grades 41 while this queue is still remembered.
    store = store.map((item) => (item.id === 41 ? { ...item, grade: 'B' } : item))
    await press('Next submission')
    expect(router.state.location.pathname).toBe('/admin/submissions/41')
    expect(counter()).toBe('Not in queue · 2 left')
    expect(api.getSubmissions).toHaveBeenCalledTimes(2)
    await settle()
    expect(counter()).toBe('Not in queue · 2 left')
    // The fresh queue agrees with the record: no further requests.
    expect(api.getSubmissions).toHaveBeenCalledTimes(2)
    await press('Next submission')
    expect(router.state.location.pathname).toBe('/admin/submissions/42')
    expect(counter()).toBe('1 of 2')
    expect(api.getSubmissions).toHaveBeenCalledTimes(2)
  })

  it('focuses the next review after Save and next, and the notice at the end of the queue', async () => {
    store = store.slice(0, 2)
    await render(record(42, 'queue=ungraded'))
    await press('A')
    await settle()
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Submission review')
    await press('B')
    expect(document.activeElement?.getAttribute('role')).toBe('status')
    expect(document.activeElement?.textContent).toContain('That was the last submission in this queue.')
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
    vi.spyOn(api, 'replyToHelpRequest').mockImplementation(async (id, payload) => {
      const reply = { id: id * 10, body: payload.body, resolved_request: payload.resolve, author: { id: 1, full_name: 'Synthetic Staff' }, created_at: '2026-11-12T10:00:00Z' }
      requests = requests.map((item) => (item.id === id ? { ...item, status: payload.resolve ? 'resolved' : 'acknowledged', staff_response: payload.body, replies: [...(item.replies ?? []), reply] } : item))
      return { data: { help_request: requests.find((item) => item.id === id)!, reply, replayed: false }, error: null }
    })
  })
  const replyBox = () => document.querySelector<HTMLTextAreaElement>('#help-record-response')!
  async function typeReply(value: string) {
    const textarea = replyBox()
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, value)
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  const fromSupport = (id: number) => `/admin/help-requests/${id}?return_to=${encodeURIComponent('/admin/support?urgency=urgent')}`

  it('walks the filtered Support list and resolves into the next request', async () => {
    const router = await render(fromSupport(4))
    expect(counter()).toBe('1 of 2')
    expect(container.querySelector('[data-back-link]')?.textContent).toBe('Back to Support')
    await typeReply('Try the loop again.')
    await press('Reply & resolve')
    await settle()
    expect(api.replyToHelpRequest).toHaveBeenCalledWith(4, { body: 'Try the loop again.', resolve: true, client_request_id: expect.stringMatching(/^[A-Za-z0-9_-]{8,64}$/) })
    expect(router.state.location.pathname).toBe('/admin/help-requests/6')
    expect(counter()).toBe('1 of 1')
  })

  it('Reply sends the reply and keeps the request open on this page (U-4.7)', async () => {
    const router = await render(fromSupport(4))
    await typeReply('Check the loop condition.')
    await press('Send reply')
    await settle()
    expect(api.replyToHelpRequest).toHaveBeenCalledWith(4, { body: 'Check the loop condition.', resolve: false, client_request_id: expect.stringMatching(/^[A-Za-z0-9_-]{8,64}$/) })
    expect(router.state.location.pathname).toBe('/admin/help-requests/4')
    expect(container.textContent).toContain('Check the loop condition.')
    expect(container.textContent).toContain('Acknowledged')
    expect(replyBox().value).toBe('')
    // Still active, so it can be answered again or resolved.
    expect(button('Reply & resolve')).toBeTruthy()
    expect(counter()).toBe('1 of 2')
  })

  it('retries a failed reply with the same attempt id so the learner is answered once', async () => {
    await render(fromSupport(4))
    const saved = vi.mocked(api.replyToHelpRequest).getMockImplementation()!
    vi.mocked(api.replyToHelpRequest).mockResolvedValueOnce({ data: null, error: 'Network request failed', status: 0 } as never)
    await typeReply('Check the loop condition.')
    await press('Send reply')
    await settle()
    expect(replyBox().value).toBe('Check the loop condition.')
    vi.mocked(api.replyToHelpRequest).mockImplementation(saved)
    await press('Send reply')
    await settle()
    const ids = vi.mocked(api.replyToHelpRequest).mock.calls.map(([, data]) => data.client_request_id)
    expect(ids).toHaveLength(2)
    expect(ids[1]).toBe(ids[0])
    await typeReply('A second, separate hint.')
    await press('Send reply')
    await settle()
    expect(vi.mocked(api.replyToHelpRequest).mock.calls[2][1].client_request_id).not.toBe(ids[0])
  })

  it('asks before Next leaves an unsent response', async () => {
    const router = await render(fromSupport(4))
    await typeReply('Half-written')
    confirm.mockResolvedValueOnce(false)
    await press('Next help request')
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(router.state.location.pathname).toBe('/admin/help-requests/4')
    await press('Next help request')
    expect(router.state.location.pathname).toBe('/admin/help-requests/6')
  })

  async function sendResponse(value: string) {
    await typeReply(value)
    await press('Reply & resolve')
    await settle()
    await settle()
  }

  it('asks before browser Back or Message discards an unsent response, and keeps it on Keep editing', async () => {
    const router = await render('/admin/support?urgency=urgent')
    await act(async () => router.navigate(fromSupport(4)))
    await settle()
    await typeReply('Half-written')

    confirm.mockResolvedValueOnce(false)
    await act(async () => router.navigate(-1))
    await settle()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(confirm).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Discard your response?' }))
    expect(router.state.location.pathname).toBe('/admin/help-requests/4')

    vi.spyOn(api, 'createDirectConversation').mockResolvedValue({ data: { direct_conversation: { id: 77 } }, error: null } as never)
    confirm.mockResolvedValueOnce(false)
    await press('Message in Cohort 3')
    await settle()
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(router.state.location.pathname).toBe('/admin/help-requests/4')
    // The draft is still there after Keep editing.
    expect(replyBox().value).toBe('Half-written')

    const unload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(unload)
    expect(unload.defaultPrevented).toBe(true)

    await act(async () => router.navigate(-1))
    await settle()
    expect(confirm).toHaveBeenCalledTimes(3)
    expect(router.state.location.pathname).toBe('/admin/support')
  })

  it('focuses the next request after Next, Previous or Resolve and next, and the notice at the end', async () => {
    const router = await render(fromSupport(4))
    await press('Next help request')
    await settle()
    expect(router.state.location.pathname).toBe('/admin/help-requests/6')
    expect(document.activeElement?.tagName).toBe('H1')
    expect(document.activeElement?.textContent).toBe('Question 6')
    await press('Previous help request')
    await settle()
    expect(router.state.location.pathname).toBe('/admin/help-requests/4')
    expect(document.activeElement?.textContent).toBe('Question 4')
    await sendResponse('Try the loop again.')
    expect(router.state.location.pathname).toBe('/admin/help-requests/6')
    expect(document.activeElement?.textContent).toBe('Question 6')
    await sendResponse('All set.')
    expect(router.state.location.pathname).toBe('/admin/help-requests/6')
    expect(document.activeElement?.getAttribute('role')).toBe('status')
    expect(document.activeElement?.textContent).toContain('That was the last request in this list.')
  })

  it('fetches the Support queue once while stepping, and again after a resolve', async () => {
    auth.user = { id: 1, is_staff: true, is_admin: true }
    requests = [4, 5, 6, 7, 8, 9].map((id) => help(id, 'urgent'))
    const router = await render(fromSupport(4))
    expect(counter()).toBe('1 of 6')
    for (let step = 0; step < 5; step += 1) await act(async () => button('Next help request')!.click())
    await settle()
    expect(router.state.location.pathname).toBe('/admin/help-requests/9')
    expect(counter()).toBe('6 of 6')
    expect(api.getSupportQueue).toHaveBeenCalledTimes(1)
    await sendResponse('Done.')
    // Resolving invalidates the queue: the request before it is next, from a fresh list.
    expect(router.state.location.pathname).toBe('/admin/help-requests/8')
    expect(api.getSupportQueue).toHaveBeenCalledTimes(2)
    expect(counter()).toBe('5 of 5')
  })

  it('refetches a remembered Support queue when the next request was resolved elsewhere', async () => {
    auth.user = { id: 1, is_staff: true, is_admin: true }
    const router = await render(fromSupport(4))
    expect(counter()).toBe('1 of 2')
    expect(api.getSupportQueue).toHaveBeenCalledTimes(1)
    // Another staff member resolves 6 while this queue is still remembered.
    requests = requests.map((item) => (item.id === 6 ? { ...item, status: 'resolved' as HelpRequest['status'] } : item))
    await press('Next help request')
    await settle()
    expect(router.state.location.pathname).toBe('/admin/help-requests/6')
    expect(counter()).toBe('Not in queue · 1 left')
    expect(api.getSupportQueue).toHaveBeenCalledTimes(2)
  })

  it('keeps the student scope when following an open-support card into a request', async () => {
    await render('/admin/help-requests/4?return_to=' + encodeURIComponent('/admin/support?cohort_id=1&student_id=6&view=active'))
    expect(api.getSupportQueue).toHaveBeenCalledWith(1, expect.any(AbortSignal), { studentId: 6, lessonId: null, moduleId: null })
  })

  it('has no counter when opened from anywhere else' , async () => {
    await render('/admin/help-requests/4')
    expect(container.querySelector('[data-record-queue]')).toBeNull()
    expect(api.getSupportQueue).not.toHaveBeenCalled()
  })
})
