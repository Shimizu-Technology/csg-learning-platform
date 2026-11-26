// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { withLeaveGuard } from '../../test/TestRouter'
import { SubmissionReviewPanel } from './SubmissionReviewPanel'
import { api } from '../../lib/api'
import type { Submission, SubmissionGradeSuggestion } from '../../types/api'
import { summarizeCodeChecks, type CodeCheckResult } from '../../lib/codeChecks'

const confirm = vi.hoisted(() => vi.fn().mockResolvedValue(true))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }))
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => confirm }))
vi.mock('../../contexts/AuthContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../contexts/AuthContext')>()
  return {
    ...actual,
    useAuthContext: () => ({ ...actual.useAuthContext(), user: { id: 2, is_staff: true, is_admin: false } as never }),
  }
})
vi.mock('./StudentContextDrawer', () => ({ StudentContextDrawer: () => null }))
vi.mock('../shared/CodeRunner', () => ({ CodeRunner: () => null }))
const runCodeChecks = vi.hoisted(() => vi.fn())
vi.mock('../../lib/codeChecks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/codeChecks')>()),
  runCodeChecks,
}))

const SHA = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'

function makeSuggestion(overrides: Partial<SubmissionGradeSuggestion> = {}): SubmissionGradeSuggestion {
  return {
    id: 10,
    submission_id: 50,
    enrollment_id: 1,
    content_block_id: 8,
    exercise_check_policy_id: 3,
    policy_version: 2,
    commit_sha: SHA,
    outcome: 'suggest_b',
    suggested_grade: 'B',
    reason_code: 'all_required_checks_passed',
    reason_summary: 'All 1 required exercise check(s) passed for commit a1b2c3d4e5f6; B suggested for instructor review.',
    evidence: {
      required_checks: ['prework/111.rb'],
      runs: [
        {
          id: 1,
          name: 'prework/111.rb',
          app_slug: 'github-actions',
          status: 'completed',
          conclusion: 'success',
          details_url: 'https://github.com/learner/prework/runs/1',
        },
      ],
      missing_checks: [],
      untrusted_checks: [],
    },
    evaluated_at: '2026-11-22T01:00:00.000000Z',
    stale_for_current_policy: false,
    stale: false,
    decision: null,
    override_reason: null,
    decided_by_id: null,
    decided_at: null,
    updated_at: '2026-11-22T01:00:00.000000Z',
    ...overrides,
  }
}

function makeSubmission(overrides: Partial<Submission> = {}): Submission {
  return {
    id: 50,
    latest_submission_id: 50,
    enrollment_id: 1,
    cohort_id: 4,
    cohort_name: 'Opted-In Prework',
    user_id: 20,
    user_name: 'Alex Rivera',
    content_block_id: 8,
    submission_type: 'prework_github_sync',
    text: 'def add(a, b)\n  a + b\nend',
    grade: null,
    grading_scale: 'letter_abc_redo',
    feedback: null,
    graded_by: null,
    graded_at: null,
    num_submissions: 1,
    created_at: '2026-11-22T00:00:00Z',
    updated_at: '2026-11-22T00:00:00.123456Z',
    content_block_title: 'Exercise 111',
    content_block_type: 'exercise',
    lesson_id: 30,
    lesson_title: 'Day 1',
    module_id: 2,
    module_name: 'Prework',
    module_position: 0,
    course_delivery: 'program',
    week_number: 1,
    filename: '111.rb',
    language_hint: 'ruby',
    github_issue_url: null,
    github_code_url: null,
    repo_url: 'https://github.com/learner/prework',
    pr_url: null,
    live_url: null,
    branch: 'main',
    commit_sha: SHA,
    notes: null,
    submission_config: {},
    rubric: null,
    grade_suggestion: makeSuggestion(),
    ...overrides,
  }
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  confirm.mockReset().mockResolvedValue(true)
  runCodeChecks.mockReset()
  window.localStorage.setItem('csg-editor-preferences:2', JSON.stringify({ mode: 'markdown', enterSends: true }))
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  vi.spyOn(api, 'getFeedbackSnippets').mockResolvedValue({ data: { feedback_snippets: [] }, error: null } as never)
  vi.spyOn(api, 'getCohorts').mockResolvedValue({
    data: { cohorts: [{ id: 4, name: 'Opted-In Prework', curriculum_name: 'Prework' }] },
    error: null,
  } as never)
  vi.spyOn(api, 'getRecordRelated').mockResolvedValue({
    data: { related: { type: 'submission', id: 50, context: { cohort: { id: 4, name: 'Opted-In Prework' } }, items: [] } },
    error: null,
  } as never)
  Element.prototype.scrollIntoView = vi.fn()
  window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

const settle = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)))

