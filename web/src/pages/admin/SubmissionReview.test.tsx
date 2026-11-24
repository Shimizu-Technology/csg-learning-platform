// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { withLeaveGuard } from '../../test/TestRouter'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Grading } from './Grading'
import { SubmissionDetail } from './SubmissionDetail'
import { CohortModuleGrading } from './CohortModuleGrading'
import { api } from '../../lib/api'
import { formatShortDateTime } from '../../lib/format'
import type { Submission } from '../../types/api'

const confirm = vi.hoisted(() => vi.fn().mockResolvedValue(true))
vi.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn() }),
}))
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => confirm }))
// Record links need a signed-in viewer; tests that click them sign in an admin.
const auth = vi.hoisted(() => ({ user: null as null | { id: number; is_staff: boolean; is_admin: boolean } }))
vi.mock('../../contexts/AuthContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../contexts/AuthContext')>()
  return {
    ...actual,
    useAuthContext: () => {
      const value = actual.useAuthContext()
      return auth.user ? { ...value, user: auth.user as never } : value
    },
  }
})
vi.mock('../../components/admin/StudentContextDrawer', () => ({ StudentContextDrawer: () => null }))
vi.mock('../../components/shared/CodeEditor', () => ({
  CodeEditor: ({ value }: { value: string }) => <pre>{value}</pre>,
  detectLanguage: () => 'python',
}))
vi.mock('../../components/shared/CodeRunner', () => ({ CodeRunner: () => null }))
const first: Submission = { module_position: null, course_delivery: null, week_number: null, submission_type: null, pr_url: null, live_url: null, branch: null, notes: null, submission_config: {}, cohort_name: null,
  id: 42,
  latest_submission_id: 42,
  enrollment_id: 1,
  cohort_id: 4,
  user_id: 4,
  user_name: 'Learner',
  content_block_id: 8,
  text: 'my work',
  grade: null,
  feedback: null,
  graded_by: null,
  graded_at: null,
  num_submissions: 1,
  created_at: '2026-10-22T00:00:00Z',
  updated_at: '2026-10-22T00:00:00.123456Z',
  content_block_title: 'Checkpoint',
  content_block_type: 'exercise',
  lesson_title: 'Lesson',
  lesson_id: 3,
  module_id: 2,
  module_name: 'Functions',
  filename: null,
  language_hint: null,
  github_issue_url: 'https://github.com/test/repo/issues/1',
  github_code_url: null,
  repo_url: 'https://github.com/test/repo',
  commit_sha: 'abc123',
  rubric: {
    id: 1,
    title: 'Quality',
    description: null,
    criteria: [
      { objective_code: null,
        id: 10,
        title: 'Correctness',
        description: 'Works',
        position: 0,
        rating: null,
        feedback: null,
      },
    ],
  },
}
const second: Submission = {
  ...first,
  id: 41,
  latest_submission_id: 41,
  content_block_id: 9,
  content_block_title: 'Next work',
  // Newer than 42: the Grading workbench lists oldest first, so 42 then 41.
  created_at: '2026-10-23T00:00:00Z',
}
const matrix = {
  cohort_id: 4,
  cohort_name: 'Python pilot',
  module_id: 2,
  module_name: 'Functions',
  requires_github: false,
  repository_name: '',
  students: [
    {
      user_id: 4,
      full_name: 'Learner',
      email: 'learner@example.com',
      github_username: null,
      total_exercises: 2,
      submitted: 2,
      ungraded: 2,
      graded: 0,
      redo: 0,
    },
  ],
  exercises: [8, 9].map((id) => ({
    id,
    title: id === 8 ? 'Checkpoint' : 'Next work',
    filename: null,
    release_day: 0,
    lesson_title: 'Lesson',
    requires_submission: true,
    submission_type: 'text_submission',
  })),
  progresses: [],
  submissions: [first, second],
}
const entries = [
  '/admin/grading?submission=42',
  '/admin/submissions/42?queue=all&queue_cohort_id=4&cohort_id=4&student_id=4&return_to=%2Fadmin%2Fgrading%3Ffilter%3Dall',
  '/admin/cohorts/4/modules/2/grading?view=grid&review=42#grading-cell-4-8',
]
let container: HTMLDivElement
let root: Root
beforeEach(() => {
  auth.user = null
  confirm.mockReset().mockResolvedValue(true)
  // The review contract is exercised through the feedback editor's Markdown mode (a textarea).
  window.localStorage.setItem('csg-editor-preferences:signed-out', JSON.stringify({ mode: 'markdown', enterSends: true }))
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  vi.spyOn(api, 'getSubmissions').mockResolvedValue({
    data: { submissions: [first, second] },
    error: null,
  })
  vi.spyOn(api, 'getCohorts').mockResolvedValue({ data: { cohorts: [] }, error: null })
  vi.spyOn(api, 'getSubmission').mockImplementation(async (id) => ({
    data: { submission: id === 42 ? first : second },
    error: null,
  }))
  vi.spyOn(api, 'getCohortModuleSubmissions').mockResolvedValue({ data: matrix, error: null })
  vi.spyOn(api, 'getFeedbackSnippets').mockResolvedValue({
    data: {
      feedback_snippets: [
        {
          id: 1,
          title: 'Next step',
          body: 'Try another case.',
          usage_count: 0,
          created_at: '',
          updated_at: '',
          user_id: 1,
        },
      ],
    },
    error: null,
  } as never)
  vi.spyOn(api, 'useFeedbackSnippet').mockResolvedValue({ data: null, error: null } as never)
  vi.spyOn(api, 'getStudentProgress').mockResolvedValue({
    data: {
      cohort: { id: 4, name: 'Python pilot' },
      modules: [{ lessons: [{ blocks: [{ id: 8 }] }] }],
    },
    error: null,
  } as never)
  vi.spyOn(api, 'gradeSubmission').mockImplementation(async (id, payload) => ({
    data: {
      submission: { ...first, id, grade: payload.grade, feedback: payload.feedback || null },
    },
    error: null,
  }))
  // Queue steps open the next record at its top; jsdom has no scrolling.
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  window.matchMedia = vi
    .fn()
    .mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.querySelectorAll('[data-state="closing"]').forEach((node) => node.remove())
  vi.restoreAllMocks()
})
async function render(entry: string | { pathname: string; search?: string; state?: unknown }) {
  const router = createMemoryRouter(
    withLeaveGuard([
      { path: '/admin/grading', element: <Grading /> },
      { path: '/admin/submissions/:id', element: <SubmissionDetail /> },
      {
        path: '/admin/cohorts/:cohortId/modules/:moduleId/grading',
        element: <CohortModuleGrading />,
      },
      { path: '*', element: <p>Another page</p> },
    ]),
    { initialEntries: [entry] },
  )
  await act(async () => root.render(<RouterProvider router={router} />))
  // Let the modal finish its initial focus before exercising a later reload.
  await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
  return router
}
async function click(text: string) {
  const button = [...container.querySelectorAll('button')].find(
    // Icon-only queue buttons in the record header are named by aria-label ("Next submission").
    (item) => item.textContent?.trim() === text || item.getAttribute('aria-label') === `${text} submission`,
  )!
  expect(button).toBeTruthy()
  await act(async () => button.click())
}
/** Grade buttons only choose; Save (Save grade / Save and next) saves. */
async function grade(text: string) {
  await click(text)
  const save = [...container.querySelectorAll('button')].find((item) => /^(Save grade|Save and next|Saving…)$/.test(item.textContent?.trim() || ''))!
  expect(save).toBeTruthy()
  await act(async () => save.click())
}
async function input(label: string, value: string) {
  const textarea =
    label === 'overall'
      ? container.querySelector<HTMLTextAreaElement>('textarea[id]')!
      : container.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${label}"]`)!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      textarea,
      value,
    )
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

