// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../lib/api'
import { summarizeCodeChecks } from '../../lib/codeChecks'
import type { BatchReview, BatchReviewSubmission } from '../../types/api'
import { BatchReviewView } from './BatchReviewView'

const confirm = vi.hoisted(() => vi.fn())
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
const runCodeChecks = vi.hoisted(() => vi.fn())
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => confirm }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => toast }))
vi.mock('../../lib/codeChecks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/codeChecks')>()),
  runCodeChecks,
}))

const CHECKS = [{ id: 'c1', name: 'Prints 10', code: "assert output.include?('10')" }]

function card(id: number, name: string, text: string | null, overrides: Partial<BatchReviewSubmission> = {}): BatchReviewSubmission {
  return {
    id, enrollment_id: id, latest_submission_id: id, user_id: id + 100, user_name: name, cohort_id: 4, cohort_name: 'Cohort A',
    num_submissions: 1, created_at: '2026-11-26T00:00:00Z', updated_at: `2026-11-26T00:00:0${id}.123456Z`, submission_type: 'text_submission',
    text, repo_url: null, github_code_url: null, pr_url: null, live_url: null, commit_sha: null, ...overrides,
  }
}

function review(overrides: Partial<NonNullable<BatchReview['exercise']>> = {}, submissions = [card(1, 'Alice', 'puts 10'), card(2, 'Bob', 'puts 9'), card(3, 'Cara', null)]): BatchReview {
  const exercise = {
    content_block_id: 8, title: 'Count to ten', lesson_id: 3, lesson_title: 'Loops', module_id: 2, module_name: 'Week 1', module_position: 0,
    waiting: submissions.length, has_rubric: false, grading_scale: 'pass_redo' as const, updated_at: '2026-11-26T00:00:00.000001Z', submission_type: 'text_submission', filename: 'count.rb',
    language_hint: null, submission_config: { runner: { enabled: true, language: 'ruby', checks: CHECKS } }, ...overrides,
  }
  return {
    exercises: [{
      content_block_id: exercise.content_block_id, title: exercise.title, lesson_id: exercise.lesson_id, lesson_title: exercise.lesson_title,
      module_id: exercise.module_id, module_name: exercise.module_name, module_position: exercise.module_position, waiting: submissions.length,
      has_rubric: exercise.has_rubric, grading_scale: exercise.grading_scale,
    }],
    exercise, submissions, total_count: submissions.length, max_batch_size: 50,
  }
}

let container: HTMLDivElement
let root: Root
const onOpenReview = vi.fn()
const onChooseExercise = vi.fn()
const settle = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)))

