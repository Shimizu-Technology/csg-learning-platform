import type { InterventionOutcome, InterventionSeverity, InterventionStatus, InterventionTrigger } from '../types/api'
import { humanize } from './glossary'

/*
 * Words for the values stored on a follow-up plan (the API's `intervention`)
 * and its return plan (`recovery_plan`). The stored values never change; only
 * what staff read does.
 */

export const FOLLOW_UP_TRIGGER_LABELS: Record<InterventionTrigger, string> = {
  manual: 'Started by staff',
  help_request: 'Help request',
  redo: 'Redo requested',
  ungraded: 'Work waiting for review',
  inactivity: 'No recent activity',
  restart: 'Restarted class progress',
  extended_absence: 'Back after time away',
}

export const FOLLOW_UP_STATUS_LABELS: Record<InterventionStatus, string> = {
  open: 'Open',
  contacted: 'Contacted',
  waiting_on_student: 'Waiting on student',
  monitoring: 'Monitoring',
  resolved: 'Resolved',
  canceled: 'Canceled',
}

export const FOLLOW_UP_SEVERITY_LABELS: Record<InterventionSeverity, string> = {
  normal: 'Normal',
  urgent: 'Urgent',
}

export const FOLLOW_UP_OUTCOME_LABELS: Record<InterventionOutcome, string> = {
  re_engaged: 'Re-engaged',
  plan_completed: 'Plan completed',
  support_resolved: 'Support resolved',
  referred: 'Referred for added support',
  paused: 'Enrollment paused',
  withdrawn: 'Student withdrew',
  no_change: 'No change yet',
}

export const RETURN_PLAN_STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  completed: 'Completed',
  canceled: 'Canceled',
}

/** Snapshot keys saved when a follow-up plan starts, as staff read them. */
const SNAPSHOT_LABELS: Record<string, string> = {
  submission_ids: 'Submissions',
  count: 'Count',
  most_recent_at: 'Most recent',
  category: 'Category',
  urgency: 'Urgency',
  context_type: 'Asked from',
  created_at: 'Asked',
  last_activity_at: 'Last activity',
  inactive_days: 'Days without activity',
  observed_at: 'Checked',
  restarted_at: 'Restarted',
  records_removed: 'Cleared',
  progresses: 'Lesson progress',
  submissions: 'Submissions',
  knowledge_check_attempts: 'Checkpoint attempts',
  watch_progresses: 'Recording progress',
  lesson_assignments: 'Lesson assignments',
}

/** Internal ids in the snapshot: the related panel links these, so they aren't shown as text. */
export const HIDDEN_SNAPSHOT_KEYS = new Set(['help_request_id', 'context_id', 'enrollment_restart_id'])

export function followUpLabel(value: string | null | undefined): string {
  if (!value) return ''
  const maps: Record<string, string>[] = [FOLLOW_UP_TRIGGER_LABELS, FOLLOW_UP_STATUS_LABELS, FOLLOW_UP_SEVERITY_LABELS, FOLLOW_UP_OUTCOME_LABELS, RETURN_PLAN_STATUS_LABELS]
  for (const labels of maps) if (labels[value]) return labels[value]
  return humanize(value)
}

export function snapshotLabel(key: string): string {
  return humanize(key, SNAPSHOT_LABELS)
}
