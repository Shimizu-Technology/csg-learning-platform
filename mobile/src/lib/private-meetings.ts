import { COURSE_TIME_ZONE } from './course-time';
import { safeExternalUrl } from './learning';

export interface PrivateMeetingSlot {
  id: number; starts_at: string; ends_at: string; instructor_id: number; instructor_name: string; available: boolean;
}
export interface PrivateMeetingBooking {
  id: number; cohort_id: number; instructor_name: string; starts_at: string; ends_at: string;
  zoom_url: string | null; status: string; week_number: number; reschedule_count: number;
}
export interface PrivateMeetingCohort {
  id: number; name: string; start_date: string; end_date: string | null;
  instructor_id: number; instructor_name: string; weeks: number;
  reschedule_cutoff_hours: number; max_student_changes: number; bookable_week_numbers: number[];
  slots: PrivateMeetingSlot[]; bookings: PrivateMeetingBooking[];
}
export interface PrivateMeetingsResponse { cohorts: PrivateMeetingCohort[] }
const DAY = 86_400_000;

export function courseWeekEndsAt(startDate: string, week: number) {
  return Date.parse(`${startDate}T00:00:00+10:00`) + week * 7 * DAY;
}
export function courseWeekForSlot(startDate: string, startsAt: string, weeks: number): number | null {
  const date = new Date(startsAt);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: COURSE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).map((p) => [p.type, p.value]));
  const slotDay = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
  const week = Math.floor((slotDay - Date.parse(`${startDate}T00:00:00Z`)) / (7 * DAY)) + 1;
  return week >= 1 && week <= weeks ? week : null;
}
export function partitionMeetingWeeks(startDate: string, weeks: number, now = Date.now()) {
  const all = Array.from({ length: Math.max(0, weeks) }, (_, i) => i + 1);
  return { current: all.filter((w) => courseWeekEndsAt(startDate, w) > now), past: all.filter((w) => courseWeekEndsAt(startDate, w) <= now).reverse() };
}
export function isWeekBookingClosed(cohort: PrivateMeetingCohort, week: number, now = Date.now()) {
  return courseWeekEndsAt(cohort.start_date, week) <= now + cohort.reschedule_cutoff_hours * 3_600_000;
}
export function currentBookingForWeek(bookings: PrivateMeetingBooking[], week: number) {
  return bookings.find((b) => b.week_number === week && !['canceled', 'cancelled'].includes(b.status));
}
export function beforeChangeCutoff(cohort: PrivateMeetingCohort, booking: PrivateMeetingBooking, now = Date.now()) {
  return Date.parse(booking.starts_at) > now + cohort.reschedule_cutoff_hours * 3_600_000;
}
export function canReschedule(cohort: PrivateMeetingCohort, booking: PrivateMeetingBooking, now = Date.now()) {
  return beforeChangeCutoff(cohort, booking, now) && booking.reschedule_count < cohort.max_student_changes;
}
export function availableSlotsForWeek(cohort: PrivateMeetingCohort, week: number, now = Date.now()) {
  return cohort.slots.filter((s) => s.available && Date.parse(s.starts_at) > now + cohort.reschedule_cutoff_hours * 3_600_000 && courseWeekForSlot(cohort.start_date, s.starts_at, cohort.weeks) === week).sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
}
export function cancelConsequence(week: number, changes: number, max: number) {
  if (changes >= max) return `You have already used your schedule change for Week ${week}. If you cancel, you cannot book another time yourself. Message your instructor to arrange another time.`;
  const remaining = max - changes;
  return remaining === 1 ? `Booking a new Week ${week} time after cancelling uses your only schedule change for this week.` : `Booking again after cancelling uses one of your ${remaining} remaining changes for Week ${week}.`;
}
/** Join becomes useful 15 minutes before the hour, and disappears at its end. */
export function meetingJoinUrl(booking: PrivateMeetingBooking, now = Date.now()) {
  return now >= Date.parse(booking.starts_at) - 15 * 60_000 && now < Date.parse(booking.ends_at) ? safeExternalUrl(booking.zoom_url) : null;
}
export function meetingRebookWarning(cohort: PrivateMeetingCohort, week: number) {
  return cohort.bookings.some((b) => b.week_number === week && ['canceled', 'cancelled'].includes(b.status))
    ? 'If you cancelled the previous meeting, booking again uses your schedule change for this week.' : null;
}