it('identifies an empty captured revision without treating it as missing work', async () => {
  vi.mocked(api.getSubmission).mockResolvedValue({ data: { submission: {
    ...first, submission_type: 'prework_github_sync', text: '', commit_sha: 'a'.repeat(40),
    github_revision: { version: 1, binding_id: 3, repository_id: 98765, repository_full_name: 'learner/prework',
      paths: ['111.rb'], content_digest: 'e'.repeat(64), source_bytes: 0, captured_at: '2026-11-18T07:00:00Z' },
  } }, error: null })
  await render('/admin/submissions/42')
  expect(container.textContent).toContain('Synced from GitHub')
  // The raw commit stays out of the way, under Technical details.
  expect(container.textContent).not.toContain('Submitted revision')
  expect(container.querySelector('details dl')?.textContent).toContain('a'.repeat(40))
  expect(container.textContent).toContain('The captured file is empty.')
  expect(container.textContent).not.toContain('No inline code submitted.')
})

// The Save label follows what saving actually does on each page (UX-1 review): the workbench and
// a record walking a queue open the next item; the module matrix keeps the saved cell open.
it.each([
  [entries[0], 'Save and next'],
  [entries[1], 'Save and next'],
  [entries[2], 'Save grade'],
])('labels Save by where it goes at %s', async (entry, label) => {
  await render(entry)
  await click('A')
  const names = [...container.querySelectorAll('button')].map((item) => item.textContent?.trim())
  expect(names).toContain(label)
  expect(names).not.toContain(label === 'Save grade' ? 'Save and next' : 'Save grade')
})

