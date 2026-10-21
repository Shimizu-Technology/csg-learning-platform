/**
 * One place for course dates and times. Code School of Guam runs on Guam
 * time, so course times (lessons, deadlines, live sessions, meetings,
 * notifications) are shown in Pacific/Guam with the "ChST" label people
 * recognise, whatever time zone the phone is set to. Intl's own short name
 * for Guam is "GMT+10", which reads like a different place. Mirrors the web
 * app's `lib/format.ts`.
 */
export const COURSE_TIME_ZONE = 'Pacific/Guam';
export const COURSE_TIME_ZONE_LABEL = 'ChST';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function format(date: Date, options: Intl.DateTimeFormatOptions, timeZone = COURSE_TIME_ZONE) {
  return new Intl.DateTimeFormat('en-US', { ...options, timeZone }).format(date);
}

/** "Oct 21, 6:00 PM ChST" (add `withYear` for "Oct 21, 2026, 6:00 PM ChST"). */
export function formatCourseDateTime(value: string | Date | null | undefined, { fallback = 'TBD', withYear = false, weekday = false }: { fallback?: string; withYear?: boolean; weekday?: boolean } = {}) {
  const date = toDate(value);
  if (!date) return fallback;
  const formatted = format(date, {
    ...(weekday ? { weekday: 'short' } : {}),
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {}),
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${formatted} ${COURSE_TIME_ZONE_LABEL}`;
}

/** "Wed 6:00 PM ChST" — a time this week. */
export function formatCourseWeekdayTime(value: string | Date | null | undefined, fallback = 'TBD') {
  const date = toDate(value);
  if (!date) return fallback;
  return `${format(date, { weekday: 'short', hour: 'numeric', minute: '2-digit' })} ${COURSE_TIME_ZONE_LABEL}`;
}

/** "6:00 PM ChST" */
export function formatCourseTime(value: string | Date | null | undefined, fallback = 'TBD') {
  const date = toDate(value);
  if (!date) return fallback;
  return `${format(date, { hour: 'numeric', minute: '2-digit' })} ${COURSE_TIME_ZONE_LABEL}`;
}

/** "Wed, Oct 21, 6:00 – 7:30 PM ChST", or two full times when the range crosses days. */
export function formatCourseTimeRange(start: string | Date | null | undefined, end: string | Date | null | undefined, fallback = 'TBD') {
  const startDate = toDate(start);
  if (!startDate) return fallback;
  const endDate = toDate(end);
  if (!endDate) return formatCourseDateTime(startDate, { fallback, weekday: true });
  const day = (date: Date) => format(date, { year: 'numeric', month: '2-digit', day: '2-digit' });
  if (day(startDate) !== day(endDate)) return `${formatCourseDateTime(startDate, { weekday: true })} – ${formatCourseDateTime(endDate, { weekday: true })}`;
  const time = (date: Date) => format(date, { hour: 'numeric', minute: '2-digit' });
  return `${format(startDate, { weekday: 'short', month: 'short', day: 'numeric' })}, ${time(startDate)} – ${time(endDate)} ${COURSE_TIME_ZONE_LABEL}`;
}

/**
 * A course calendar date ("Wed, Oct 21"). Plain "YYYY-MM-DD" values are
 * calendar dates and are never shifted by a time zone; timestamps are shown
 * as their Guam date.
 */
export function formatCourseDate(value: string | Date | null | undefined, { fallback = '—', withYear = false, weekday = false }: { fallback?: string; withYear?: boolean; weekday?: boolean } = {}) {
  if (!value) return fallback;
  const dateOnly = typeof value === 'string' && DATE_ONLY.test(value);
  const date = dateOnly ? new Date(`${value}T00:00:00Z`) : toDate(value);
  if (!date || Number.isNaN(date.getTime())) return fallback;
  return format(date, {
    ...(weekday ? { weekday: 'short' } : {}),
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {}),
  }, dateOnly ? 'UTC' : COURSE_TIME_ZONE);
}

