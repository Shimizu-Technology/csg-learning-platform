// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { withLeaveGuard } from '../../test/TestRouter'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Grading } from './Grading'
import { CohortModuleGrading } from './CohortModuleGrading'
import { api } from '../../lib/api'
import type { Submission } from '../../types/api'

// W7 PR 7.3: the Grading workbench (U-4.1, U-4.5, L-2.1, L-2.2) and the module grid (U-4.2, L-2.4, T-13).

const confirm = vi.hoisted(() => vi.fn().mockResolvedValue(true))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }))
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => confirm }))
const auth = vi.hoisted(() => ({ user: { id: 1, is_staff: true, is_admin: false } as null | { id: number; is_staff: boolean; is_admin: boolean } }))
vi.mock('../../contexts/AuthContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../contexts/AuthContext')>()
  return { ...actual, useAuthContext: () => (auth.user ? { ...actual.useAuthContext(), user: auth.user as never } : actual.useAuthContext()) }
})
vi.mock('../../components/admin/StudentContextDrawer', () => ({ StudentContextDrawer: () => null }))
vi.mock('../../components/shared/CodeRunner', () => ({ CodeRunner: () => null }))

const base: Submission = {
  submission_type: 'text_submission', pr_url: null, live_url: null, branch: null, notes: null, submission_config: {}, repo_url: null, commit_sha: null,
  id: 1, latest_submission_id: 1, enrollment_id: 1, cohort_id: 4, cohort_name: 'Cohort 3', user_id: 20, user_name: 'Alex Rivera', content_block_id: 8,
  text: 'I used `if` / `else if` so only **one** price is returned.\n\n- Test exactly 12\n- Test exactly 65',
  grade: null, feedback: null, graded_by: null, graded_at: null, num_submissions: 1,
  created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00.123456Z',
  content_block_title: 'Ticket prices', content_block_type: 'exercise', lesson_title: 'Make Decisions with JavaScript', lesson_id: 30,
  module_id: 2, module_name: 'JavaScript', module_position: 1, course_delivery: 'program', week_number: 10,
  filename: null, language_hint: null, github_issue_url: null, github_code_url: null, rubric: null,
}
const make = (id: number, overrides: Partial<Submission> = {}): Submission => ({ ...base, id, latest_submission_id: id, content_block_id: 8 + id, ...overrides })
let store: Submission[]
let container: HTMLDivElement
let root: Root
const scrolled: Element[] = []

beforeEach(() => {
  auth.user = { id: 1, is_staff: true, is_admin: false }
  confirm.mockReset().mockResolvedValue(true)
  window.localStorage.setItem('csg-editor-preferences:1', JSON.stringify({ mode: 'markdown', enterSends: true }))
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  store = [
    make(3, { created_at: '2026-11-03T00:00:00Z' }),
    make(1, { created_at: '2026-11-01T00:00:00Z', user_id: 21, user_name: 'Blair Cruz' }),
    make(2, { created_at: '2026-11-02T00:00:00Z', module_id: 5, module_name: 'Python', module_position: 2, cohort_id: 6, cohort_name: 'Python Fundamentals', course_delivery: 'self_paced', week_number: null }),
    make(4, { created_at: '2026-10-20T00:00:00Z', grade: 'A' }),
  ]
  vi.spyOn(api, 'getSubmissions').mockImplementation(async () => ({ data: { submissions: store.map((item) => ({ ...item })) }, error: null }))
  vi.spyOn(api, 'getSubmission').mockImplementation(async (id) => ({ data: { submission: { ...store.find((item) => item.id === id)! } }, error: null }))
  vi.spyOn(api, 'gradeSubmission').mockImplementation(async (id, payload) => {
    store = store.map((item) => (item.id === id ? { ...item, grade: payload.grade, feedback: payload.feedback || null } : item))
    return { data: { submission: { ...store.find((item) => item.id === id)! } }, error: null }
  })
  vi.spyOn(api, 'getCohorts').mockResolvedValue({ data: { cohorts: [{ id: 4, name: 'Cohort 3', curriculum_name: 'Web' }, { id: 6, name: 'Python Fundamentals', curriculum_name: 'Python' }] }, error: null } as never)
  vi.spyOn(api, 'getFeedbackSnippets').mockResolvedValue({ data: { feedback_snippets: [] }, error: null } as never)
  vi.spyOn(api, 'getRecordRelated').mockResolvedValue({
    data: { related: { type: 'submission', id: 1, context: { cohort: { id: 4, name: 'Cohort 3' } }, items: [
      { key: 'lesson', count: null, value: 'Make Decisions with JavaScript', lesson_id: 30, can_edit: true },
      { key: 'lesson_submissions', count: 5, value: null, cohort_id: 4, lesson_id: 30 },
    ] } },
    error: null,
  } as never)
  scrolled.length = 0
  Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this) }
  window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

