import type { InterventionOutcome, InterventionStatus, InterventionTrigger } from './types';

/*
 * Display names for stored values, so raw enum text never reaches the screen.
 * Follow-up plans are stored as `interventions`; the API, routes and payload
 * keys keep that name. Glossary: redesign README §2. The follow-up maps match
 * web word for word: fixtures/follow-up-labels.json, checked by
 * src/lib/__tests__/display-labels.test.ts.
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
  ungraded: 'Work waiting for review',
  inactivity: 'No recent activity',
  restart: 'Restarted class progress',
  extended_absence: 'Back after time away',
};

export const FOLLOW_UP_OUTCOME_LABELS: Record<InterventionOutcome, string> = {
  re_engaged: 'Re-engaged',
  plan_completed: 'Plan completed',
  support_resolved: 'Support resolved',
  referred: 'Referred for added support',
  paused: 'Enrollment paused',
  withdrawn: 'Student withdrew',
  no_change: 'No change yet',
};

/** Account roles (matches web Team). */
export const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  instructor: 'Instructor',
  student: 'Student',
};

/** Enrollment statuses (matches web StudentAccess): a dropped enrollment reads "Withdrawn". */
export const ENROLLMENT_STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  paused: 'Paused',
  dropped: 'Withdrawn',
  completed: 'Completed',
};

/** A stored value as words when no label is defined: "days_inactive" -> "Days inactive". */
export function humanize(value: string | null | undefined, labels: Record<string, string> = {}): string {
  if (!value) return '';
  if (labels[value]) return labels[value];
  const words = value.split(/[_-]+/).join(' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1).toLowerCase() : '';
}

/** Grades as people read them: "R" and "P" are stored, "Redo" and "Pass" are shown. */
export function gradeLabel(grade: string | null | undefined): string {
  if (!grade) return '';
  if (grade === 'R') return 'Redo';
  if (grade === 'P') return 'Pass';
  return grade;
}
