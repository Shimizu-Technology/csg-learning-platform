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