async function render(entry: string) {
  const router = createMemoryRouter(withLeaveGuard([
    { path: '/admin/grading', element: <Grading /> },
    { path: '/admin/cohorts/:cohortId/modules/:moduleId/grading', element: <CohortModuleGrading /> },
    { path: '*', element: <p>Another page</p> },
  ]), { initialEntries: [entry] })
  await act(async () => root.render(<RouterProvider router={router} />))
  await settle()
  return router
}
const settle = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)))
const rows = () => [...container.querySelectorAll<HTMLButtonElement>('[aria-label="Grading queue"] li button')]
const buttonNamed = (name: string) => [...container.querySelectorAll('button')].find((item) => item.textContent?.trim() === name)!
const query = (router: ReturnType<typeof createMemoryRouter>) => new URLSearchParams(router.state.location.search)

describe('Grading workbench', () => {
  it('lists compact rows oldest first: student, item, cohort with week or self-paced, and waiting time', async () => {
    await render('/admin/grading')
    expect(rows().map((row) => row.id)).toEqual(['submission-row-1', 'submission-row-2', 'submission-row-3'])
    const first = rows()[0].textContent!
    expect(first).toContain('Blair Cruz')
    expect(first).toContain('Make Decisions with JavaScript · Ticket prices')
    expect(first).toContain('Cohort 3 · Week 10')
    expect(rows()[1].textContent).toContain('Python Fundamentals · self-paced')
    // U-4.5: no repeated status badges on every row.
    expect(container.querySelector('[aria-label="Grading queue"]')!.textContent).not.toMatch(/Awaiting review|Latest/)
  })

  it('keeps module, student and order filters in the URL, so a reload restores them', async () => {
    const router = await render('/admin/grading')
    const moduleSelect = container.querySelector<HTMLSelectElement>('[aria-label="Grading queue"] select')!
    expect([...moduleSelect.options].map((option) => option.textContent)).toEqual(['All modules', 'JavaScript (2)', 'Python (1)'])
    await act(async () => {
      moduleSelect.value = '2'
      moduleSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await settle()
    expect(query(router).get('module_id')).toBe('2')
    await act(async () => buttonNamed('Oldest first').click())
    await settle()
    expect(query(router).get('sort')).toBe('newest')
    expect(rows().map((row) => row.id)).toEqual(['submission-row-3', 'submission-row-1'])

    // A reload of the same address restores the same queue.
    act(() => root.unmount())
    root = createRoot(container)
    await render(`/admin/grading${router.state.location.search}`)
    expect(container.querySelector<HTMLSelectElement>('[aria-label="Grading queue"] select')!.value).toBe('2')
    expect(rows().map((row) => row.id)).toEqual(['submission-row-3', 'submission-row-1'])
    expect(buttonNamed('Newest first')).toBeTruthy()
  })

  it('grades A, then opens the next item at the top of the review', async () => {
    const router = await render('/admin/grading?submission=1')
    expect(container.querySelector('[data-record-header]')!.textContent).toContain('1 of 3')
    // Graded at the bottom of a long review: the review's top is above the screen.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ top: -900 } as DOMRect)
    scrolled.length = 0
    await act(async () => buttonNamed('A').click())
    await settle()
    expect(api.gradeSubmission).toHaveBeenCalledWith(1, expect.objectContaining({ grade: 'A' }))
    expect(query(router).get('submission')).toBe('2')
    // Save and next starts the next review at its top (U-4.1): the review area scrolls into view.
    expect(scrolled.some((element) => element.getAttribute('aria-label') === 'Review')).toBe(true)
  })

  it('renders a written answer as Markdown, not a numbered code view', async () => {
    await render('/admin/grading?submission=1')
    const answer = container.querySelector('[aria-label="Submission review"]')!
    expect(answer.querySelector('strong')?.textContent).toBe('one')
    expect(answer.querySelectorAll('li')).toHaveLength(2)
  })

  it('blocks Redo without feedback in the pinned grade bar', async () => {
    await render('/admin/grading?submission=1')
    await act(async () => buttonNamed('Redo').click())
    await settle()
    expect(api.gradeSubmission).not.toHaveBeenCalled()
    const bar = container.querySelector('[data-grade-bar]')!
    expect(bar.querySelector('[role="alert"]')?.textContent).toContain('Write feedback before choosing Redo, so the student knows what to change.')
  })

  it('treats feedback of only Unicode spaces or zero-width characters as blank for Redo (fix round 2)', async () => {
    await render('/admin/grading?submission=1')
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea[id]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, '\u200B\u00A0\u2003\uFEFF')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => buttonNamed('Redo').click())
    await settle()
    expect(api.gradeSubmission).not.toHaveBeenCalled()
    expect(container.querySelector('[data-grade-bar] [role="alert"]')?.textContent).toContain('Write feedback before choosing Redo')
  })

  it('links the review to its cohort, student, lesson and module grid (L-2.1, L-2.2)', async () => {
    await render('/admin/grading?submission=1')
    const header = container.querySelector('[data-record-header]')!
    expect(header.textContent).toContain('Submission #1 · attempt 1')
    const breadcrumb = [...header.querySelectorAll('nav[aria-label="Breadcrumb"] a')].map((link) => link.getAttribute('href'))
    expect(breadcrumb[0]).toBe('/admin/cohorts/4')
    expect(breadcrumb[1]).toContain('/admin/cohorts/4/students/21')
    expect(breadcrumb[2]).toContain('/lessons/30')
    // The student link carries the cohort, so the workspace, context and Message work.
    expect(header.querySelector<HTMLAnchorElement>('a[data-record-link="student"]')!.getAttribute('href')).toContain('/admin/cohorts/4/students/21')
    expect(header.querySelector('a[href="/admin/cohorts/4/modules/2/grading"]')?.textContent).toContain('JavaScript grid')
    expect(buttonNamed('Message')).toBeTruthy()
    expect(buttonNamed('Student context')).toBeTruthy()
    // The lesson title appears once in the review (U-4.5).
    const headings = [...container.querySelector('[aria-label="Review"]')!.querySelectorAll('h1, h2, h3')].map((heading) => heading.textContent)
    expect(headings.filter((text) => text?.includes('Make Decisions with JavaScript'))).toHaveLength(1)
    expect(container.querySelector('[aria-label="Submission review"]')!.textContent).not.toContain('Make Decisions with JavaScript')
    // Related: Edit for an instructor with editing access, and every submission for this lesson.
    await settle()
    expect(container.querySelector('[data-related-row="lesson"] a')?.getAttribute('href')).toBe('/admin/lessons/30/edit')
    expect(container.querySelector('[data-related-row="lesson"]')?.textContent).toContain('Edit')
    expect(container.querySelector('[data-related-row="lesson_submissions"] a')?.getAttribute('href')).toBe('/admin/grading?filter=all&cohort_id=4&lesson_id=30')
  })

  it('narrows to one lesson from the Related panel link, with a removable filter', async () => {
    store = store.map((item) => (item.id === 3 ? { ...item, lesson_id: 31, lesson_title: 'Another lesson' } : item))
    const router = await render('/admin/grading?filter=all&cohort_id=4&lesson_id=30')
    expect(rows().map((row) => row.id)).toEqual(['submission-row-4', 'submission-row-1', 'submission-row-2'])
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label^="Lesson: Make Decisions"]')!.click())
    await settle()
    expect(query(router).get('lesson_id')).toBeNull()
  })

  it('lists module grids with waiting counts and leaves out modules with no work', async () => {
    store = store.map((item) => (item.id === 2 ? { ...item, grade: 'B' } : item))
    await render('/admin/grading')
    const links = [...container.querySelectorAll<HTMLAnchorElement>('ul[aria-label="Grade by module"] a')]
    expect(links.map((link) => [link.getAttribute('href'), link.textContent])).toEqual([
      ['/admin/cohorts/4/modules/2/grading', 'Cohort 3 · JavaScript2'],
      ['/admin/cohorts/6/modules/5/grading', 'Python Fundamentals · Python0'],
    ])
  })

  it('keeps unsaved feedback when Next is declined', async () => {
    const router = await render('/admin/grading?submission=1')
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea[id]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'Unsent')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    confirm.mockResolvedValueOnce(false)
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Next submission"]')!.click())
    await settle()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(query(router).get('submission')).toBe('1')
    expect(container.querySelector<HTMLTextAreaElement>('textarea[id]')!.value).toBe('Unsent')
  })
})

