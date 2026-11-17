// @vitest-environment jsdom
import { act, useEffect, useState, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * W8 PR 8.2: My work (L-1.2) and help answers that open on the lesson (L-1.3).
 * New behavior shows only with the new student experience on; off keeps
 * today's labels and copy.
 */
const state = vi.hoisted(() => ({ cohortId: 9, user: { id: 5, full_name: 'Alex Rivera', is_staff: false } }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: state.user, enrollments: [{ cohort: { id: state.cohortId, review_response_time: 'usually reviewed within 2 days' } }] }) }))
vi.mock('../../contexts/CohortContext', () => ({ useCohortContext: () => ({ selectedCohortId: state.cohortId }) }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))
vi.mock('../../components/shared/Modal', () => ({ Modal: ({ open, children }: { open: boolean; children: ReactNode }) => open ? <div role="dialog">{children}</div> : null }))
vi.mock('../../components/shared/FeedbackBody', () => ({ FeedbackBody: ({ feedback }: { feedback: string }) => <div data-feedback="">{feedback}</div> }))
vi.mock('../../components/shared/LazyMarkdownEditor', () => ({ LazyMarkdownEditor: () => null }))
vi.mock('../../lib/api', () => ({ api: { getMyWork: vi.fn(), createDirectConversation: vi.fn(), getHelpRequests: vi.fn() } }))

import { api } from '../../lib/api'
import { MyWorkPage } from './MyWork'
import { ContextualHelp } from '../../components/student/ContextualHelp'
import { StudentExperienceProvider } from '../../lib/studentExperience'
import { composerDestinationKey, readComposerDraft } from '../../lib/messageComposerState'
import type { HelpRequest, LearnerCapabilities } from '../../types/api'

const person = (id: number, full_name: string) => ({ id, full_name })
const item = (submission_id: number, status: 'redo' | 'waiting' | 'graded') => ({
  submission_id, status, cohort_id: 9, lesson_id: 100 + submission_id, content_block_id: 700 + submission_id, lesson_title: `Lesson ${submission_id}`, block_title: `Lesson ${submission_id}`,
  module_name: 'JavaScript Foundations', week: 8, attempt: 1, grade: status === 'redo' ? 'R' : status === 'graded' ? 'A' : null,
  feedback: status === 'waiting' ? null : `Feedback for ${submission_id}: return the string.`, submitted_at: '2026-11-11T00:00:00Z', graded_at: status === 'waiting' ? null : '2026-11-16T00:00:00Z',
  grader: status === 'waiting' ? null : person(status === 'graded' && submission_id % 2 ? 6 : 2, status === 'graded' && submission_id % 2 ? 'Leon Shimizu' : 'Audreana Synthetic'),
  ask_to: status === 'waiting' ? null : person(2, 'Audreana Synthetic'),
  submission_type: 'text_submission', submissions_closed: false, can_resubmit: status === 'redo',
})
const myWork = (graded = 3) => ({
  cohort: { id: 9, name: 'Cohort 4' }, read_only: false, review_response_time: 'usually reviewed within 2 days', reviewer: person(2, 'Audreana Synthetic'), contact: person(2, 'Audreana Synthetic'),
  counts: { needs_you: 1, waiting: 2, graded },
  needs_you: [item(1, 'redo')], waiting: [item(2, 'waiting'), item(3, 'waiting')], graded: Array.from({ length: graded }, (_, index) => item(10 + index, 'graded')),
})

