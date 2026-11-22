// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { withLeaveGuard } from '../../test/TestRouter'
import { SubmissionReviewPanel } from './SubmissionReviewPanel'
import { Grading } from '../../pages/admin/Grading'
import { api } from '../../lib/api'
import type { Submission, SubmissionGradeSuggestion } from '../../types/api'

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

async function renderPanel(submission: Submission, onSaved?: (s: Submission) => void) {
  vi.spyOn(api, 'getSubmission').mockResolvedValue({ data: { submission }, error: null })
  const router = createMemoryRouter(
    withLeaveGuard([
      {
        path: '/',
        element: (
          <SubmissionReviewPanel
            submissionId={submission.id}
            navigationContext={{ cohortId: 4 }}
            onSaved={onSaved}
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

function setInputValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('SubmissionReviewPanel automated grade suggestions (X-6.7)', () => {
  it('shows Checks passed · B suggested and lets Select B pick B without auto-saving until confirmed', async () => {
    const sub = makeSubmission()
    const gradeSpy = vi.spyOn(api, 'gradeSubmission').mockResolvedValue({
      data: { submission: { ...sub, grade: 'B', grade_suggestion: makeSuggestion({ decision: 'accepted' }) } },
      error: null,
    })

    await renderPanel(sub)

    const card = container.querySelector('[data-grade-suggestion="suggest_b"]')!
    expect(card).toBeTruthy()
    expect(card.textContent).toContain('Checks passed · B suggested')
    expect(card.textContent).toContain('instructors confirm every final grade')
    expect(card.textContent).toContain(SHA.slice(0, 8))
    expect(card.textContent).toContain('Policy v2')
    expect(card.textContent).toContain('prework/111.rb')
    expect(card.textContent).toContain('Passed')

    // Click "Select B" -> selects B in picker, NEVER calls gradeSubmission!
    const selectB = findButton('Select B')!
    expect(selectB).toBeTruthy()
    await act(async () => selectB.click())
    await settle()

    expect(gradeSpy).not.toHaveBeenCalled()
    expect(findButton('B')?.getAttribute('aria-pressed')).toBe('true')
    // No override note when matching suggested grade B
    expect(container.querySelector('input[placeholder*="differs"]')).toBeNull()

    // Explicit Save grade confirms and sends B
    await act(async () => findButton('Save grade')!.click())
    await settle()
    expect(gradeSpy).toHaveBeenCalledExactlyOnceWith(50, {
      grade: 'B',
      feedback: '',
      base_submission_updated_at: sub.updated_at,
      criterion_results: [],
    })
  })

  it('shows Override note input when selected grade differs from suggestion and sends suggestion_override_reason on Save', async () => {
    const sub = makeSubmission()
    const gradeSpy = vi.spyOn(api, 'gradeSubmission').mockResolvedValue({
      data: {
        submission: {
          ...sub,
          grade: 'A',
          grade_suggestion: makeSuggestion({ decision: 'overridden', override_reason: 'Clean helper decomposition' }),
        },
      },
      error: null,
    })

    await renderPanel(sub)

    // Select A (differs from suggest_b)
    await act(async () => findButton('A')!.click())
    expect(gradeSpy).not.toHaveBeenCalled()

    const overrideInput = container.querySelector<HTMLInputElement>('input[type="text"]')!
    expect(overrideInput).toBeTruthy()
    expect(container.querySelector(`label[for="${overrideInput.id}"]`)?.textContent).toBe('Override note (optional)')

    await act(async () => setInputValue(overrideInput, '  Clean helper decomposition  '))
    await act(async () => findButton('Save grade')!.click())
    await settle()

    expect(gradeSpy).toHaveBeenCalledExactlyOnceWith(50, {
      grade: 'A',
      feedback: '',
      base_submission_updated_at: sub.updated_at,
      criterion_results: [],
      suggestion_override_reason: 'Clean helper decomposition',
    })
  })

  it('renders amber stale warning and hides Select B when evidence or policy is stale', async () => {
    const staleSub = makeSubmission({
      grade_suggestion: makeSuggestion({
        outcome: 'suggest_b',
        stale_for_current_policy: true,
        stale: true,
      }),
    })

    await renderPanel(staleSub)

    const card = container.querySelector('[data-grade-suggestion="suggest_b"]')!
    expect(card.getAttribute('data-grade-suggestion-stale')).toBe('true')
    expect(card.textContent).toContain('Stale evidence')
    expect(card.textContent).toContain('Policy updated')
    expect(findButton('Select B')).toBeUndefined()
    expect(findButton('Re-evaluate')).toBeTruthy()
  })

  it('renders review_for_redo without Select B, enforces Redo feedback, and shows override note for passing grades', async () => {
    const redoSub = makeSubmission({
      grade_suggestion: makeSuggestion({
        outcome: 'review_for_redo',
        suggested_grade: null,
        reason_code: 'required_check_failed',
        reason_summary: 'Required exercise check(s) failed: prework/111.rb.',
        evidence: {
          required_checks: ['prework/111.rb'],
          runs: [{ name: 'prework/111.rb', app_slug: 'github-actions', status: 'completed', conclusion: 'failure' }],
        },
      }),
    })
    const gradeSpy = vi.spyOn(api, 'gradeSubmission').mockResolvedValue({
      data: { submission: { ...redoSub, grade: 'B' } },
      error: null,
    })

    await renderPanel(redoSub)

    const card = container.querySelector('[data-grade-suggestion="review_for_redo"]')!
    expect(card.textContent).toContain('Checks failed · Review for Redo')
    expect(card.textContent).toContain('Failed')
    expect(findButton('Select B')).toBeUndefined()

    // Select Redo and try saving without feedback -> blocked!
    await act(async () => findButton('Redo')!.click())
    expect(container.querySelector('input[type="text"]')).toBeNull()
    await act(async () => findButton('Save grade')!.click())
    expect(gradeSpy).not.toHaveBeenCalled()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Write feedback before choosing Redo')

    // Select B -> shows override note
    await act(async () => findButton('B')!.click())
    const overrideInput = container.querySelector<HTMLInputElement>('input[type="text"]')!
    expect(overrideInput).toBeTruthy()
    await act(async () => setInputValue(overrideInput, 'Flaky runner confirmed'))
    await act(async () => findButton('Save grade')!.click())
    await settle()

    expect(gradeSpy).toHaveBeenCalledExactlyOnceWith(
      50,
      expect.objectContaining({
        grade: 'B',
        suggestion_override_reason: 'Flaky runner confirmed',
      }),
    )
  })

  it('shows Checks passed · Grade R side-by-side with recorded Overridden decision and override note', async () => {
    const sub = makeSubmission({
      grade: 'R',
      feedback: 'Do not hardcode outputs.',
      grade_suggestion: makeSuggestion({
        outcome: 'suggest_b',
        decision: 'overridden',
        override_reason: 'Hardcoded expected values',
      }),
    })

    await renderPanel(sub)

    const comparison = container.querySelector('[data-suggestion-saved-comparison]')!
    expect(comparison).toBeTruthy()
    expect(comparison.textContent).toContain('Checks passed · Grade R')
    expect(comparison.textContent).toContain('Overridden')
    expect(comparison.textContent).toContain('Override note: Hardcoded expected values')
  })

  it('Re-evaluate refreshes suggestion inline without losing unsaved feedback draft or rubric ratings', async () => {
    const sub = makeSubmission({
      rubric: {
        id: 1,
        title: 'Quality',
        description: null,
        criteria: [{ id: 10, title: 'Correctness', description: 'Works', position: 0, objective_code: null, rating: null, feedback: null }],
      },
      grade_suggestion: makeSuggestion({
        outcome: 'stale_evidence',
        suggested_grade: null,
        reason_code: 'stale_policy',
        reason_summary: 'Policy v1 is no longer active.',
        stale: true,
        stale_for_current_policy: true,
      }),
    })

    const freshSuggestion = makeSuggestion({
      outcome: 'suggest_b',
      suggested_grade: 'B',
      policy_version: 3,
      stale: false,
      stale_for_current_policy: false,
      reason_summary: 'All 1 required exercise check(s) passed under Policy v3.',
    })
    const evalSpy = vi.spyOn(api, 'evaluateSubmissionGradeSuggestion').mockResolvedValue({
      data: { grade_suggestion: freshSuggestion },
      error: null,
    })

    await renderPanel(sub)

    // Enter unsaved rubric rating and feedback draft
    await act(async () => findButton('Meets')!.click())
    const feedbackTextarea = container.querySelector<HTMLTextAreaElement>('textarea[id]')!
    await act(async () => setInputValue(feedbackTextarea, 'Keep this draft while re-evaluating'))

    expect(findButton('Select B')).toBeUndefined()
    await act(async () => findButton('Re-evaluate')!.click())
    await settle()

    expect(evalSpy).toHaveBeenCalledExactlyOnceWith(50)
    expect(container.querySelector('[data-grade-suggestion="suggest_b"]')?.textContent).toContain('Policy v3')
    expect(findButton('Select B')).toBeTruthy()
    // Feedback draft and rubric rating are preserved!
    expect(container.querySelector<HTMLTextAreaElement>('textarea[id]')!.value).toBe('Keep this draft while re-evaluating')
    expect(findButton('Meets')?.getAttribute('aria-pressed')).toBe('true')
  })

  it('shows scannable queue badges in Grading workbench and preserves filters across Save and next', async () => {
    const sub1 = makeSubmission({ id: 51, latest_submission_id: 51, user_name: 'Avery Chen', grade_suggestion: makeSuggestion({ submission_id: 51, outcome: 'suggest_b' }) })
    const sub2 = makeSubmission({
      id: 52,
      latest_submission_id: 52,
      user_name: 'Briar Diaz',
      grade_suggestion: makeSuggestion({ submission_id: 52, outcome: 'review_for_redo', suggested_grade: null, reason_code: 'required_check_failed' }),
    })
    let store = [sub1, sub2]

    vi.spyOn(api, 'getGradingQueue').mockImplementation(async (params) => {
      const items = store.filter((item) => item.grade === null && (!params.suggestion_outcome || item.grade_suggestion?.outcome === params.suggestion_outcome))
      return {
        data: {
          submissions: items,
          meta: { page: 1, per_page: 50, total_count: items.length, total_pages: 1, has_next_page: false, has_prev_page: false },
          previous: null,
          next: null,
          counts: { ungraded: items.length, redo: 0, all: store.length },
          modules: [{ id: 2, name: 'Prework', count: items.length }],
          students: items.map((item) => ({ id: item.user_id, name: item.user_name, count: 1 })),
          module_grids: [],
          lesson: null,
        },
        error: null,
      } as never
    })
    vi.spyOn(api, 'getSubmission').mockImplementation(async (id) => ({
      data: { submission: store.find((item) => item.id === id)! },
      error: null,
    }))
    vi.spyOn(api, 'gradeSubmission').mockImplementation(async (id, payload) => {
      store = store.map((item) => (item.id === id ? { ...item, grade: payload.grade } : item))
      return { data: { submission: store.find((item) => item.id === id)! }, error: null }
    })

    const router = createMemoryRouter(
      withLeaveGuard([{ path: '/admin/grading', element: <Grading /> }]),
      { initialEntries: ['/admin/grading?cohort_id=4&module_id=2&submission=51'] },
    )
    await act(async () => root.render(<RouterProvider router={router} />))
    await settle()

    expect(container.querySelector('#submission-row-51')?.textContent).toContain('B suggested')
    expect(container.querySelector('#submission-row-52')?.textContent).toContain('Review for Redo')

    await act(async () => findButton('Select B')!.click())
    await act(async () => findButton('Save and next')!.click())
    await settle()

    const params = new URLSearchParams(router.state.location.search)
    expect(params.get('cohort_id')).toBe('4')
    expect(params.get('module_id')).toBe('2')
    expect(params.get('submission')).toBe('52')
  })
})
