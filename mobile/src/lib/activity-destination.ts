import type { Href } from 'expo-router';
import type { ActivityEvent } from './types';
import { mobileNotificationPath } from './notification-path';

export function activityDestination(event: ActivityEvent): Href | null {
  const target = event.destination;
  if (!target || event.event_type === 'account_signed_in') return null;
  const context = { cohort_id: String(target.cohort_id) };
  if (target.kind === 'submission' && target.submission_id) return {
    pathname: '/staff/submission/[id]',
    params: { ...context, id: String(target.submission_id), student_id: String(target.student_id) },
  };
  if ((target.kind === 'lesson' || target.kind === 'recording') && target.destination_path) {
    const path = mobileNotificationPath(target.destination_path);
    return path === '/updates' ? null : path as Href;
  }
  return null;
}
