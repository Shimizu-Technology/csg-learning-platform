import type { PrivateMeetingBooking, PrivateMeetingCohort } from './private-meetings';
export const now = Date.parse('2026-12-07T12:00:00+10:00');
export const booking: PrivateMeetingBooking = { id: 4, cohort_id: 2, instructor_name: 'Leon', starts_at: '2026-12-12T12:00:00+10:00', ends_at: '2026-12-12T13:00:00+10:00', zoom_url: 'https://zoom.us/j/123', status: 'confirmed', week_number: 2, reschedule_count: 0 };
export const cohort: PrivateMeetingCohort = { id: 2, name: 'Python Fundamentals', start_date: '2026-11-30', end_date: null, instructor_id: 7, instructor_name: 'Leon', weeks: 3, reschedule_cutoff_hours: 24, max_student_changes: 1, bookable_week_numbers: [2, 3], bookings: [], slots: [
  { id: 12, starts_at: '2026-12-13T13:00:00+10:00', ends_at: '2026-12-13T14:00:00+10:00', instructor_id: 7, instructor_name: 'Leon', available: true },
  { id: 11, starts_at: booking.starts_at, ends_at: booking.ends_at, instructor_id: 7, instructor_name: 'Leon', available: true },
] };