describe.each(entries)('canonical review at %s', (entry) => {
  it('validates rubric then submits the same version, feedback and criterion contract', async () => {
    await render(entry)
    await grade('A')
    expect(api.gradeSubmission).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Rate every rubric criterion')
    await click('Meets')
    await input('Feedback for Correctness', 'Cases pass.')
    await click('Next step')
    await grade('B')
    expect(api.gradeSubmission).toHaveBeenCalledExactlyOnceWith(42, {
      grade: 'B',
      feedback: 'Try another case.',
      base_submission_updated_at: first.updated_at,
      criterion_results: [{ rubric_criterion_id: 10, rating: 'meets', feedback: 'Cases pass.' }],
    })
  })
  it('announces a grading error beside the grade buttons, not above the review', async () => {
    await render(entry)
    await grade('B')
    const alert = container.querySelector<HTMLElement>('[role="alert"]')!
    expect(alert.textContent).toContain('Rate every rubric criterion before grading A, B, or C')
    expect(alert.textContent).toContain('A redo only needs written feedback')
    const live = alert.closest('[aria-live="assertive"]')!
    expect(live).toBeTruthy()
    const gradeButtons = [...container.querySelectorAll('button')].filter((item) =>
      ['A', 'B', 'C', 'Redo'].includes(item.textContent?.trim() || ''),
    )
    expect(gradeButtons).toHaveLength(4)
    expect(live.parentElement!.contains(gradeButtons[0])).toBe(true)
    expect(live.compareDocumentPosition(gradeButtons[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // The live region exists before the error so assistive tech announces its arrival.
    await click('Keep editing')
    expect(container.querySelector('[aria-live="assertive"]')).toBe(live)
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })
  it('redo with written feedback and no rubric ratings saves without criterion results', async () => {
    await render(entry)
    await input('overall', 'Trace the loop by hand first.')
    await grade('Redo')
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(api.gradeSubmission).toHaveBeenCalledExactlyOnceWith(42, {
      grade: 'R',
      feedback: 'Trace the loop by hand first.',
      base_submission_updated_at: first.updated_at,
      criterion_results: undefined,
    })
  })
  it('redo sends only the rated criteria and will not drop a comment that has no rating', async () => {
    await render(entry)
    await input('overall', 'Rework this.')
    await input('Feedback for Correctness', 'Unrated note')
    await grade('Redo')
    expect(api.gradeSubmission).not.toHaveBeenCalled()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Rate the criteria you commented on, or clear those comments',
    )
    await click('Keep editing')
    await click('Developing')
    await grade('Redo')
    expect(api.gradeSubmission).toHaveBeenCalledExactlyOnceWith(42, {
      grade: 'R',
      feedback: 'Rework this.',
      base_submission_updated_at: first.updated_at,
      criterion_results: [{ rubric_criterion_id: 10, rating: 'developing', feedback: 'Unrated note' }],
    })
  })
  it('keeps the entire draft on stale conflict, reloads saved work and uses the accepted version', async () => {
    vi.mocked(api.gradeSubmission).mockResolvedValueOnce({
      data: null,
      error: 'Submission changed',
      status: 409,
      errorCode: 'stale_submission',
    })
    await render(entry)
    await click('Meets')
    await input('Feedback for Correctness', 'Draft criterion')
    await input('overall', 'Draft overall')
    await grade('A')
    expect(container.querySelector<HTMLTextAreaElement>('textarea[id]')?.value).toBe(
      'Draft overall',
    )
    expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label]')?.value).toBe(
      'Draft criterion',
    )
    await grade('A')
    expect(api.gradeSubmission).toHaveBeenCalledTimes(1)
    vi.mocked(api.getSubmission).mockResolvedValueOnce({
      data: {
        submission: {
          ...first,
          feedback: 'New saved feedback',
          updated_at: '2026-10-22T00:01:00.123456Z',
        },
      },
      error: null,
    })
    await click('Reload saved version — keep draft')
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Submission review')
    expect(container.textContent).toContain('New saved feedback')
    expect(container.querySelector<HTMLTextAreaElement>('textarea[id]')?.value).toBe(
      'Draft overall',
    )
    expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label]')?.value).toBe(
      'Draft criterion',
    )
    await grade('B')
    expect(api.gradeSubmission).toHaveBeenLastCalledWith(
      42,
      expect.objectContaining({
        base_submission_updated_at: '2026-10-22T00:01:00.123456Z',
        feedback: 'Draft overall',
        criterion_results: [
          { rubric_criterion_id: 10, rating: 'meets', feedback: 'Draft criterion' },
        ],
      }),
    )
  })
  it('retains superseded drafts read-only and links to latest with return context', async () => {
    vi.mocked(api.gradeSubmission).mockResolvedValueOnce({
      data: null,
      error: 'Previous attempt',
      status: 409,
      latestSubmissionId: 99,
    })
    await render(entry)
    await click('Meets')
    await input('overall', 'Keep me')
    await grade('A')
    expect(container.querySelector<HTMLTextAreaElement>('textarea[id]')?.value).toBe('Keep me')
    expect(container.querySelector('textarea[id]')?.matches(':disabled')).toBe(true)
    expect(
      container.querySelector<HTMLAnchorElement>('a[href*="/submissions/99"]')?.href,
    ).toContain('return_to=')
  })
  it('guards previous/next drafts and does not run shortcuts in a background panel or textarea', async () => {
    const router = await render(entry)
    await input('overall', 'Unsent')
    confirm.mockResolvedValueOnce(false)
    await click('Next')
    expect(api.getSubmission).toHaveBeenCalledTimes(1)
    await act(async () =>
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true })),
    )
    const inputNode = container.querySelector('textarea[id]')!
    await act(async () =>
      inputNode.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true })),
    )
    expect(api.gradeSubmission).not.toHaveBeenCalled()
    await click('Next')
    expect(api.getSubmission).toHaveBeenLastCalledWith(41)
    expect(confirm).toHaveBeenCalledTimes(2)
    await click('Previous')
    expect(api.getSubmission).toHaveBeenLastCalledWith(42)
    expect(router.state.location.search).toContain(
      entry.includes('/submissions/')
        ? 'queue=all'
        : entry.includes('/cohorts/')
          ? 'view=grid'
          : 'submission=42',
    )
  })
  it('shares GitHub checks, issue inspection, attempt history and snippet saving', async () => {
    vi.spyOn(api, 'refreshSubmissionGithubChecks').mockResolvedValue({
      data: {
        github_checks: {
          head_sha: 'abc123',
          fetched_at: first.updated_at,
          summary: { passed: 1, failed: 0, pending: 0, neutral: 0 },
          runs: [],
        },
      },
      error: null,
    } as never)
    vi.spyOn(api, 'getSubmissionGithubIssue').mockResolvedValue({
      data: {
        title: 'Review thread',
        body: 'Issue body',
        state: 'closed',
        comments: [{ id: 1, user: 'Teacher', body: 'Check edge cases', created_at: '2026-10-21T10:15:00Z' }],
      },
      error: null,
    })
    vi.spyOn(api, 'createFeedbackSnippet').mockResolvedValue({
      data: { feedback_snippet: { id: 2, title: 'Saved snippet', body: 'Reusable feedback' } },
      error: null,
    } as never)
    await render(entry)
    for (const label of ['GitHub checks', 'GitHub issue discussion', 'Attempt history']) {
      await act(async () =>
        [...container.querySelectorAll('summary')]
          .find((node) => node.textContent === label)!
          .click(),
      )
    }
    await click('Check GitHub again')
    expect(container.textContent).toContain('1 passed')
    await click('Load GitHub issue')
    expect(container.textContent).toContain('Review thread')
    expect(container.textContent).toContain('Check edge cases')
    expect(container.textContent).toContain('Closed')
    expect(container.querySelector('time')?.getAttribute('datetime')).toBe('2026-10-21T10:15:00Z')
    expect(container.querySelector('time')?.textContent).toBe(formatShortDateTime('2026-10-21T10:15:00Z'))
    vi.mocked(api.getSubmissionGithubIssue).mockResolvedValueOnce({ data: { title: 'Open thread', body: '', state: 'open', comments: [] }, error: null })
    await click('Refresh issue')
    expect([...container.querySelectorAll('span')].some((node) => node.textContent === 'Open')).toBe(true)
    expect(container.textContent).not.toContain('Closed')
    await click('Load attempts')
    expect(container.textContent).toContain('This attempt')
    await input('overall', 'Reusable feedback')
    await click('Save draft as reusable snippet')
    expect(api.createFeedbackSnippet).toHaveBeenCalledWith('Reusable feedback')
    expect(container.textContent).toContain('Saved snippet')
    expect(api.gradeSubmission).not.toHaveBeenCalled()
  })
  it.each(['button', 'keyboard'] as const)('refuses a blank redo via %s, then saves once with feedback', async (path) => {
    await render(entry)
    await click('Meets')
    await input('overall', '   ')
    const redo = async () => {
      if (path === 'button') await grade('Redo')
      else {
        const panel = container.querySelector('[aria-label="Submission review"]')!
        await act(async () => panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true })))
        await act(async () => panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true })))
      }
    }
    // A redo needs written feedback (U-0.4): no confirmation, no save, the message in the grade bar.
    await redo()
    expect(confirm).not.toHaveBeenCalled()
    expect(api.gradeSubmission).not.toHaveBeenCalled()
    const alert = container.querySelector<HTMLElement>('[role="alert"]')!
    expect(alert.textContent).toContain('Write feedback before choosing Redo, so the student knows what to change.')
    expect(alert.closest('[data-grade-bar]')).toBeTruthy()
    // Writing feedback clears it.
    await input('overall', 'Check the edge cases.')
    expect(container.querySelector('[role="alert"]')).toBeNull()
    let saved!: (value: unknown) => void
    vi.mocked(api.gradeSubmission).mockImplementationOnce(() => new Promise((resolve) => { saved = resolve }) as never)
    await redo()
    await redo()
    expect(api.gradeSubmission).toHaveBeenCalledExactlyOnceWith(42, expect.objectContaining({ grade: 'R', feedback: 'Check the edge cases.' }))
    await act(async () => saved({ data: { submission: { ...first, grade: 'R' } }, error: null }))
  })
  it('does not steal textarea focus on ordinary check updates', async () => {
    vi.spyOn(api, 'refreshSubmissionGithubChecks').mockResolvedValue({ data: { github_checks: null }, error: null } as never)
    await render(entry)
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea[id]')!
    textarea.focus()
    await click('Check GitHub again')
    expect(document.activeElement).toBe(textarea)
  })
  it('fails closed on cached detail and retries explicitly', async () => {
    vi.mocked(api.getSubmission).mockResolvedValueOnce({
      data: { submission: first },
      error: 'Detail offline',
      fromCache: true,
    })
    await render(entry)
    expect(container.textContent).toContain('Detail offline')
    expect(container.querySelector('textarea')).toBeNull()
    await click('Retry')
    expect(container.querySelector('textarea')).not.toBeNull()
  })
})
it('returns from the record to the selected matrix cell and closes to that exact cell', async () => {
  const router = await render(entries[2])
  const record = [...container.querySelectorAll('a')].find((a) =>
    a.textContent?.startsWith('Open submission'),
  )!
  await act(async () => record.click())
  expect(router.state.location.pathname).toBe('/admin/submissions/42')
  await act(async () =>
    [...container.querySelectorAll('a')].find((a) => a.textContent === 'Back to Module grading')!.click(),
  )
  expect(router.state.location.hash).toBe('#grading-cell-4-8')
  expect(container.querySelector('[role=dialog]')).not.toBeNull()
  await click('Back to matrix cell')
  expect(container.querySelector('[role=dialog]')).toBeNull()
  expect(document.activeElement?.id).toBe('grading-cell-4-8')
})

