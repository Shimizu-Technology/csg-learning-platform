import { GradeDisplay } from './GradeDisplay'
import { StatusBadge } from './StatusBadge'

/** Redo is a request for another attempt, not an error: a secondary button with warning tones. */
export const REDO_BUTTON_CLASSES = 'border-warning-line! text-warning-ink! hover:bg-warning-soft!'

/** Queue status: awaiting review and redo use the shared learner-status badge; graded work shows its grade. */
export function SubmissionStatus({ grade }: { grade: string | null }) {
  if (grade === null) return <StatusBadge status="awaiting_review" short />
  if (grade === 'R') return <StatusBadge status="redo" short />
  return <GradeDisplay grade={grade} size="sm" />
}
