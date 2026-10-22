import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { submissionPath } from '../../lib/routes'

export function isPreviousAttempt(submission: { id: number; latest_submission_id?: number | null }) {
  return Boolean(submission.latest_submission_id && submission.latest_submission_id !== submission.id)
}

/** Keep historical feedback and rubric visible, but prevent any review edits. */
export function AttemptReview({ submission, navigationContext, children }: { submission: { id: number; latest_submission_id?: number | null }; navigationContext: Parameters<typeof submissionPath>[1]; children: ReactNode }) {
  const previous = isPreviousAttempt(submission)
  return <>
    {previous && <div role="status" className="mb-4 rounded-xl border border-line bg-surface-sunken p-3 text-sm text-ink-secondary">
      <p>Previous attempt · read-only. Your draft is kept on this screen.</p>
      <Link className="app-link inline-flex min-h-11 items-center font-semibold" to={submissionPath(submission.latest_submission_id!, navigationContext)}>Grade the latest attempt</Link>
    </div>}
    <fieldset disabled={previous} className="min-w-0 space-y-4 border-0 p-0">{children}</fieldset>
  </>
}
