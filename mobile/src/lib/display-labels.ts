import type { InterventionOutcome, InterventionStatus, InterventionTrigger } from './types';

/*
 * Display names for stored values, so raw enum text never reaches the screen.
 * Follow-up plans are stored as `interventions`; the API, routes and payload
 * keys keep that name. Glossary: redesign README §2.
 */

export const FOLLOW_UP_STATUS_LABELS: Record<InterventionStatus, string> = {
  open: 'Open',
  contacted: 'Contacted',
  waiting_on_student: 'Waiting on student',
  monitoring: 'Monitoring',
  resolved: 'Resolved',
  canceled: 'Canceled',
};

export const FOLLOW_UP_REASON_LABELS: Record<InterventionTrigger, string> = {
  manual: 'Started by staff',
  help_request: 'Help request',
  redo: 'Redo requested',
  ungraded: 'Waiting for review',
  inactivity: 'No recent activity',
  restart: 'Restarted course',
  extended_absence: 'Time away',
};

export const FOLLOW_UP_OUTCOME_LABELS: Record<InterventionOutcome, string> = {
  re_engaged: 'Re-engaged',
  plan_completed: 'Plan complete',
  support_resolved: 'Support resolved',
  referred: 'Referred',
  paused: 'Paused',
  withdrawn: 'Withdrawn',
  no_change: 'No change',
};

/** A stored value as words when no label is defined: "days_inactive" -> "Days inactive". */
export function humanize(value: string | null | undefined, labels: Record<string, string> = {}): string {
  if (!value) return '';
  if (labels[value]) return labels[value];
  const words = value.split(/[_-]+/).join(' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1).toLowerCase() : '';
}

/** Grades as people read them: "R" is stored, "Redo" is shown. */
export function gradeLabel(grade: string | null | undefined): string {
  if (!grade) return '';
  return grade === 'R' ? 'Redo' : grade;
}