it('moves the matrix return anchor with Next so closing returns to the reviewed cell', async () => {
  const router = await render(entries[2])
  await click('Next')
  expect(router.state.location.search).toContain('review=41')
  expect(router.state.location.hash).toBe('#grading-cell-4-9')
  await click('Back to matrix cell')
  expect(container.querySelector('[role=dialog]')).toBeNull()
  expect(document.activeElement?.id).toBe('grading-cell-4-9')
})

it('continues the matrix side queue after saving and retains student and filter context', async () => {
  const router = await render(
    '/admin/cohorts/4/modules/2/grading?view=queue&filter=ungraded&student=4&review=42',
  )
  await click('Meets')
  await input('overall', 'Queue feedback')
  await grade('B')
  expect(api.gradeSubmission).toHaveBeenCalledWith(
    42,
    expect.objectContaining({
      criterion_results: [{ rubric_criterion_id: 10, rating: 'meets', feedback: '' }],
      feedback: 'Queue feedback',
    }),
  )
  expect(Object.fromEntries(new URLSearchParams(router.state.location.search))).toEqual({
    view: 'queue',
    filter: 'ungraded',
    student: '4',
    review: '41',
  })
  expect(api.getSubmission).toHaveBeenLastCalledWith(41)
})
it('does not open a submission outside the selected matrix scope', async () => {
  await render('/admin/cohorts/4/modules/2/grading?review=99')
  expect(api.getSubmission).not.toHaveBeenCalled()
  expect(container.querySelector('[role=dialog]')).toBeNull()
})
it('blocks focused grading shortcuts behind another dialog and restores keyboard queue navigation', async () => {
  const router = await render(entries[0])
  await click('Meets')
  const topDialog = document.createElement('div')
  topDialog.setAttribute('data-app-modal', '')
  document.body.appendChild(topDialog)
  await act(async () =>
    container
      .querySelector('section')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true })),
  )
  expect(api.gradeSubmission).not.toHaveBeenCalled()
  topDialog.remove()
  await act(async () =>
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'j', bubbles: true }),
    ),
  )
  expect(router.state.location.search).toContain('submission=41')
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Submission review')
  await act(async () =>
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', bubbles: true }),
    ),
  )
  expect(router.state.location.search).toContain('submission=42')
})

