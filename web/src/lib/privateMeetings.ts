import type { PrivateMeetingBooking, PrivateMeetingSlot } from '../types/api'

export const MEETING_TIME_ZONE = 'Pacific/Guam'

function calendarDayInGuam(value: string): number | null {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MEETING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return Date.UTC(Number(fields.year), Number(fields.month) - 1, Number(fields.day))
}

export function courseWeekForSlot(startDate: string, startsAt: string, weeks: number): number | null {
  const start = Date.parse(`${startDate}T00:00:00Z`)
  const slotDay = calendarDayInGuam(startsAt)
  if (Number.isNaN(start) || slotDay === null) return null
  const week = Math.floor((slotDay - start) / (7 * 24 * 60 * 60 * 1000)) + 1
  return week >= 1 && week <= weeks ? week : null
}

export function slotsForWeek(slots: PrivateMeetingSlot[], startDate: string, week: number, weeks: number) {
  return slots
    .filter((slot) => courseWeekForSlot(startDate, slot.starts_at, weeks) === week)
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
}

export function currentBookingForWeek(bookings: PrivateMeetingBooking[], week: number) {
  return bookings.find((booking) => booking.week_number === week && !['canceled', 'cancelled'].includes(booking.status))
}

/** Guam is UTC+10 all year; "ChST" is the name learners recognize (not "GMT+10"). */
export function formatGuamMeetingTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Time unavailable'
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: MEETING_TIME_ZONE,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
  return `${formatted} ChST`
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Start of the day after a course week ends, as epoch ms (Guam midnight). */
export function courseWeekEndsAt(startDate: string, week: number): number {
  return Date.parse(`${startDate}T00:00:00+10:00`) + week * 7 * DAY_MS
}

/** Learners can only book or change a time more than the cutoff ahead of it. */
export function isPastLearnerCutoff(startsAt: string, cutoffHours: number, now = Date.now()): boolean {
  return Date.parse(startsAt) <= now + cutoffHours * 60 * 60 * 1000
}

/** True when no time in this course week can still be booked by a learner. */
export function isWeekBookingClosed(startDate: string, week: number, cutoffHours: number, now = Date.now()): boolean {
  return courseWeekEndsAt(startDate, week) <= now + cutoffHours * 60 * 60 * 1000
}

/**
 * What cancelling costs the learner. Rebooking after a learner cancellation
 * uses one learner change; once changes are used up, they cannot rebook.
 */
export function cancelConsequence(week: number, changesUsed: number, maxChanges: number): string {
  if (changesUsed >= maxChanges) {
    return `You have already used your schedule change for Week ${week}. If you cancel, you won't be able to book another Week ${week} time yourself — you'll need to message your instructor.`
  }
  const remaining = maxChanges - changesUsed
  return remaining === 1
    ? `Booking a new Week ${week} time after cancelling uses your only schedule change for this week.`
    : `Booking a new Week ${week} time after cancelling uses one of your ${remaining} remaining schedule changes.`
}

/**
 * Splits course weeks into the ones still ahead (the current week and later,
 * in order) and the ones that are over, most recent first. Pages show the
 * current week first and fold past weeks away.
 */
export function partitionMeetingWeeks(startDate: string, weeks: number, now = Date.now()): { current: number[]; past: number[] } {
  const all = Array.from({ length: Math.max(0, weeks) }, (_, index) => index + 1)
  const isPast = (week: number) => {
    const end = courseWeekEndsAt(startDate, week)
    return !Number.isNaN(end) && end <= now
  }
  return { current: all.filter((week) => !isPast(week)), past: all.filter(isPast).reverse() }
}