function Destination() { const location = useLocation(); return <div data-destination="">{location.pathname}{location.search}</div> }
let root: Root
let container: HTMLDivElement
let renders = 0
async function render(node: ReactNode, path: string, route: string) {
  await act(async () => { root.render(<MemoryRouter key={++renders} initialEntries={[path]}><Routes><Route path={route} element={node} /><Route path="*" element={<Destination />} /></Routes></MemoryRouter>) })
  await act(async () => { await Promise.resolve() })
}
const button = (label: string) => Array.from(container.querySelectorAll('button')).find((element) => element.textContent?.includes(label))
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear()
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('My work', () => {
  it('opens the first tab with work, shows each count as its list and keeps the tab in the URL', async () => {
    vi.mocked(api.getMyWork).mockResolvedValue({ data: { my_work: myWork() } as never, error: null })
    await render(<MyWorkPage />, '/my-work?cohort_id=9', '/my-work')
    expect(api.getMyWork).toHaveBeenCalledWith(9)
    const tabs = Array.from(container.querySelectorAll('[role="tab"]')).map((tab) => [tab.textContent, tab.getAttribute('aria-selected')])
    expect(tabs).toEqual([['Needs you1', 'true'], ['Waiting for review2', 'false'], ['Graded3', 'false']])
    expect(container.querySelectorAll('[data-work-status="redo"]')).toHaveLength(1)
    expect(container.textContent).toContain('Feedback for 1: return the string.')
    expect(container.textContent).toContain('reviewed by Audreana Synthetic')
    expect([...container.querySelectorAll('a[href="/lessons/101?cohort_id=9#block-701"]')].map((link) => link.textContent)).toEqual(['Lesson 1', 'Open and resubmit'])

    await act(async () => { (container.querySelectorAll('[role="tab"]')[1] as HTMLButtonElement).click() })
    expect(container.querySelectorAll('[data-work-status="waiting"]')).toHaveLength(2)
    expect(container.textContent).toContain('Audreana usually reviews within 2 days')
    expect(container.textContent).not.toContain('Ask about this feedback')
  })

  it('Ask about this feedback opens the grader’s conversation with the lesson linked', async () => {
    vi.mocked(api.getMyWork).mockResolvedValue({ data: { my_work: myWork() } as never, error: null })
    vi.mocked(api.createDirectConversation).mockResolvedValue({ data: { direct_conversation: { id: 44, cohort_id: 9 } } as never, error: null })
    await render(<MyWorkPage />, '/my-work?cohort_id=9&tab=graded', '/my-work')
    expect(container.querySelectorAll('[data-work-status="graded"]')).toHaveLength(3)
    expect(container.textContent).toContain('reviewed by Leon Shimizu')
    await act(async () => { button('Ask about this feedback')!.click() })
    await act(async () => { await Promise.resolve() })
    expect(api.createDirectConversation).toHaveBeenCalledWith({ cohort_id: 9, user_ids: [2] })
    expect(container.querySelector('[data-destination]')?.textContent).toBe('/messages/dm/44?cohort_id=9')
    const draft = readComposerDraft(composerDestinationKey(5, { type: 'dm', id: 44 }, null), localStorage)
    expect(draft?.body).toContain('[Feedback on Lesson 10](')
    expect(draft?.body).toContain('/lessons/110?cohort_id=9#block-710')
  })

  it('shows graded work ten at a time and says what counts as work when a tab is empty', async () => {
    vi.mocked(api.getMyWork).mockResolvedValue({ data: { my_work: { ...myWork(38), counts: { needs_you: 0, waiting: 0, graded: 38 }, needs_you: [], waiting: [] } } as never, error: null })
    await render(<MyWorkPage />, '/my-work?cohort_id=9', '/my-work')
    expect(container.querySelectorAll('[data-work-status="graded"]')).toHaveLength(10)
    expect(button('more')?.textContent).toBe('Show 28 more')
    await act(async () => { (container.querySelectorAll('[role="tab"]')[0] as HTMLButtonElement).click() })
    expect(container.textContent).toContain('Nothing needs you right now')
  })
})

