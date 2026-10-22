import type { Href } from 'expo-router';
import type { ActivityEvent } from './types';

export function activityDestination(event: ActivityEvent): Href | null {
  const target = event.destination;
  if (!target || event.event_type === 'account_signed_in') return null;
  const context = { cohort_id: String(target.cohort_id) };
  if (target.kind === 'submission' && target.submission_id) return {
    pathname: '/staff/submission/[id]',
    params: { ...context, id: String(target.submission_id), student_id: String(target.student_id) },
  };
  if (target.kind === 'lesson' && target.lesson_id) return {
    pathname: '/lesson/[id]',
    params: { ...context, id: String(target.lesson_id), block_id: String(target.content_block_id || '') },
  };
  if (target.kind === 'recording' && target.recording_id) return {
    pathname: '/recording/[id]', params: { ...context, id: `recording-${target.recording_id}` },
  };
  return null;
}
