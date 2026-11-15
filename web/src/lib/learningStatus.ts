export type ReviewStatus = 'awaiting_review' | 'redo_requested' | 'reviewed' | null | undefined

export type LearnerStatus = 'done' | 'awaiting_review' | 'redo' | 'in_progress' | 'open' | 'upcoming' | 'closed'

export type StatusTone = 'success' | 'pending' | 'warning' | 'neutral' | 'quiet'

export const LEARNER_STATUS: Record<LearnerStatus, { label: string; shortLabel: string; tone: StatusTone }> = {
  done: { label: 'Done', shortLabel: 'Done', tone: 'success' },
  awaiting_review: { label: 'Submitted · waiting for review', shortLabel: 'Waiting for review', tone: 'pending' },
  redo: { label: 'Redo requested', shortLabel: 'Redo', tone: 'warning' },
  in_progress: { label: 'In progress', shortLabel: 'In progress', tone: 'neutral' },
  open: { label: 'To do', shortLabel: 'To do', tone: 'neutral' },
  upcoming: { label: 'Upcoming', shortLabel: 'Upcoming', tone: 'quiet' },
  closed: { label: 'Submissions closed', shortLabel: 'Closed', tone: 'quiet' },
}

interface LessonStatusInput {
  completed?: boolean
  available?: boolean
  submissionsClosed?: boolean
  reviewStatus?: ReviewStatus
  partial?: boolean
}

/**
 * One truthful status for a lesson. Review outcomes win over the stored
 * completion flag: submitted work is not "done" until an instructor reviews it,
 * and a redo is open work even though the learner already submitted once.
 */
export function learnerLessonStatus({ completed, available = true, submissionsClosed, reviewStatus, partial }: LessonStatusInput): LearnerStatus {
  if (reviewStatus === 'redo_requested') return 'redo'
  // A lesson is only awaiting review once all of its work is handed in.
  if (reviewStatus === 'awaiting_review' && completed) return 'awaiting_review'
  if (completed) return 'done'
  if (!available) return 'upcoming'
  if (submissionsClosed) return 'closed'
  if (partial) return 'in_progress'
  return 'open'
}

/**
 * A lesson row from Today, Learn or a plan. The server sends `learner_status`,
 * its one definition of where the lesson stands (AS-10); payloads cached from
 * older servers omit it, so the shared local rule above stays as the fallback.
 */
export function lessonStatus(lesson: {
  learner_status?: LearnerStatus | null
  completed?: boolean
  available?: boolean
  review_status?: ReviewStatus
  completed_blocks?: number
  submission_window?: { submissions_closed?: boolean } | null
}): LearnerStatus {
  if (lesson.learner_status) return lesson.learner_status
  return learnerLessonStatus({
    completed: lesson.completed,
    available: lesson.available,
    submissionsClosed: lesson.submission_window?.submissions_closed,
    reviewStatus: lesson.review_status,
    partial: (lesson.completed_blocks ?? 0) > 0,
  })
}

/** Weekly-plan items carry the server's learner status, or (older payloads) the coarse state plus the additive review status. */
export function weeklyItemStatus(item: { state: string; review_status?: ReviewStatus; learner_status?: LearnerStatus | null }): LearnerStatus {
  if (item.learner_status) return item.learner_status
  return learnerLessonStatus({
    completed: item.state === 'completed',
    available: item.state !== 'upcoming',
    submissionsClosed: item.state === 'closed',
    reviewStatus: item.review_status,
  })
}

const REVIEWED_SUBMISSION_TYPES = ['text_submission', 'repo_url_submission', 'repo_and_live_url_submission']

/**
 * Reviewed work: exercises, code challenges and checkpoints with a reviewed
 * submission type (the server's ContentBlock#gradable_work_block?, mobile's
 * isGradableWorkBlock). A Redo on any other step only exists in imported
 * history; it is past feedback, not work to redo (AS-10).
 */
export function isGradableWorkBlock(block: { block_type: string; submission_type?: string | null; knowledge_check?: unknown }) {
  if (block.block_type === 'exercise' || block.block_type === 'code_challenge') return true
  return block.block_type === 'checkpoint' && !block.knowledge_check && REVIEWED_SUBMISSION_TYPES.includes(block.submission_type || '')
}

/** Status of a single graded block from its latest submission. */
export function submissionStatus(latest: { grade: string | null } | null | undefined): LearnerStatus | null {
  if (!latest) return null
  if (latest.grade === 'R') return 'redo'
  if (latest.grade === null || latest.grade === undefined) return 'awaiting_review'
  return 'done'
}

/** CSG family status colours (success, pending, warning) plus two neutral tones. */
export const STATUS_TONE_CLASSES: Record<StatusTone, string> = {
  success: 'border-success-line bg-success-soft text-success-ink',
  pending: 'border-line bg-surface-sunken text-ink-secondary',
  warning: 'border-warning-line bg-warning-soft text-warning-ink',
  neutral: 'border-line-strong bg-surface-raised text-ink-secondary',
  quiet: 'border-line bg-surface-sunken text-ink-muted',
}