async function renderPanel(
  submission: Submission,
  onSaved?: (s: Submission) => void,
  followingAfterSave?: (grade: string) => number | null,
  onNavigate?: (id: number) => void,
) {
  vi.spyOn(api, 'getSubmission')
    .mockResolvedValue({ data: null, error: null } as never)
    .mockResolvedValueOnce({ data: { submission }, error: null })
  const router = createMemoryRouter(
    withLeaveGuard([
      {
        path: '/',
        element: (
          <SubmissionReviewPanel
            submissionId={submission.id}
            navigationContext={{ cohortId: 4 }}
            onSaved={onSaved}
            nextId={onNavigate ? 51 : undefined}
            onNavigate={onNavigate}
            followingAfterSave={followingAfterSave}
          />
        ),
      },
    ]),
    { initialEntries: ['/'] },
  )
  await act(async () => root.render(<RouterProvider router={router} />))
  await settle()
  return router
}

function findButton(label: string) {
  return [...container.querySelectorAll('button')].find((button) => button.textContent?.trim() === label)
}



const CHECKS = [
  { id: 'c1', name: 'Adds numbers', code: 'assert_equal 3, add(1, 2)' },
  { id: 'c2', name: 'Handles zero', code: 'assert_equal 0, add(0, 0)' },
]
const RUNNER = { runner: { enabled: true, language: 'ruby', checks: CHECKS } }

function result(id: string, name: string, passed: boolean, error: string | null = null): CodeCheckResult {
  return { id, name, passed, timedOut: false, error, stdout: '', durationMs: 5 }
}

function textSubmission(overrides: Partial<Submission> = {}) {
  return makeSubmission({
    submission_type: 'text_submission', grade_suggestion: undefined, repo_url: null, commit_sha: null, branch: null,
    grading_scale: 'pass_redo', submission_config: RUNNER, ...overrides,
  })
}

describe('SubmissionReviewPanel in-browser code checks', () => {
  it('runs the exercise checks on the saved text and selects Pass without saving', async () => {
    runCodeChecks.mockResolvedValue(summarizeCodeChecks([result('c1', 'Adds numbers', true), result('c2', 'Handles zero', true)]))
    const gradeSpy = vi.spyOn(api, 'gradeSubmission')
    await renderPanel(textSubmission())
    await settle()

    expect(runCodeChecks).toHaveBeenCalledWith(expect.objectContaining({ language: 'ruby', code: 'def add(a, b)\n  a + b\nend', checks: CHECKS }))
    const card = container.querySelector('[data-runner-checks]')
    expect(card?.getAttribute('data-runner-checks')).toBe('passed')
    expect(card?.textContent).toContain('All 2 checks passed · Pass suggested')
    await act(async () => findButton('Select Pass')!.click())
    expect(findButton('Select Pass')!.getAttribute('aria-pressed')).toBe('true')
    expect(gradeSpy).not.toHaveBeenCalled()
  })

  it('suggests B on an A / B / C / Redo curriculum', async () => {
    runCodeChecks.mockResolvedValue(summarizeCodeChecks([result('c1', 'Adds numbers', true), result('c2', 'Handles zero', true)]))
    await renderPanel(textSubmission({ grading_scale: 'letter_abc_redo' }))
    await settle()
    expect(container.textContent).toContain('All 2 checks passed · B suggested')
    expect(findButton('Select B')).toBeTruthy()
  })

  it('reports failures for review with their messages and offers no passing grade', async () => {
    runCodeChecks.mockResolvedValue(summarizeCodeChecks([result('c1', 'Adds numbers', true), result('c2', 'Handles zero', false, 'Expected 0, got nil')]))
    await renderPanel(textSubmission())
    await settle()
    const card = container.querySelector('[data-runner-checks]')!
    expect(card.getAttribute('data-runner-checks')).toBe('failed')
    expect(card.textContent).toContain('1 of 2 checks failed · Review for Redo')
    expect(card.textContent).toContain('Expected 0, got nil')
    expect(findButton('Select Pass')).toBeUndefined()

    runCodeChecks.mockResolvedValue(summarizeCodeChecks([result('c1', 'Adds numbers', true), result('c2', 'Handles zero', true)]))
    await act(async () => findButton('Re-run checks')!.click())
    await settle()
    expect(runCodeChecks).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('All 2 checks passed')
  })

  it('runs nothing without checks, with the runner off, or with blank text', async () => {
    await renderPanel(textSubmission({ submission_config: { runner: { enabled: false, language: 'ruby', checks: CHECKS } } }))
    await settle()
    expect(container.querySelector('[data-runner-checks]')).toBeNull()
    act(() => root.unmount())
    root = createRoot(container)
    await renderPanel(textSubmission({ text: '   ' }))
    await settle()
    expect(container.querySelector('[data-runner-checks]')).toBeNull()
    expect(runCodeChecks).not.toHaveBeenCalled()
  })
})
