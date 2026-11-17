import { ChevronRight, FileCheck2 } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { EmptyState } from '../../../components/shared/EmptyState'
import { LinkButton } from '../../../components/ui/Button'
import { PreviewLink as Link } from '../../../contexts/PreviewNavigationContext'
import { formatShortDateTime } from '../../../lib/format'
import { submissionPath } from '../../../lib/routes'
import { getLatestSubmissionIds } from '../../../lib/submissionQueue'
import type { Submission } from '../../../types/api'
import { SubmissionStatus } from './presentation'

export function WorkTab({
  submissions,
  cohortId,
  studentId,
  returnTo,
}: {
  submissions: Submission[]
  cohortId: number
  studentId: number
  returnTo: string
}) {
  const [params] = useSearchParams()
  const latestIds = getLatestSubmissionIds(submissions)
  const filter = params.get('filter')
  const visible = ['ungraded', 'redo'].includes(filter || '')
    ? submissions.filter(
        (item) => latestIds.has(item.id) && (filter === 'redo' ? item.grade === 'R' : item.grade === null),
      )
    : submissions
  const exactReturn = `${returnTo}${params.size ? `?${params.toString()}` : ''}`
  if (!visible.length)
    return (
      <EmptyState
        icon={FileCheck2}
        title={filter ? 'No matching work' : 'No submitted work yet'}
        description="Work this student submits in this curriculum will appear here."
        action={
          <LinkButton variant="secondary" to={returnTo}>
            All submitted work
          </LinkButton>
        }
      />
    )
  return (
    <section className="app-surface overflow-hidden">
      <div className="border-b border-line px-5 py-4 sm:px-6">
        <h2 className="text-lg font-bold text-ink">All submitted work</h2>
        <p className="mt-1 text-sm text-ink-muted">Open a submission. Back returns you to this page.</p>
        <Link className="app-link inline-flex min-h-11 items-center text-sm" to={returnTo}>
          All submitted work
        </Link>
      </div>
      <div className="divide-y divide-line">
        {visible.map((submission) => (
          <Link
            key={submission.id}
            to={submissionPath(submission.id, { cohortId, userId: studentId, returnTo: exactReturn })}
            className="group pressable grid min-h-11 gap-3 px-5 py-4 hover:bg-surface-sunken sm:grid-cols-[minmax(0,1fr)_180px_auto] sm:items-center sm:px-6"
          >
            <div className="min-w-0">
              <p className="font-semibold text-ink [overflow-wrap:anywhere]">{submission.content_block_title}</p>
              <p className="text-sm text-ink-muted [overflow-wrap:anywhere]">
                {submission.module_name} · {submission.lesson_title}
              </p>
            </div>
            <div>
              <SubmissionStatus submission={submission} />
              <p className="mt-1 text-xs tabular-nums text-ink-muted">{formatShortDateTime(submission.created_at)}</p>
            </div>
            <ChevronRight
              className="h-4 w-4 text-ink-muted transition-colors duration-150 group-hover:text-ink"
              aria-hidden="true"
            />
          </Link>
        ))}
      </div>
    </section>
  )
}
