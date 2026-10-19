export type ReviewStatus = 'awaiting_review' | 'redo_requested' | 'reviewed' | null | undefined

export type LearnerStatus = 'done' | 'awaiting_review' | 'redo' | 'in_progress' | 'open' | 'upcoming' | 'closed'

export type StatusTone = 'success' | 'pending' | 'warning' | 'neutral' | 'quiet'

export const LEARNER_STATUS: Record<LearnerStatus, { label: string; shortLabel: string; tone: StatusTone }> = {
  done: { label: 'Done', shortLabel: 'Done', tone: 'success' },
  awaiting_review: { label: 'Submitted · awaiting review', shortLabel: 'Awaiting review', tone: 'pending' },
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

/** Weekly-plan items carry the API's coarse state plus the additive review status. */
export function weeklyItemStatus(item: { state: string; review_status?: ReviewStatus }): LearnerStatus {
  return learnerLessonStatus({
    completed: item.state === 'completed',
    available: item.state !== 'upcoming',
    submissionsClosed: item.state === 'closed',
    reviewStatus: item.review_status,
  })
}

/** Status of a single graded block from its latest submission. */
export function submissionStatus(latest: { grade: string | null } | null | undefined): LearnerStatus | null {
  if (!latest) return null
  if (latest.grade === 'R') return 'redo'
  if (latest.grade === null) return 'awaiting_review'
  return 'done'
}

/** CSG family status colours (success, pending, warning) plus two neutral tones. */
export const STATUS_TONE_CLASSES: Record<StatusTone, string> = {
  success: 'border-success-200 bg-success-50 text-success-700',
  pending: 'border-pending-200 bg-pending-50 text-pending-700',
  warning: 'border-warning-200 bg-warning-50 text-warning-800',
  neutral: 'border-line-strong bg-surface-raised text-ink-secondary',
  quiet: 'border-line bg-surface-sunken text-ink-muted',
}
