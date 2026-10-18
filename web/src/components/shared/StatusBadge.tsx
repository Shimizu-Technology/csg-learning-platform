import { CheckCircle2, CircleDot, Clock3, LockKeyhole, RotateCcw, CalendarClock } from 'lucide-react'
import { LEARNER_STATUS, STATUS_TONE_CLASSES, type LearnerStatus } from '../../lib/learningStatus'

const ICONS: Record<LearnerStatus, typeof Clock3> = {
  done: CheckCircle2,
  awaiting_review: Clock3,
  redo: RotateCcw,
  in_progress: CircleDot,
  open: CircleDot,
  upcoming: CalendarClock,
  closed: LockKeyhole,
}

export function StatusIcon({ status, className = 'h-4 w-4' }: { status: LearnerStatus; className?: string }) {
  const Icon = ICONS[status]
  return <Icon className={className} aria-hidden="true" />
}

/** A status chip whose wording, colour, and icon all come from one mapping. */
export function StatusBadge({ status, short = false, className = '' }: { status: LearnerStatus; short?: boolean; className?: string }) {
  const meta = LEARNER_STATUS[status]
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${STATUS_TONE_CLASSES[meta.tone]} ${className}`}>
      <StatusIcon status={status} className="h-3.5 w-3.5" />
      {short ? meta.shortLabel : meta.label}
    </span>
  )
}
