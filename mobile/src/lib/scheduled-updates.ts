import { formatCourseDateTime } from './course-time';
import type { Announcement } from './types';

const HOUR = 3_600_000;

/** A draft waiting for the hourly tick to post it (U-3.6). Scheduling itself is on the web. */
export function isScheduledUpdate(item: Pick<Announcement, 'status' | 'scheduled_for'>) {
  return item.status === 'draft' && Boolean(item.scheduled_for);
}

/** The tick runs hourly, on the hour, so an update sends at the first whole hour at or after its time. */
export function sendsAbout(scheduledFor: string) {
  return new Date(Math.ceil(new Date(scheduledFor).getTime() / HOUR) * HOUR);
}

/** "Sends about Jan 15, 2030, 9:00 AM ChST". */
export function sendsAboutLabel(scheduledFor: string, timeZone?: string | null) {
  return `Sends about ${formatCourseDateTime(sendsAbout(scheduledFor), { withYear: true, timeZone })}`;
}
