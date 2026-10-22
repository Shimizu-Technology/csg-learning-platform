// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
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
vi.mock('../../components/admin/StudentContextDrawer', () => ({ StudentContextDrawer: () => null }))
vi.mock('../../components/shared/CodeEditor', () => ({
  CodeEditor: ({ value }: { value: string }) => <pre>{value}</pre>,
  detectLanguage: () => 'python',
}))
vi.mock('../../components/shared/CodeRunner', () => ({ CodeRunner: () => null }))
const first: Submission = {
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
      {
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
  created_at: '2026-10-21T00:00:00Z',
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
  confirm.mockReset().mockResolvedValue(true)
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
async function render(entry: string) {
  const router = createMemoryRouter(
    [
      { path: '/admin/grading', element: <Grading /> },
      { path: '/admin/submissions/:id', element: <SubmissionDetail /> },
      {
        path: '/admin/cohorts/:cohortId/modules/:moduleId/grading',
        element: <CohortModuleGrading />,
      },
    ],
    { initialEntries: [entry] },
  )
  await act(async () => root.render(<RouterProvider router={router} />))
  // Let the modal finish its initial focus before exercising a later reload.
  await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
  return router
}
async function click(text: string) {
  const button = [...container.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === text,
  )!
  expect(button).toBeTruthy()
  await act(async () => button.click())
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

describe.each(entries)('canonical review at %s', (entry) => {
  it('validates rubric then submits the same version, feedback and criterion contract', async () => {
    await render(entry)
    await click('A')
    expect(api.gradeSubmission).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Rate every rubric criterion')
    await click('Meets')
    await input('Feedback for Correctness', 'Cases pass.')
    await click('Next step')
    await click('B')
    expect(api.gradeSubmission).toHaveBeenCalledExactlyOnceWith(42, {
      grade: 'B',
      feedback: 'Try another case.',
      base_submission_updated_at: first.updated_at,
      criterion_results: [{ rubric_criterion_id: 10, rating: 'meets', feedback: 'Cases pass.' }],
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
    await click('A')
    expect(container.querySelector<HTMLTextAreaElement>('textarea[id]')?.value).toBe(
      'Draft overall',
    )
    expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label]')?.value).toBe(
      'Draft criterion',
    )
    await click('A')
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
    await click('B')
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
    await click('A')
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
    await click('Refresh checks')
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
    expect(container.textContent).toContain('Current record')
    await input('overall', 'Reusable feedback')
    await click('Save draft as reusable snippet')
    expect(api.createFeedbackSnippet).toHaveBeenCalledWith('Reusable feedback')
    expect(container.textContent).toContain('Saved snippet')
    expect(api.gradeSubmission).not.toHaveBeenCalled()
  })
  it.each(['button', 'keyboard'] as const)('confirms blank redo via %s and protects pending confirmation/save', async (path) => {
    await render(entry)
    await click('Meets')
    await input('overall', '   ')
    const redo = async () => {
      if (path === 'button') await click('Redo')
      else await act(async () => container.querySelector('[aria-label="Submission review"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true })))
    }
    let finish!: (value: boolean) => void
    confirm.mockImplementationOnce(() => new Promise<boolean>((resolve) => { finish = resolve }))
    await redo()
    await redo()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Request a redo without feedback?',
      description: "The student won't know what to change.",
    }))
    expect(api.gradeSubmission).not.toHaveBeenCalled()
    await act(async () => finish(false))
    expect(api.gradeSubmission).not.toHaveBeenCalled()
    let saved!: (value: unknown) => void
    vi.mocked(api.gradeSubmission).mockImplementationOnce(() => new Promise((resolve) => { saved = resolve }) as never)
    await redo()
    await redo()
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(api.gradeSubmission).toHaveBeenCalledExactlyOnceWith(42, expect.objectContaining({ grade: 'R', feedback: '   ' }))
    await act(async () => saved({ data: { submission: { ...first, grade: 'R' } }, error: null }))
  })
  it('does not steal textarea focus on ordinary check updates', async () => {
    vi.spyOn(api, 'refreshSubmissionGithubChecks').mockResolvedValue({ data: { github_checks: null }, error: null } as never)
    await render(entry)
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea[id]')!
    textarea.focus()
    await click('Refresh checks')
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
    a.textContent?.startsWith('Open submission record'),
  )!
  await act(async () => record.click())
  expect(router.state.location.pathname).toBe('/admin/submissions/42')
  await act(async () =>
    [...container.querySelectorAll('a')].find((a) => a.textContent === 'Back')!.click(),
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
  await click('B')
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
      await click('B')
    } else await click('Next')
    expect(router.state.location.pathname).toBe('/admin/submissions/41')
    expect(Object.fromEntries(new URLSearchParams(router.state.location.search))).toEqual({
      cohort_id: '9',
      student_id: '18',
      queue: filter,
      return_to: '/admin/grading?filter=all',
    })
    expect(api.getStudentProgress).toHaveBeenLastCalledWith(18, 9)
    expect(container.textContent).toContain('Workspace: Second cohort')
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
    expect(container.textContent).not.toContain('Workspace: Old cohort')
  },
)
