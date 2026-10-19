import { CheckCircle2, Circle, CircleDot, Clock3, LockKeyhole, RotateCcw, CalendarClock } from 'lucide-react'
import { LEARNER_STATUS, type LearnerStatus } from '../../lib/learningStatus'
import { Badge, type BadgeTone } from '../ui/Badge'

const ICONS: Record<LearnerStatus, typeof Clock3> = {
  done: CheckCircle2,
  awaiting_review: Clock3,
  redo: RotateCcw,
  in_progress: CircleDot,
  // Open work is a neutral empty circle, not an alert.
  open: Circle,
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
  const tone: BadgeTone = meta.tone === 'quiet' ? 'neutral' : meta.tone
  return (
    <Badge tone={tone} icon={<StatusIcon status={status} className="h-3.5 w-3.5" />} className={className}>
      {short ? meta.shortLabel : meta.label}
    </Badge>
  )
}