const capabilities: LearnerCapabilities = { live_support: true, features: {}, can_submit: true, read_only: false, support_mode: 'guided_help', support_expires_at: null, access_expires_at: null, support_instructor_id: 2 }
const request = (overrides: Partial<HelpRequest> = {}): HelpRequest => ({ destination: null, context_destination: null, id: 31, cohort: { id: 9, name: 'Cohort 4' }, context_type: 'lesson', context_source: 'primary', context_id: 42, context_label: 'Loops', context_path: '/lessons/42', category: 'concept', urgency: 'normal', status: 'acknowledged', message: 'My loop never stops', staff_response: 'Check the condition.', acknowledged_at: '2026-11-17T00:00:00Z', resolved_at: null, canceled_at: null, created_at: '2026-11-17T00:00:00Z', updated_at: '2026-11-17T00:00:00Z', owner: person(2, 'Audreana Synthetic'), replies: [{ id: 1, body: 'Check the condition.', resolved_request: false, author: person(2, 'Audreana Synthetic'), created_at: '2026-11-17T01:00:00Z' }], ...overrides })
describe('who Ask about this feedback reaches (fix round)', () => {
  it('asks the server-chosen person, keeps the grader named, and offers nothing when nobody is reachable', async () => {
    const rows = [{ ...item(10, 'graded'), grader: person(7, 'Former Instructor'), ask_to: person(2, 'Audreana Synthetic') }, { ...item(11, 'graded'), grader: person(8, 'Blocked Grader'), ask_to: null }]
    vi.mocked(api.getMyWork).mockResolvedValue({ data: { my_work: { ...myWork(0), counts: { needs_you: 0, waiting: 0, graded: 2 }, needs_you: [], waiting: [], graded: rows } } as never, error: null })
    vi.mocked(api.createDirectConversation).mockResolvedValue({ data: { direct_conversation: { id: 45, cohort_id: 9 } } as never, error: null })
    await render(<MyWorkPage />, '/my-work?cohort_id=9&tab=graded', '/my-work')
    const [former, blocked] = Array.from(container.querySelectorAll('[data-work-status="graded"]'))
    expect(former.textContent).toContain('reviewed by Former Instructor')
    expect(blocked.textContent).toContain('reviewed by Blocked Grader')
    expect(blocked.textContent).not.toContain('Ask about this feedback')
    await act(async () => { Array.from(former.querySelectorAll('button')).find((element) => element.textContent?.includes('Ask about this feedback'))!.click() })
    await act(async () => { await Promise.resolve() })
    expect(api.createDirectConversation).toHaveBeenCalledWith({ cohort_id: 9, user_ids: [2] })
  })

  it('another cohort’s rows go away while its work loads', async () => {
    let finish!: (value: unknown) => void
    vi.mocked(api.getMyWork).mockResolvedValueOnce({ data: { my_work: myWork() } as never, error: null }).mockReturnValueOnce(new Promise((resolve) => { finish = resolve }) as never)
    await render(<MyWorkPage />, '/my-work?cohort_id=9', '/my-work')
    expect(container.querySelectorAll('[data-work-status]').length).toBeGreaterThan(0)
    state.cohortId = 10
    await act(async () => { root.render(<MemoryRouter key={renders} initialEntries={['/my-work?cohort_id=10']}><Routes><Route path="/my-work" element={<MyWorkPage />} /></Routes></MemoryRouter>) })
    expect(container.querySelectorAll('[data-work-status]')).toHaveLength(0)
    expect(container.textContent).toContain('Loading My work')
    await act(async () => { finish({ data: null, error: 'Offline' }) })
    expect(container.textContent).toContain('Could not load your work')
    state.cohortId = 9
  })

  it('a rejected request opens the support email, and a result after leaving the page does nothing', async () => {
    const original = window.location
    Object.defineProperty(window, 'location', { configurable: true, value: { href: 'http://localhost/my-work', origin: 'http://localhost' } })
    try {
      vi.mocked(api.getMyWork).mockResolvedValue({ data: { my_work: myWork() } as never, error: null })
      vi.mocked(api.createDirectConversation).mockRejectedValueOnce(new Error('No session token'))
      await render(<MyWorkPage />, '/my-work?cohort_id=9&tab=graded', '/my-work')
      await act(async () => { button('Ask about this feedback')!.click() })
      await act(async () => { await Promise.resolve() })
      expect(window.location.href).toMatch(/^mailto:/)

      window.location.href = 'http://localhost/my-work'
      let settle!: (value: unknown) => void
      vi.mocked(api.createDirectConversation).mockReturnValueOnce(new Promise((resolve) => { settle = resolve }) as never)
      await render(<MyWorkPage />, '/my-work?cohort_id=9&tab=graded', '/my-work')
      await act(async () => { button('Ask about this feedback')!.click() })
      await act(async () => { root.render(<MemoryRouter><Destination /></MemoryRouter>) })
      await act(async () => { settle({ data: { direct_conversation: { id: 46, cohort_id: 9 } }, error: null }) })
      expect(container.querySelector('[data-destination]')?.textContent).toBe('/')
      expect(window.location.href).toBe('http://localhost/my-work')
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original })
    }
  })
})