it.each(['next', 'save'] as const)(
  'uses the target learner/cohort on %s before context validation finishes',
  async (action) => {
    const other = {
      ...second,
      user_id: 18,
      user_name: 'Second learner',
      cohort_id: 9,
      enrollment_id: 2,
    }
    vi.mocked(api.getSubmissions).mockResolvedValue({
      data: { submissions: [first, other] },
      error: null,
    })
    vi.mocked(api.getSubmission).mockImplementation(async (id) => ({
      data: { submission: id === 42 ? first : other },
      error: null,
    }))
    let resolveOld!: (value: unknown) => void
    vi.mocked(api.getStudentProgress).mockImplementation((userId) =>
      userId === 4
        ? (new Promise((resolve) => {
            resolveOld = resolve
          }) as never)
        : (Promise.resolve({
            data: {
              cohort: { id: 9, name: 'Second cohort' },
              modules: [{ lessons: [{ blocks: [{ id: 9 }] }] }],
            },
            error: null,
          }) as never),
    )
    const filter = action === 'save' ? 'ungraded' : 'all'
    const router = await render(
      `/admin/submissions/42?cohort_id=4&student_id=4&queue=${filter}&return_to=%2Fadmin%2Fgrading%3Ffilter%3Dall`,
    )
    if (action === 'save') {
      await click('Meets')
      await grade('B')
    } else await click('Next')
    expect(router.state.location.pathname).toBe('/admin/submissions/41')
    expect(Object.fromEntries(new URLSearchParams(router.state.location.search))).toEqual({
      cohort_id: '9',
      student_id: '18',
      queue: filter,
      return_to: '/admin/grading?filter=all',
    })
    expect(api.getStudentProgress).toHaveBeenLastCalledWith(18, 9)
    const breadcrumb = () => container.querySelector('nav[aria-label="Breadcrumb"]')?.textContent
    expect(breadcrumb()).toContain('Second cohort')
    expect(container.textContent).toContain('Message in Second cohort')
    await act(async () =>
      resolveOld({
        data: {
          cohort: { id: 4, name: 'Old cohort' },
          modules: [{ lessons: [{ blocks: [{ id: 8 }] }] }],
        },
        error: null,
      }),
    )
    expect(container.textContent).toContain('Message in Second cohort')
    expect(breadcrumb()).not.toContain('Old cohort')
  },
)

