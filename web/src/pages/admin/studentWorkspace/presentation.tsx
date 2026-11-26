import { CheckCircle2, Clock3, RotateCcw } from 'lucide-react'
import { Badge } from '../../../components/ui/Badge'
import { humanize } from '../../../lib/glossary'
import type { Submission } from '../../../types/api'

export function SubmissionStatus({ submission }: { submission: Submission }) {
  if (submission.grade === null)
    return (
      <Badge tone="pending" icon={<Clock3 className="h-3.5 w-3.5" aria-hidden="true" />}>
        Waiting for review
      </Badge>
    )
  if (submission.grade === 'R')
    return (
      <Badge tone="warning" icon={<RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />}>
        Redo
      </Badge>
    )
  return (
    <Badge tone="success" icon={<CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}>
      {submission.grade === 'P' ? 'Passed' : `Grade ${submission.grade}`}
    </Badge>
  )
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={status === 'active' ? 'success' : 'neutral'}>{humanize(status)}</Badge>
}

export function CountBadge({ count, tone = 'neutral' }: { count: number; tone?: 'neutral' | 'warning' }) {
  return (
    <span
      className={
        'rounded-full border px-1.5 text-xs font-semibold tabular-nums ' +
        (tone === 'warning'
          ? 'border-warning-line bg-warning-soft text-warning-ink'
          : 'border-line bg-surface-sunken text-ink-secondary')
      }
    >
      {count}
    </span>
  )
}