const help = (v2: boolean, requests: HelpRequest[]) => <StudentExperienceProvider v2={v2}><ContextualHelp capabilities={capabilities} cohortId={9} contextType="lesson" contextId={42} contextLabel="Loops" requests={requests} requestsLoading={false} /></StudentExperienceProvider>

describe('help answers (L-1.3)', () => {
  it('on: the link from Today opens the request’s dialog and the button reads View response', async () => {
    await render(help(true, [request()]), '/lessons/42?cohort_id=9&help_request=31', '/lessons/:id')
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain('Check the condition.')
    expect(button('View response')).toBeTruthy()
    // A resolved answer reads View response too; another request's id opens nothing.
    await render(help(true, [request({ status: 'resolved', resolved_at: '2026-11-17T02:00:00Z' })]), '/lessons/42?cohort_id=9&help_request=99', '/lessons/:id')
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(button('View response')).toBeTruthy()
  })

  it('on: a link to an older answer shows that answer, not the newest one (fix round)', async () => {
    const older = request({ id: 30, status: 'resolved', resolved_at: '2026-11-10T00:00:00Z', staff_response: 'Older answer.', replies: [{ id: 3, body: 'Older answer.', resolved_request: true, author: person(2, 'Audreana Synthetic'), created_at: '2026-11-10T00:00:00Z' }] })
    const newer = request({ id: 31, status: 'resolved', resolved_at: '2026-11-17T02:00:00Z', staff_response: 'Newer answer.', replies: [{ id: 4, body: 'Newer answer.', resolved_request: true, author: person(2, 'Audreana Synthetic'), created_at: '2026-11-17T02:00:00Z' }] })
    await render(help(true, [newer, older]), '/lessons/42?cohort_id=9&help_request=30', '/lessons/:id')
    const dialog = container.querySelector('[role="dialog"]')!
    expect(dialog.textContent).toContain('Older answer.')
    expect(dialog.textContent).not.toContain('Newer answer.')
  })

  it('on: a new link on a lesson that is already open fetches the requests again and shows the new reply (fix round)', async () => {
    const unanswered = request({ status: 'open', staff_response: null, owner: null, replies: [], acknowledged_at: null })
    const answered = request({ replies: [{ id: 9, body: 'Your loop never updates i.', resolved_request: false, author: person(2, 'Audreana Synthetic'), created_at: '2026-11-17T03:00:00Z' }] })
    const refresh = vi.fn()
    function Lesson() {
      const [requests, setRequests] = useState<HelpRequest[]>([unanswered])
      refresh.mockImplementation(async () => { setRequests([answered]) })
      return <StudentExperienceProvider v2><ContextualHelp capabilities={capabilities} cohortId={9} contextType="lesson" contextId={42} contextLabel="Loops" requests={requests} requestsLoading={false} onRequestsRefresh={refresh} /></StudentExperienceProvider>
    }
    const nav: { go?: (path: string) => void } = {}
    function Nav() { const navigate = useNavigate(); useEffect(() => { nav.go = navigate }); return null }
    await act(async () => { root.render(<MemoryRouter key={++renders} initialEntries={['/lessons/42?cohort_id=9']}><Nav /><Routes><Route path="/lessons/:id" element={<Lesson />} /></Routes></MemoryRouter>) })
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(refresh).not.toHaveBeenCalled()
    // The notification links here while the lesson is open: no remount.
    await act(async () => { nav.go!('/lessons/42?cohort_id=9&help_request=31') })
    await act(async () => { await Promise.resolve() })
    expect(refresh).toHaveBeenCalledTimes(1)
    const dialog = container.querySelector('[role="dialog"]')!
    expect(dialog.textContent).toContain('Your loop never updates i.')
  })

  it('off: the dialog stays closed and the labels are today’s', async () => {
    await render(help(false, [request()]), '/lessons/42?cohort_id=9&help_request=31', '/lessons/:id')
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(button('Your instructor replied')).toBeTruthy()
    await render(help(false, [request({ status: 'resolved', resolved_at: '2026-11-17T02:00:00Z' })]), '/lessons/42?cohort_id=9', '/lessons/:id')
    expect(button('Ask for help')).toBeTruthy()
  })
})