describe('Module grading grid', () => {
  const exercise = (id: number, releaseDay: number, title: string) => ({
    id, title, filename: null, release_day: releaseDay, lesson_id: 100 + id, lesson_title: `Lesson for ${title}`,
    requires_submission: id !== 4, submission_type: 'text_submission',
  })
  beforeEach(() => {
    const graded = make(11, { content_block_id: 1, grade: 'A' })
    const waiting = make(12, { content_block_id: 3, grade: null })
    vi.spyOn(api, 'getCohortModuleSubmissions').mockResolvedValue({
      data: {
        cohort_id: 4, cohort_name: 'Cohort 3', module_id: 2, module_name: 'JavaScript', requires_github: false, repository_name: '',
        students: [{ user_id: 20, full_name: 'Alex Rivera', email: 'alex@example.invalid', github_username: null, total_exercises: 4, submitted: 2, ungraded: 1, graded: 1, redo: 0 }],
        exercises: [exercise(1, 0, 'Practice: loops over arrays'), exercise(2, 1, 'Practice: loops over objects'), exercise(3, 7, 'Recap'), exercise(4, 8, 'Reading')],
        progresses: [{ user_id: 20, content_block_id: 4, status: 'completed', completed_at: '2026-11-02T00:00:00Z' }],
        submissions: [graded, waiting],
      },
      error: null,
    } as never)
  })

  it('opens on the first week with ungraded work and switches weeks through the URL', async () => {
    const router = await render('/admin/cohorts/4/modules/2/grading')
    const weekChips = [...container.querySelectorAll<HTMLButtonElement>('[role="group"][aria-label="Week"] button')]
    expect(weekChips.map((chip) => chip.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false'])
    expect(container.querySelectorAll('table')).toHaveLength(1)
    expect(container.querySelector('table')!.getAttribute('aria-labelledby')).toMatch(/week-2$/)
    await act(async () => weekChips[0].click())
    await settle()
    expect(query(router).get('week')).toBe('1')
    expect(container.querySelector('table')!.getAttribute('aria-labelledby')).toMatch(/week-1$/)
  })

  it('links column headers to their lessons with distinct labels and the full title on focus', async () => {
    await render('/admin/cohorts/4/modules/2/grading?week=1')
    const headers = [...container.querySelectorAll('thead th[scope="col"]')].slice(1)
    const labels = headers.map((th) => th.querySelector('a')!.textContent)
    expect(new Set(labels).size).toBe(labels.length)
    const link = headers[0].querySelector('a')!
    expect(link.getAttribute('href')).toContain('/lessons/101')
    expect(link.getAttribute('aria-label')).toBe('Lesson for Practice: loops over arrays · Practice: loops over arrays')
    expect(headers[0].querySelector('[role="tooltip"]')!.textContent).toBe('Lesson for Practice: loops over arrays · Practice: loops over arrays')
  })

  it('uses icons, not glyphs, in cells and the legend (T-13)', async () => {
    await render('/admin/cohorts/4/modules/2/grading?week=2')
    for (const part of [container.querySelector('table')!, container.querySelector('[data-grid-legend]')!])
      expect(part.textContent).not.toMatch(/[✓•—+]/)
    const completed = container.querySelector('button[aria-label*="Completed by student"]')!
    expect(completed.querySelector('svg')).toBeTruthy()
  })

  it('goes Back to Grading for this cohort and links the cohort and students', async () => {
    await render('/admin/cohorts/4/modules/2/grading')
    expect(container.querySelector<HTMLAnchorElement>('[data-back-link]')!.getAttribute('href')).toBe('/admin/grading?cohort_id=4')
    expect(container.querySelector('a[data-record-link="cohort"]')?.getAttribute('href')).toBe('/admin/cohorts/4')
    expect(container.querySelector('tbody a[data-record-link="student"]')?.getAttribute('href')).toContain('/admin/cohorts/4/students/20')
  })
})

// Fix round 1 (PR #281 review): a held grade key, and the queue paged on the server.
describe('Grading workbench: held keys and paging', () => {
  const panel = () => container.querySelector('[aria-label="Submission review"]')!
  const key = (type: 'keydown' | 'keyup', name: string, repeat = false) =>
    act(async () => { panel().dispatchEvent(new KeyboardEvent(type, { key: name, repeat, bubbles: true })) })

  it('grades one student for a held key: repeats and the still-held key wait for a fresh press on the next review', async () => {
    const router = await render('/admin/grading?submission=1')
    await key('keydown', 'a')
    await settle()
    expect(query(router).get('submission')).toBe('2')
    expect(api.gradeSubmission).toHaveBeenCalledTimes(1)
    // The browser auto-repeats the held key onto the next review.
    await key('keydown', 'a', true)
    await key('keydown', 'a', true)
    await settle()
    // Some platforms send repeats without the flag: still the same press until the key comes up.
    await key('keydown', 'a')
    await settle()
    // J/K repeats do not skip ahead either.
    await key('keydown', 'j', true)
    await settle()
    expect(api.gradeSubmission).toHaveBeenCalledTimes(1)
    expect(query(router).get('submission')).toBe('2')
    // Released and pressed again: that grades this student.
    await key('keyup', 'a')
    await key('keydown', 'a')
    await settle()
    expect(api.gradeSubmission).toHaveBeenCalledTimes(2)
    expect(api.gradeSubmission).toHaveBeenLastCalledWith(2, expect.objectContaining({ grade: 'A' }))
  })

  it('loads one page from the server and the full answer only for the open review', async () => {
    store = Array.from({ length: 53 }, (_, index) =>
      make(index + 1, { created_at: new Date(Date.UTC(2026, 9, 1) + index * 3_600_000).toISOString(), user_id: 100 + index, user_name: `Learner ${String(index + 1).padStart(2, '0')}` }))
    const router = await render('/admin/grading')
    expect(api.getGradingQueue).toHaveBeenCalledWith(expect.objectContaining({ filter: 'ungraded', sort: 'oldest', page: 1, per_page: 50 }))
    expect(rows()).toHaveLength(50)
    expect(api.getSubmission).not.toHaveBeenCalled()
    const pages = container.querySelector('nav[aria-label="Queue pages"]')!
    expect(pages.textContent).toContain('1–50 of 53')
    expect(pages.textContent).toContain('Page 1 of 2')
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Next page"]')!.click())
    await settle()
    expect(query(router).get('page')).toBe('2')
    expect(rows().map((row) => row.id)).toEqual(['submission-row-51', 'submission-row-52', 'submission-row-53'])
    expect(api.getSubmission).not.toHaveBeenCalled()
    await act(async () => rows()[0].click())
    await settle()
    expect(api.getSubmission).toHaveBeenCalledWith(51)
    expect(container.querySelector('[data-record-header]')!.textContent).toContain('51 of 53')
  })

  it('Save and next crosses the page edge, and a link to an item opens on its page', async () => {
    store = Array.from({ length: 53 }, (_, index) =>
      make(index + 1, { created_at: new Date(Date.UTC(2026, 9, 1) + index * 3_600_000).toISOString(), user_id: 100 + index, user_name: `Learner ${index + 1}` }))
    const router = await render('/admin/grading?submission=50')
    expect(query(router).get('page')).toBeNull()
    expect(container.querySelector('[data-record-header]')!.textContent).toContain('50 of 53')
    await act(async () => buttonNamed('A').click())
    await settle()
    expect(query(router).get('submission')).toBe('51')
    // 50 left the Waiting list, so 51 is now the last item on page 1.
    expect(api.getGradingQueue).toHaveBeenLastCalledWith(expect.objectContaining({ focus_id: 51 }))
    expect(container.querySelector('[data-record-header]')!.textContent).toContain('50 of 52')

    act(() => root.unmount())
    root = createRoot(container)
    const reopened = await render('/admin/grading?submission=53')
    expect(query(reopened).get('page')).toBe('2')
    expect(container.querySelector('[data-record-header]')!.textContent).toContain('52 of 52')
  })
})
