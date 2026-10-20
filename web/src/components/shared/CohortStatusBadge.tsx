import { Badge, type BadgeTone } from '../ui/Badge'

const COHORT_STATUS_TONES: Record<string, BadgeTone> = {
  active: 'success',
  upcoming: 'info',
  completed: 'neutral',
  archived: 'neutral',
}

export function cohortStatusLabel(status: string) {
  const text = status.replaceAll('_', ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** Shared cohort lifecycle badge used by cohort lists and the cohort workspace header. */
export function CohortStatusBadge({ status }: { status: string }) {
  return <Badge tone={COHORT_STATUS_TONES[status] ?? 'neutral'}>{cohortStatusLabel(status)}</Badge>
}
