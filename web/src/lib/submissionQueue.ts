export type SubmissionQueueFilter = 'ungraded' | 'redo' | 'all'

interface QueueSubmission {
  id: number
  enrollment_id?: number | null
  cohort_id?: number | null
  latest_submission_id?: number | null
  user_id: number
  content_block_id: number
  grade: string | null
  created_at: string
}

export function orderSubmissionQueue<T extends QueueSubmission>(submissions: T[], filter: SubmissionQueueFilter) {
  const latestIds = getLatestSubmissionIds(submissions)

  return submissions.filter((submission) => {
    if (filter === 'ungraded') return latestIds.has(submission.id) && submission.grade === null
    if (filter === 'redo') return latestIds.has(submission.id) && submission.grade === 'R'
    return true
  }).sort((a, b) => {
    const aLatest = latestIds.has(a.id)
    const bLatest = latestIds.has(b.id)
    if (aLatest !== bLatest) return aLatest ? -1 : 1
    return compareNewestFirst(a, b)
  })
}

export function getLatestSubmissionIds<T extends QueueSubmission>(submissions: T[]) {
  const latestByAssignment = new Map<string, T>()
  submissions.forEach((submission) => {
    const key = `${submission.enrollment_id ? `enrollment:${submission.enrollment_id}` : `legacy:${submission.cohort_id || "unknown"}:${submission.user_id}`}:${submission.content_block_id}`
    const current = latestByAssignment.get(key)
    const isCurrentAttempt = submission.latest_submission_id === submission.id
    const currentIsLatest = current?.latest_submission_id === current?.id && current?.latest_submission_id != null
    if (!current || (isCurrentAttempt && !currentIsLatest) || (isCurrentAttempt === currentIsLatest && compareNewestFirst(submission, current) < 0)) latestByAssignment.set(key, submission)
  })
  return new Set(Array.from(latestByAssignment.values()).filter((submission) => !submission.latest_submission_id || submission.latest_submission_id === submission.id).map((submission) => submission.id))
}

/**
 * The review order on a module grading page, for its side panel and for a
 * submission record opened from it, so Previous/Next walk the same list.
 * The grid walks every latest attempt; the queue view uses its filter; the
 * students view walks the chosen student's work.
 */
export function moduleReviewQueue<T extends QueueSubmission>(
  submissions: T[],
  options: { view: 'grid' | 'queue' | 'students'; filter: SubmissionQueueFilter; studentId?: number | null },
) {
  if (options.view === 'grid') {
    const latestIds = getLatestSubmissionIds(submissions)
    return submissions.filter((item) => latestIds.has(item.id))
  }
  const scoped = submissions.filter((item) => !options.studentId || item.user_id === options.studentId)
  return orderSubmissionQueue(scoped, options.view === 'students' && options.studentId ? 'all' : options.filter)
}

/**
 * The queue with a freshly loaded record's grade and latest attempt in place
 * of its listed copy, or null when the listed copy agrees (or the record is
 * not listed). A record graded or superseded elsewhere since the queue was
 * fetched then drops out of a filtered queue at once, before the refetch.
 */
export function withFreshSubmission<T extends QueueSubmission>(items: T[], fresh: QueueSubmission | null | undefined): T[] | null {
  if (!fresh) return null
  const index = items.findIndex((item) => item.id === fresh.id)
  if (index < 0) return null
  const listed = items[index]
  if (listed.grade === fresh.grade && (listed.latest_submission_id ?? null) === (fresh.latest_submission_id ?? null)) return null
  const next = items.slice()
  next[index] = { ...listed, grade: fresh.grade, latest_submission_id: fresh.latest_submission_id }
  return next
}

function compareNewestFirst(a: QueueSubmission, b: QueueSubmission) {
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime() || b.id - a.id
}

/** "Lesson · Block" for a queue row, without repeating a block title that matches its lesson. */
export function submissionWhereLabel(lessonTitle: string | null | undefined, blockTitle: string | null | undefined): string {
  const lesson = lessonTitle?.trim() || ''
  const block = blockTitle?.trim() || ''
  if (!block || block.toLowerCase() === lesson.toLowerCase()) return lesson || block
  if (!lesson) return block
  return `${lesson} · ${block}`
}

/** True when the feedback or rubric draft differs from what the submission has saved. */
export function feedbackDraftDiffers(
  submission: { feedback: string | null; rubric?: { criteria: Array<{ id: number; rating?: string | null; feedback?: string | null }> } | null } | null,
  feedback: string,
  criterionResults: Record<number, { rating: string | null; feedback: string }>,
) {
  if (!submission) return false
  if (feedback !== (submission.feedback || '')) return true
  return (submission.rubric?.criteria || []).some((criterion) => (
    (criterionResults[criterion.id]?.rating || null) !== (criterion.rating || null) ||
    (criterionResults[criterion.id]?.feedback || '') !== (criterion.feedback || '')
  ))
}

export const DISCARD_DRAFT_CONFIRMATION = {
  title: 'Discard your feedback draft?',
  description: 'Your unsaved feedback and rubric ratings for this submission will be lost.',
  confirmLabel: 'Discard and move on',
  cancelLabel: 'Keep editing',
  tone: 'danger' as const,
}

/** Shown in the grade bar when Redo is chosen with no written feedback (U-0.4, decision 2). */
export const REDO_NEEDS_FEEDBACK = 'Write feedback before choosing Redo, so the student knows what to change.'

/**
 * Feedback that says nothing: empty, or only Unicode whitespace (NBSP, em space, ...) and
 * zero-width characters. A Redo needs feedback that isn't blank; the API uses the same rule
 * (Submission.blank_feedback?).
 */
export function isBlankFeedback(text: string | null | undefined) {
  return /^[\s\u200B-\u200D\u2060\uFEFF]*$/u.test(text ?? '')
}