beforeEach(() => {
  confirm.mockReset().mockResolvedValue(true)
  toast.success.mockReset()
  toast.error.mockReset()
  runCodeChecks.mockReset().mockImplementation(async ({ code }: { code: string }) => summarizeCodeChecks([
    { id: 'c1', name: 'Prints 10', passed: code.includes('10'), timedOut: false, error: code.includes('10') ? null : 'Assertion failed', stdout: '', durationMs: 3 },
  ]))
  onOpenReview.mockReset()
  onChooseExercise.mockReset()
  onBatchGraded.mockReset()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

const onBatchGraded = vi.fn()
function view(contentBlockId: number | null, cohortId = 4) {
  return (
    <MemoryRouter>
      <BatchReviewView cohortId={cohortId} moduleId={null} lessonId={null} contentBlockId={contentBlockId}
        onChooseExercise={onChooseExercise} onOpenReview={onOpenReview} onExit={vi.fn()} onBatchGraded={onBatchGraded} />
    </MemoryRouter>
  )
}

async function renderView(data: BatchReview, contentBlockId: number | null = 8) {
  vi.spyOn(api, 'getBatchReview').mockResolvedValue({ data, error: null })
  await act(async () => root.render(view(contentBlockId)))
  await settle()
  await settle()
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const selectedIds = () => [...container.querySelectorAll('[data-batch-selected="true"]')].map((element) => Number(element.getAttribute('data-batch-submission')))
const button = (label: string) => [...container.querySelectorAll('button')].find((element) => element.textContent?.trim() === label)

describe('BatchReviewView', () => {
  it('runs the checks in the browser one card at a time and selects only work that passed', async () => {
    await renderView(review())
    expect(runCodeChecks).toHaveBeenCalledTimes(2)
    expect(runCodeChecks.mock.calls.map(([options]) => options.code)).toEqual(['puts 10', 'puts 9'])
    expect(selectedIds()).toEqual([1])
    expect(container.textContent).toContain('1 of 1 check passed')
    expect(container.textContent).toContain('1 of 1 check failed')
    expect(container.textContent).toContain('Approve selected as Pass (1)')
  })

  it('pins the default exercise so a refresh stays on it', async () => {
    await renderView(review(), null)
    expect(onChooseExercise).toHaveBeenCalledWith(8)
  })

  it('approves the selection as Pass after confirming, then reports skipped work', async () => {
    const batch = vi.spyOn(api, 'batchGradeSubmissions').mockResolvedValue({
      data: { graded: [{ submission_id: 1, user_id: 101, user_name: 'Alice', grade: 'P', graded_at: 'x', updated_at: 'y' }], skipped: [{ submission_id: 3, code: 'stale', reason: 'This submission changed after you opened it. Reload and review it again.' }] },
      error: null,
    })
    await renderView(review())
    await act(async () => (container.querySelector('#batch-select-3') as HTMLInputElement).click())
    const input = container.querySelector('input[placeholder^="Feedback for everyone"]') as HTMLInputElement
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Nice work!')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => button('Approve selected as Pass (2)')!.click())
    await settle()

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Approve 2 submissions as Pass?', confirmLabel: 'Approve as Pass' }))
    expect(confirm.mock.calls[0][0].description).toContain("1 of them doesn't have passing automated checks")
    expect(batch).toHaveBeenCalledWith({
      grade: 'P', feedback: 'Nice work!',
      items: [1, 3].map((id) => ({
        submission_id: id, base_submission_updated_at: `2026-11-26T00:00:0${id}.123456Z`,
        expected_content_block_id: 8, expected_content_block_updated_at: '2026-11-26T00:00:00.000001Z',
      })),
    })
    expect(toast.success).toHaveBeenCalledWith('Approved 1 submission as Pass · 1 skipped')
    expect(container.textContent).toContain('Cara: This submission changed after you opened it.')
  })

  it('does nothing when the confirmation is cancelled, and Clear selection empties it', async () => {
    confirm.mockResolvedValue(false)
    const batch = vi.spyOn(api, 'batchGradeSubmissions')
    await renderView(review())
    await act(async () => button('Approve selected as Pass (1)')!.click())
    expect(batch).not.toHaveBeenCalled()
    await act(async () => button('Clear selection')!.click())
    expect(selectedIds()).toEqual([])
    await act(async () => button('Select all')!.click())
    expect(selectedIds()).toEqual([1, 2, 3])
  })

  it('selects fresh B suggestions on an A / B / C / Redo exercise without browser checks', async () => {
    const suggestion = { id: 1, submission_id: 2, enrollment_id: 2, content_block_id: 8, exercise_check_policy_id: null, policy_version: null, commit_sha: null,
      outcome: 'suggest_b', suggested_grade: 'B', reason_code: 'all_required_checks_passed', reason_summary: 'Passed', evidence: {}, evaluated_at: 'x',
      stale_for_current_policy: false, stale: false, decision: null, override_reason: null, decided_by_id: null, decided_at: null, updated_at: 'x' } as unknown as NonNullable<BatchReviewSubmission['grade_suggestion']>
    await renderView(review({ grading_scale: 'letter_abc_redo', submission_config: {} }, [card(1, 'Alice', null), card(2, 'Bob', null, { grade_suggestion: suggestion })]))
    expect(runCodeChecks).not.toHaveBeenCalled()
    expect(selectedIds()).toEqual([2])
    expect(container.textContent).toContain('B suggested')
    expect(container.textContent).toContain('Approve selected as B (1)')
  })

  it('sends rubric exercises back to individual review, and Open full review opens one', async () => {
    await renderView(review({ has_rubric: true }))
    expect(container.textContent).toContain('Exercises with a rubric are graded individually so you can rate each criterion.')
    expect(container.querySelector('[data-batch-submission]')).toBeNull()
    act(() => root.unmount())
    root = createRoot(container)
    await renderView(review())
    await act(async () => [...container.querySelectorAll('button')].filter((element) => element.textContent?.includes('Open full review'))[1].click())
    expect(onOpenReview).toHaveBeenCalledWith(2)
  })

  it('reports a successful approval so the page refreshes its queue', async () => {
    vi.spyOn(api, 'batchGradeSubmissions').mockResolvedValue({
      data: { graded: [{ submission_id: 1, user_id: 101, user_name: 'Alice', grade: 'P', graded_at: 'x', updated_at: 'y' }], skipped: [] }, error: null,
    })
    await renderView(review())
    await act(async () => button('Approve selected as Pass (1)')!.click())
    await settle()
    expect(onBatchGraded).toHaveBeenCalledTimes(1)
  })

  it("shows nothing selectable from the previous scope while the next one loads, or after it fails", async () => {
    await renderView(review())
    expect(selectedIds()).toEqual([1])
    const next = deferred<Awaited<ReturnType<typeof api.getBatchReview>>>()
    vi.spyOn(api, 'getBatchReview').mockReturnValue(next.promise)
    await act(async () => root.render(view(8, 5)))
    expect(container.querySelector('[data-batch-submission]')).toBeNull()
    expect(button('Approve selected as Pass (1)')).toBeUndefined()
    await act(async () => next.resolve({ data: null, error: 'Could not load batch review.' }))
    await settle()
    expect(container.querySelector('[data-batch-submission]')).toBeNull()
    expect(container.textContent).toContain('Could not load batch review.')
  })

  it("ignores a slower load for a scope the instructor already left", async () => {
    const first = deferred<Awaited<ReturnType<typeof api.getBatchReview>>>()
    const load = vi.spyOn(api, 'getBatchReview').mockReturnValueOnce(first.promise)
    load.mockResolvedValueOnce({ data: review({ content_block_id: 9, title: 'Second exercise' }, [card(5, 'Eve', 'puts 10')]), error: null })
    await act(async () => root.render(view(8)))
    await act(async () => root.render(view(9)))
    await settle()
    await act(async () => first.resolve({ data: review(), error: null }))
    await settle()
    expect([...container.querySelectorAll('[data-batch-submission]')].map((element) => element.getAttribute('data-batch-submission'))).toEqual(['5'])
  })

  it("doesn't let an approval started on one exercise reload over the next", async () => {
    const approval = deferred<Awaited<ReturnType<typeof api.batchGradeSubmissions>>>()
    vi.spyOn(api, 'batchGradeSubmissions').mockReturnValue(approval.promise)
    await renderView(review())
    await act(async () => button('Approve selected as Pass (1)')!.click())
    const load = vi.spyOn(api, 'getBatchReview').mockResolvedValue({ data: review({ content_block_id: 9, title: 'Second exercise' }, [card(5, 'Eve', 'puts 10')]), error: null })
    load.mockClear()
    await act(async () => root.render(view(9)))
    await settle()
    expect(load).toHaveBeenCalledTimes(1)
    await act(async () => approval.resolve({
      data: { graded: [{ submission_id: 1, user_id: 101, user_name: 'Alice', grade: 'P', graded_at: 'x', updated_at: 'y' }], skipped: [{ submission_id: 2, code: 'stale', reason: 'Changed.' }] },
      error: null,
    }))
    await settle()
    // The page still learns that work was graded, but exercise 9 is neither reloaded nor annotated.
    expect(onBatchGraded).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledTimes(1)
    expect(container.textContent).not.toContain('skipped')
    expect([...container.querySelectorAll('[data-batch-submission]')].map((element) => element.getAttribute('data-batch-submission'))).toEqual(['5'])
  })

  it("doesn't approve when the scope changed while the confirmation was open", async () => {
    const answer = deferred<boolean>()
    confirm.mockReturnValue(answer.promise)
    const batch = vi.spyOn(api, 'batchGradeSubmissions')
    await renderView(review())
    await act(async () => button('Approve selected as Pass (1)')!.click())
    vi.spyOn(api, 'getBatchReview').mockResolvedValue({ data: review({ content_block_id: 9 }, [card(5, 'Eve', 'puts 10')]), error: null })
    await act(async () => root.render(view(9)))
    await settle()
    await act(async () => answer.resolve(true))
    await settle()
    expect(batch).not.toHaveBeenCalled()
  })

  it('never leaves a card running when the check runner fails', async () => {
    runCodeChecks.mockRejectedValue(new Error('Worker exploded'))
    await renderView(review())
    expect(container.textContent).not.toContain('Running checks')
    expect(container.textContent).toContain('1 of 1 check failed')
    expect(selectedIds()).toEqual([])
  })

  it('cancels an open confirmation if the instructor leaves and returns or refreshes, and clears feedback across exercises', async () => {
    const answer = deferred<boolean>()
    confirm.mockReturnValue(answer.promise)
    const batch = vi.spyOn(api, 'batchGradeSubmissions')
    await renderView(review())
    const input = container.querySelector<HTMLInputElement>('input[placeholder*="Feedback"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Great loop!')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(input.value).toBe('Great loop!')

    // Open confirmation, then leave to exercise 9 and return to exercise 8 before confirming.
    await act(async () => button('Approve selected as Pass (1)')!.click())
    vi.spyOn(api, 'getBatchReview')
      .mockResolvedValueOnce({ data: review({ content_block_id: 9, title: 'Second' }, [card(5, 'Eve', 'puts 10')]), error: null })
      .mockResolvedValueOnce({ data: review(), error: null })
    await act(async () => root.render(view(9)))
    await settle()
    expect(container.querySelector<HTMLInputElement>('input[placeholder*="Feedback"]')?.value).toBe('')
    await act(async () => root.render(view(8)))
    await settle()
    await act(async () => answer.resolve(true))
    await settle()
    expect(batch).not.toHaveBeenCalled()

    // Also cancels if Refresh replaces the snapshot while the confirmation is open.
    const answer2 = deferred<boolean>()
    confirm.mockReturnValue(answer2.promise)
    await act(async () => button('Approve selected as Pass (1)')!.click())
    vi.spyOn(api, 'getBatchReview').mockResolvedValueOnce({ data: review(), error: null })
    await act(async () => button('Refresh')!.click())
    await settle()
    await act(async () => answer2.resolve(true))
    await settle()
    expect(batch).not.toHaveBeenCalled()
  })

  it('clears stale cards and shows an error when a reload rejects, and displays waiting count for exercises outside the cap', async () => {
    await renderView({ ...review({ waiting: 7 }, [card(1, 'Alice', 'puts 10')]), exercises: [] })
    expect(container.querySelector('select option')?.textContent).toContain('(7)')

    vi.spyOn(api, 'getBatchReview').mockRejectedValueOnce(new Error('Token refresh failed'))
    await act(async () => button('Refresh')!.click())
    await settle()
    expect(container.querySelector('[data-batch-submission]')).toBeNull()
    expect(button('Approve selected as Pass (1)')).toBeUndefined()
    expect(container.textContent).toContain('Token refresh failed')
  })

  it('cancels an in-flight load for exercise B when returning to exercise A before B responds', async () => {
    await renderView(review())
    expect([...container.querySelectorAll('[data-batch-submission]')].map((el) => el.getAttribute('data-batch-submission'))).toEqual(['1', '2', '3'])
    const pendingB = deferred<Awaited<ReturnType<typeof api.getBatchReview>>>()
    vi.spyOn(api, 'getBatchReview').mockReturnValueOnce(pendingB.promise)
    await act(async () => root.render(view(9)))
    await act(async () => root.render(view(8)))
    await act(async () => pendingB.resolve({ data: review({ content_block_id: 9, title: 'Second' }, [card(5, 'Eve', 'puts 10')]), error: null }))
    await settle()
    expect([...container.querySelectorAll('[data-batch-submission]')].map((el) => el.getAttribute('data-batch-submission'))).toEqual(['1', '2', '3'])
    expect(button('Approve selected as Pass (1)')?.matches(':disabled')).toBe(false)
  })

  it('reloads the active snapshot if batchGradeSubmissions rejects so stale cards are not retried', async () => {
    await renderView(review())
    vi.spyOn(api, 'batchGradeSubmissions').mockRejectedValueOnce(new Error('Network interrupted'))
    const reloadSpy = vi.spyOn(api, 'getBatchReview')
    reloadSpy.mockClear()
    reloadSpy.mockResolvedValueOnce({ data: review({}, [card(2, 'Bob', 'puts 9')]), error: null })
    await act(async () => button('Approve selected as Pass (1)')!.click())
    await settle()
    await settle()
    expect(toast.error).toHaveBeenCalledWith('Network interrupted')
    expect(reloadSpy).toHaveBeenCalledTimes(1)
    expect([...container.querySelectorAll('[data-batch-submission]')].map((el) => el.getAttribute('data-batch-submission'))).toEqual(['2'])
  })

  it('still reloads exercise A when an in-flight approval settles after switching to B and returning before B loads', async () => {
    await renderView(review())
    const approval = deferred<Awaited<ReturnType<typeof api.batchGradeSubmissions>>>()
    vi.spyOn(api, 'batchGradeSubmissions').mockReturnValueOnce(approval.promise)
    const pendingB = deferred<Awaited<ReturnType<typeof api.getBatchReview>>>()
    const loadSpy = vi.spyOn(api, 'getBatchReview')
    loadSpy.mockClear()
    loadSpy
      .mockReturnValueOnce(pendingB.promise)
      .mockResolvedValueOnce({ data: review({}, [card(2, 'Bob', 'puts 9')]), error: null })

    await act(async () => button('Approve selected as Pass (1)')!.click())
    await act(async () => root.render(view(9)))
    await act(async () => root.render(view(8)))
    await act(async () => approval.resolve({
      data: { graded: [{ submission_id: 1, user_id: 101, user_name: 'Alice', grade: 'P', graded_at: 'x', updated_at: 'y' }], skipped: [] },
      error: null,
    }))
    await settle()
    await settle()
    expect(loadSpy).toHaveBeenCalledTimes(2)
    expect([...container.querySelectorAll('[data-batch-submission]')].map((el) => el.getAttribute('data-batch-submission'))).toEqual(['2'])
  })
})