it('keeps guarding the draft when Message was confirmed but could not open', async () => {
  vi.spyOn(api, 'createDirectConversation').mockResolvedValue({ data: null, error: 'Messaging is unavailable.' } as never)
  const router = await render('/admin/submissions/42?cohort_id=4')
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
  await input('overall', 'Unsent feedback')
  await click('Message in Python pilot')
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
  expect(confirm).toHaveBeenCalledTimes(1)
  expect(router.state.location.pathname).toBe('/admin/submissions/42')
  confirm.mockResolvedValueOnce(false)
  await act(async () => router.navigate('/admin/grading'))
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
  expect(confirm).toHaveBeenCalledTimes(2)
  expect(router.state.location.pathname).toBe('/admin/submissions/42')
  expect(container.querySelector<HTMLTextAreaElement>('textarea[id]')!.value).toBe('Unsent feedback')
})

describe('record links beside an inline review ask before discarding unsaved feedback', () => {
  const draft = () => container.querySelector<HTMLTextAreaElement>('textarea[id]')!.value
  async function clickLink(link: HTMLAnchorElement, init: MouseEventInit = {}) {
    let event!: MouseEvent
    await act(async () => {
      event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init })
      link.dispatchEvent(event)
    })
    return event
  }
  beforeEach(() => {
    auth.user = { id: 1, is_staff: true, is_admin: true }
    window.localStorage.setItem('csg-editor-preferences:1', JSON.stringify({ mode: 'markdown', enterSends: true }))
    vi.mocked(api.getCohorts).mockResolvedValue({
      data: { cohorts: [{ id: 4, name: 'Python pilot', modules: [{ id: 2, name: 'Functions' }] }] },
      error: null,
    } as never)
  })

  it.each([
    ['the grading inbox cohort name', '/admin/grading?submission=42', 'a[data-record-link="cohort"]', '/admin/cohorts/4'],
    ['a grading inbox module queue', '/admin/grading?submission=42', 'a[href="/admin/cohorts/4/modules/2/grading"]', '/admin/cohorts/4/modules/2/grading'],
    ['the module grading cohort name', '/admin/cohorts/4/modules/2/grading?view=queue&review=42', 'a[data-record-link="cohort"]', '/admin/cohorts/4'],
  ])('%s: Keep editing stays with the draft, Discard leaves', async (_label, entry, selector, destination) => {
    const router = await render(entry)
    const start = router.state.location.pathname
    await input('overall', 'Unsent feedback')
    const link = container.querySelector<HTMLAnchorElement>(selector)!
    expect(link).toBeTruthy()

    confirm.mockResolvedValueOnce(false)
    const kept = await clickLink(link)
    expect(kept.defaultPrevented).toBe(true)
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ cancelLabel: 'Keep editing' }))
    expect(router.state.location.pathname).toBe(start)
    expect(draft()).toBe('Unsent feedback')

    await clickLink(link)
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(router.state.location.pathname).toBe(destination)
  })

  it('leaves ⌘/Ctrl and middle clicks to the browser without asking', async () => {
    const router = await render('/admin/grading?submission=42')
    await input('overall', 'Unsent feedback')
    const link = container.querySelector<HTMLAnchorElement>('a[data-record-link="cohort"]')!
    // Runs after React's handler: record that the app left the click to the browser, then stop jsdom's navigation.
    const leftToBrowser: boolean[] = []
    const stop = (event: Event) => { leftToBrowser.push(!event.defaultPrevented); event.preventDefault() }
    document.addEventListener('click', stop)
    try {
      for (const init of [{ metaKey: true }, { ctrlKey: true }, { button: 1 }]) await clickLink(link, init)
    } finally {
      document.removeEventListener('click', stop)
    }
    expect(leftToBrowser).toEqual([true, true, true])
    expect(confirm).not.toHaveBeenCalled()
    expect(router.state.location.pathname).toBe('/admin/grading')
    expect(draft()).toBe('Unsent feedback')
  })

  it('navigates without asking when the draft is unchanged', async () => {
    const router = await render('/admin/grading?submission=42')
    await clickLink(container.querySelector<HTMLAnchorElement>('a[data-record-link="cohort"]')!)
    expect(confirm).not.toHaveBeenCalled()
    expect(router.state.location.pathname).toBe('/admin/cohorts/4')
  })
})

