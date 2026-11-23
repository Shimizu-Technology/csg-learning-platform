import { availableSlotsForWeek, beforeChangeCutoff, cancelConsequence, canReschedule, courseWeekForSlot, currentBookingForWeek, isWeekBookingClosed, meetingJoinUrl, partitionMeetingWeeks } from '../private-meetings';
import { formatCourseTimeRange } from '../course-time';
import { configureSchoolTime, timeZoneDescriptionWithLabel } from '../school-time';
import { now, booking, cohort } from '../meeting-test-fixtures';

afterEach(() => {
  configureSchoolTime({ time_zone: 'Pacific/Guam', time_zone_label: 'ChST' });
});
describe('private meeting rules', () => {
  it('shows current/upcoming first, past weeks most recent first', () => {
    expect(partitionMeetingWeeks(cohort.start_date, 3, now)).toEqual({ current: [2, 3], past: [1] });
    expect(partitionMeetingWeeks(cohort.start_date, 3, Date.parse('2026-12-21T00:00:00+10:00'))).toEqual({ current: [], past: [3, 2, 1] });
  });
  it('assigns course weeks by Guam calendar days, including Sunday UTC crossing into Monday', () => {
    expect(courseWeekForSlot(cohort.start_date, '2026-12-06T13:59:59Z', 3)).toBe(1);
    expect(courseWeekForSlot(cohort.start_date, '2026-12-06T14:00:00Z', 3)).toBe(2);
    expect(courseWeekForSlot(cohort.start_date, 'invalid', 3)).toBeNull();
  });
  it('closes weeks at the cutoff boundary, independently of missing openings', () => {
    const end = Date.parse('2026-12-14T00:00:00+10:00');
    expect(isWeekBookingClosed(cohort, 2, end - 86_400_000 - 1)).toBe(false);
    expect(isWeekBookingClosed(cohort, 2, end - 86_400_000)).toBe(true);
    expect(isWeekBookingClosed(cohort, 2, now)).toBe(false);
  });
  it('filters taken slots, elapsed cutoff, other weeks and sorts openings', () => {
    expect(availableSlotsForWeek(cohort, 2, now).map((s) => s.id)).toEqual([11, 12]);
    expect(availableSlotsForWeek({ ...cohort, slots: cohort.slots.map((s) => ({ ...s, available: s.id !== 11 })) }, 2, now).map((s) => s.id)).toEqual([12]);
    expect(availableSlotsForWeek(cohort, 2, Date.parse('2026-12-12T13:00:00+10:00'))).toEqual([]);
  });
  it('allows cancellation after the only reschedule, but never a second reschedule', () => {
    expect(canReschedule(cohort, booking, now)).toBe(true);
    expect(canReschedule(cohort, { ...booking, reschedule_count: 1 }, now)).toBe(false);
    expect(beforeChangeCutoff(cohort, booking, now)).toBe(true);
    expect(canReschedule(cohort, booking, Date.parse(booking.starts_at) - 86_400_000)).toBe(false);
    expect(cancelConsequence(2, 0, 1)).toContain('only schedule change');
    expect(cancelConsequence(2, 1, 1)).toContain('cannot book another time yourself');
  });
  it('ignores cancelled bookings and never joins past, early or unsafe links', () => {
    expect(currentBookingForWeek([{ ...booking, status: 'canceled' }, booking], 2)).toBe(booking);
    const start = Date.parse(booking.starts_at);
    expect(meetingJoinUrl(booking, start - 900_001)).toBeNull();
    expect(meetingJoinUrl(booking, start - 900_000)).toBe(booking.zoom_url);
    expect(meetingJoinUrl(booking, Date.parse(booking.ends_at))).toBeNull();
    expect(meetingJoinUrl({ ...booking, zoom_url: 'javascript:alert(1)' }, start)).toBeNull();
  });
  it('formats full hour ranges in ChST using the shared helper', () => {
    expect(formatCourseTimeRange(booking.starts_at, booking.ends_at)).toBe('Sat, Dec 12, 12:00 PM – 1:00 PM ChST');
  });
});

describe('course end date', () => {
  it('treats slots after the cohort end date as outside the course, like the API', () => {
    expect(courseWeekForSlot('2026-11-30', '2026-12-19T12:00:00+10:00', 3, '2026-12-19')).toBe(3);
    expect(courseWeekForSlot('2026-11-30', '2026-12-20T12:00:00+10:00', 3, '2026-12-19')).toBeNull();
    const ended = { ...cohort, end_date: '2026-12-12', slots: [{ ...cohort.slots[0], starts_at: '2026-12-13T13:00:00+10:00', ends_at: '2026-12-13T14:00:00+10:00' }] };
    expect(availableSlotsForWeek(ended, 2, now)).toEqual([]);
  });
});

describe('cohort timezone formatting and day boundaries', () => {
  it('formats opposite school/cohort zones, DST transitions, local midnight splits, and clean descriptions', () => {
    configureSchoolTime({ time_zone: 'Pacific/Guam', time_zone_label: 'ChST' });
    // Winter Chicago (CST): 2026-12-12T18:00:00Z -> Sat, Dec 12, 12:00 PM – 1:00 PM CST
    expect(formatCourseTimeRange('2026-12-12T18:00:00Z', '2026-12-12T19:00:00Z', 'TBD', 'America/Chicago')).toBe('Sat, Dec 12, 12:00 PM – 1:00 PM CST');
    // Summer Chicago (CDT): 2026-07-15T18:00:00Z -> Wed, Jul 15, 1:00 PM – 2:00 PM CDT
    expect(formatCourseTimeRange('2026-07-15T18:00:00Z', '2026-07-15T19:00:00Z', 'TBD', 'America/Chicago')).toBe('Wed, Jul 15, 1:00 PM – 2:00 PM CDT');
    // Crosses midnight in Chicago (11:30 PM CST -> 12:30 AM CST next day) even though same afternoon in Guam
    expect(formatCourseTimeRange('2026-12-13T05:30:00Z', '2026-12-13T06:30:00Z', 'TBD', 'America/Chicago')).toBe('Sat, Dec 12, 11:30 PM CST – Sun, Dec 13, 12:30 AM CST');
    expect(timeZoneDescriptionWithLabel('America/Chicago')).toBe('Central Time (CT)');

    // Opposite: Chicago school + Guam cohort
    configureSchoolTime({ time_zone: 'America/Chicago', time_zone_label: 'CST' });
    expect(formatCourseTimeRange('2026-12-12T02:00:00Z', '2026-12-12T03:00:00Z', 'TBD', 'Pacific/Guam')).toBe('Sat, Dec 12, 12:00 PM – 1:00 PM ChST');
    expect(timeZoneDescriptionWithLabel('Pacific/Guam')).toBe('Guam time (ChST)');
    // Missing or invalid cohort timezone falls back to school default (America/Chicago)
    expect(formatCourseTimeRange('2026-12-12T18:00:00Z', '2026-12-12T19:00:00Z', 'TBD', undefined)).toBe('Sat, Dec 12, 12:00 PM – 1:00 PM CST');
    expect(formatCourseTimeRange('2026-12-12T18:00:00Z', '2026-12-12T19:00:00Z', 'TBD', 'Invalid/Zone')).toBe('Sat, Dec 12, 12:00 PM – 1:00 PM CST');
  });
});
