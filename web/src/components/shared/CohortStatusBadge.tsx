import { Badge, type BadgeTone } from '../ui/Badge'
import { humanize } from '../../lib/glossary'

const COHORT_STATUS_TONES: Record<string, BadgeTone> = {
  active: 'success',
  upcoming: 'info',
  completed: 'neutral',
  archived: 'neutral',
}

const COHORT_STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  upcoming: 'Upcoming',
  completed: 'Completed',
  archived: 'Archived',
}

export function cohortStatusLabel(status: string) {
  return humanize(status, COHORT_STATUS_LABELS)
}

/** Shared cohort lifecycle badge used by cohort lists and the cohort workspace header. */
export function CohortStatusBadge({ status }: { status: string }) {
  return <Badge tone={COHORT_STATUS_TONES[status] ?? 'neutral'}>{cohortStatusLabel(status)}</Badge>
}
