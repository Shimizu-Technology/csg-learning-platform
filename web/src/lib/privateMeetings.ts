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

export function formatGuamMeetingTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Time unavailable'
  return new Intl.DateTimeFormat('en-US', {
    timeZone: MEETING_TIME_ZONE,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date)
}
