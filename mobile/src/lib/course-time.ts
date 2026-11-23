import { resolveTimeZone, schoolTimeLabel } from './school-time';
export { schoolTimeZone as COURSE_TIME_ZONE, schoolTimeZoneLabel as COURSE_TIME_ZONE_LABEL } from './school-time';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function format(date: Date, options: Intl.DateTimeFormatOptions, timeZone: string) {
  return new Intl.DateTimeFormat('en-US', { ...options, timeZone }).format(date);
}

/** "Oct 21, 6:00 PM ChST" (add `withYear` for "Oct 21, 2026, 6:00 PM ChST"). */
export function formatCourseDateTime(value: string | Date | null | undefined, { fallback = 'TBD', withYear = false, weekday = false, timeZone }: { fallback?: string; withYear?: boolean; weekday?: boolean; timeZone?: string | null } = {}) {
  const date = toDate(value);
  if (!date) return fallback;
  const zone = resolveTimeZone(timeZone);
  const formatted = format(date, {
    ...(weekday ? { weekday: 'short' } : {}),
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {}),
    hour: 'numeric',
    minute: '2-digit',
  }, zone);
  return `${formatted} ${schoolTimeLabel(date, zone)}`;
}

/** "Wed 6:00 PM ChST" — a time this week. */
export function formatCourseWeekdayTime(value: string | Date | null | undefined, fallback = 'TBD', timeZone?: string | null) {
  const date = toDate(value);
  if (!date) return fallback;
  const zone = resolveTimeZone(timeZone);
  return `${format(date, { weekday: 'short', hour: 'numeric', minute: '2-digit' }, zone)} ${schoolTimeLabel(date, zone)}`;
}

/** "6:00 PM ChST" */
export function formatCourseTime(value: string | Date | null | undefined, fallback = 'TBD', timeZone?: string | null) {
  const date = toDate(value);
  if (!date) return fallback;
  const zone = resolveTimeZone(timeZone);
  return `${format(date, { hour: 'numeric', minute: '2-digit' }, zone)} ${schoolTimeLabel(date, zone)}`;
}

/** "Wed, Oct 21, 6:00 – 7:30 PM ChST", or two full times across a day or offset change. */
export function formatCourseTimeRange(start: string | Date | null | undefined, end: string | Date | null | undefined, fallback = 'TBD', timeZone?: string | null) {
  const startDate = toDate(start);
  if (!startDate) return fallback;
  const zone = resolveTimeZone(timeZone);
  const endDate = toDate(end);
  if (!endDate) return formatCourseDateTime(startDate, { fallback, weekday: true, timeZone: zone });
  const day = (date: Date) => format(date, { year: 'numeric', month: '2-digit', day: '2-digit' }, zone);
  const startLabel = schoolTimeLabel(startDate, zone);
  if (day(startDate) !== day(endDate) || startLabel !== schoolTimeLabel(endDate, zone)) return `${formatCourseDateTime(startDate, { weekday: true, timeZone: zone })} – ${formatCourseDateTime(endDate, { weekday: true, timeZone: zone })}`;
  const time = (date: Date) => format(date, { hour: 'numeric', minute: '2-digit' }, zone);
  return `${format(startDate, { weekday: 'short', month: 'short', day: 'numeric' }, zone)}, ${time(startDate)} – ${time(endDate)} ${startLabel}`;
}

/**
 * A course calendar date ("Wed, Oct 21"). Plain "YYYY-MM-DD" values are
 * calendar dates and are never shifted by a time zone; timestamps are shown
 * as their school or cohort date.
 */
export function formatCourseDate(value: string | Date | null | undefined, { fallback = '—', withYear = false, weekday = false, timeZone }: { fallback?: string; withYear?: boolean; weekday?: boolean; timeZone?: string | null } = {}) {
  if (!value) return fallback;
  const dateOnly = typeof value === 'string' && DATE_ONLY.test(value);
  const date = dateOnly ? new Date(`${value}T00:00:00Z`) : toDate(value);
  if (!date || Number.isNaN(date.getTime())) return fallback;
  // Reject impossible calendar dates such as 2026-02-31 instead of rolling them over.
  if (dateOnly && date.toISOString().slice(0, 10) !== value) return fallback;
  return format(date, {
    ...(weekday ? { weekday: 'short' } : {}),
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {}),
  }, dateOnly ? 'UTC' : resolveTimeZone(timeZone));
}