it.each([403, 404])('renders the shared No access state for submission status %s', async status => {
  vi.mocked(api.getSubmission).mockResolvedValue({ data: null, error: 'Private server detail', status })
  await render('/admin/submissions/42')
  expect(container.textContent).toContain('No access')
  expect(container.textContent).not.toContain('Private server detail')
  expect(container.querySelector('a[href="/dashboard"]')?.textContent).toBe('Go to Today')
})

it.each([true, false])('shows GitHub sync controls only when enabled: %s', async (enabled) => {
  vi.mocked(api.getCohortModuleSubmissions).mockResolvedValue({ data: { ...matrix, students: matrix.students.map(student => ({ ...student, github_username: "learner" })), github_sync_enabled: enabled, supports_github_sync: true, open_github_sync_count: 1 }, error: null })
  await render('/admin/cohorts/4/modules/2/grading?view=students&student=4')
  const buttons = Array.from(container.querySelectorAll('button')).map(button => button.textContent)
  expect(buttons.some(text => text?.includes('Sync all from GitHub'))).toBe(enabled)
  expect(buttons.some(text => text?.trim() === 'Sync Learner')).toBe(enabled)
})

it('asks before a related-panel link leaves unsent feedback on the submission record', async () => {
  auth.user = { id: 2, is_staff: true, is_admin: false }
  window.localStorage.setItem('csg-editor-preferences:2', JSON.stringify({ mode: 'markdown', enterSends: true }))
  vi.spyOn(api, 'getRecordRelated').mockResolvedValue({
    data: { related: { type: 'submission', id: 42, context: { cohort: { id: 4, name: 'Python pilot' }, student: { id: 4, name: 'Learner' } }, items: [{ key: 'other_attempts', count: 1, value: null, cohort_id: 4, user_id: 4 }] } },
    error: null,
  })
  const router = await render(entries[1])
  await input('overall', 'Unsent')
  const link = container.querySelector<HTMLAnchorElement>('[data-related-row="other_attempts"] a')!
  confirm.mockResolvedValueOnce(false)
  await act(async () => link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })))
  expect(router.state.location.pathname).toBe('/admin/submissions/42')
  confirm.mockResolvedValueOnce(true)
  await act(async () => link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })))
  expect(router.state.location.pathname).toBe('/admin/cohorts/4/students/4/work')
  expect(router.state.location.state).toEqual({ returnTo: entries[1], returnLabel: 'Submission #42' })
})

describe('focused grading Back link', () => {
  const back = () => container.querySelector<HTMLAnchorElement>('[data-back-link]')!
  const segment = async (label: string) => {
    const button = [...container.querySelectorAll('button')].find((item) => item.textContent?.trim() === label)!
    expect(button, label).toBeTruthy()
    await act(async () => button.click())
  }

  it('a deep link goes back to Grading for this cohort', async () => {
    await render('/admin/cohorts/4/modules/2/grading')
    expect(back().textContent).toBe('Back to Grading')
    expect(back().getAttribute('href')).toBe('/admin/grading?cohort_id=4')
  })

  it('opened from cohort settings, it keeps that origin through the grid, roster and queue views and a review', async () => {
    const router = await render({ pathname: '/admin/cohorts/4/modules/2/grading', state: { returnTo: '/admin/cohorts/4/settings', returnLabel: 'Cohort settings' } })
    expect(back().textContent).toBe('Back to Cohort settings')
    for (const view of ['Queue', 'By student', 'Grid']) {
      await segment(view)
      expect(back().textContent, view).toBe('Back to Cohort settings')
      expect(back().getAttribute('href')).toBe('/admin/cohorts/4/settings')
    }
    await act(async () => router.navigate('/admin/cohorts/4/modules/2/grading?view=queue', { replace: true, state: router.state.location.state }))
    expect(back().textContent).toBe('Back to Cohort settings')
  })

  it('opened from a filtered Grading list, it names the filter', async () => {
    vi.mocked(api.getCohorts).mockResolvedValue({ data: { cohorts: [{ id: 4, name: 'Python pilot', modules: [{ id: 2, name: 'Functions' }] }] }, error: null } as never)
    const router = await render('/admin/grading?filter=redo')
    const link = [...container.querySelectorAll('a')].find((a) => a.getAttribute('href') === '/admin/cohorts/4/modules/2/grading')!
    expect(link).toBeTruthy()
    await act(async () => link.click())
    expect(router.state.location.pathname).toBe('/admin/cohorts/4/modules/2/grading')
    expect(back().textContent).toBe('Back to Grading · Redo')
    expect(back().getAttribute('href')).toBe('/admin/grading?filter=redo')
    await segment('By student')
    expect(back().textContent).toBe('Back to Grading · Redo')
  })
})

describe('GitHub Redo issue delivery status in SubmissionReviewPanel', () => {
  it('omits delivery status when absent (Off cohort unchanged)', async () => {
    await render('/admin/submissions/42')
    expect(container.querySelector('[data-github-issue-delivery]')).toBeNull()
  })

  it('shows pending delivery status cleanly', async () => {
    vi.mocked(api.getSubmission).mockResolvedValueOnce({
      data: {
        submission: {
          ...first,
          grade: 'R',
          feedback: 'Handle empty array.',
          github_issue_delivery: {
            status: 'pending',
            action: 'open_or_comment',
            issue_url: null,
            attempts: 0,
            last_error: null,
            delivered_at: null,
            updated_at: '2026-11-22T00:00:00Z',
          },
        },
      },
      error: null,
    })
    await render('/admin/submissions/42')
    const status = container.querySelector('[data-github-issue-delivery="pending"]')
    expect(status?.textContent).toContain('Grade saved · GitHub feedback pending')
    expect(status?.textContent).not.toContain('Retry GitHub feedback')
  })

  it('shows failed status with error detail and retries to delivered with issue link', async () => {
    const failedSubmission: Submission = {
      ...first,
      grade: 'R',
      feedback: 'Fix edge cases.',
      github_issue_url: null,
      github_issue_delivery: {
        status: 'failed',
        action: 'open_or_comment',
        issue_url: null,
        attempts: 1,
        last_error: 'GitHub installation cannot access this repository; check selected repositories and reconnect',
        delivered_at: null,
        updated_at: '2026-11-22T00:00:00Z',
      },
    }
    const deliveredSubmission: Submission = {
      ...failedSubmission,
      github_issue_url: 'https://github.com/app-learner/prework-exercises/issues/14',
      github_issue_delivery: {
        status: 'delivered',
        action: 'open_or_comment',
        issue_url: 'https://github.com/app-learner/prework-exercises/issues/14',
        attempts: 2,
        last_error: null,
        delivered_at: '2026-11-22T00:05:00Z',
        updated_at: '2026-11-22T00:05:00Z',
      },
    }
    vi.mocked(api.getSubmission).mockResolvedValueOnce({ data: { submission: failedSubmission }, error: null })
    const retrySpy = vi.spyOn(api, 'retrySubmissionGithubIssue').mockResolvedValueOnce({
      data: {
        submission: deliveredSubmission,
        github_issue_delivery: deliveredSubmission.github_issue_delivery!,
      },
      error: null,
    })

    await render('/admin/submissions/42')
    const failed = container.querySelector('[data-github-issue-delivery="failed"]')
    expect(failed?.textContent).toContain('Grade saved · GitHub feedback failed')
    expect(failed?.textContent).toContain('GitHub installation cannot access this repository')
    expect(failed?.textContent).toContain('Your grade and feedback remain saved in Learn.')

    await click('Retry GitHub feedback')
    expect(retrySpy).toHaveBeenCalledExactlyOnceWith(42)

    const delivered = container.querySelector('[data-github-issue-delivery="delivered"]')
    expect(delivered?.textContent).toContain('GitHub feedback delivered')
    const link = delivered?.querySelector<HTMLAnchorElement>('a[href="https://github.com/app-learner/prework-exercises/issues/14"]')
    expect(link?.textContent).toContain('View GitHub issue')
  })
})
