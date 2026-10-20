/**
 * One place for course dates and times. Code School of Guam runs on Guam time,
 * so course times (events, deadlines, meetings, submissions) are shown in
 * Pacific/Guam with the "ChST" label people recognise. Intl's own short name
 * for Guam is "GMT+10", which reads like a different place.
 */
export const COURSE_TIME_ZONE = 'Pacific/Guam'

const ZONE_LABELS: Record<string, string> = {
  'Pacific/Guam': 'ChST',
  'Pacific/Saipan': 'ChST',
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/** "ChST" for Guam; otherwise the platform's short zone name (for example "HST"). */
export function timeZoneLabel(timeZone: string = COURSE_TIME_ZONE, at: Date = new Date()): string {
  if (ZONE_LABELS[timeZone]) return ZONE_LABELS[timeZone]
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
      .formatToParts(at)
      .find((item) => item.type === 'timeZoneName')
    return part?.value || timeZone
  } catch {
    return timeZone
  }
}

function safeZone(timeZone: string | null | undefined) {
  if (!timeZone) return COURSE_TIME_ZONE
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return timeZone
  } catch {
    return COURSE_TIME_ZONE
  }
}

/** "Oct 21, 2026, 6:00 PM ChST" — a course time with its zone. */
export function formatShortDateTime(
  value: string | Date | null | undefined,
  fallback = 'TBD',
  timeZone?: string | null,
): string {
  const date = toDate(value)
  if (!date) return fallback
  const zone = safeZone(timeZone)
  const formatted = date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: zone,
  })
  return `${formatted} ${timeZoneLabel(zone, date)}`
}

/** "6:00 PM ChST" */
export function formatTime(value: string | Date | null | undefined, fallback = 'TBD', timeZone?: string | null): string {
  const date = toDate(value)
  if (!date) return fallback
  const zone = safeZone(timeZone)
  return `${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: zone })} ${timeZoneLabel(zone, date)}`
}

/** "Oct 21, 2026, 6:00 – 7:30 PM ChST", or both full times when the range crosses days. */
export function formatDateTimeRange(
  start: string | Date | null | undefined,
  end: string | Date | null | undefined,
  fallback = 'TBD',
  timeZone?: string | null,
): string {
  const startDate = toDate(start)
  if (!startDate) return fallback
  const endDate = toDate(end)
  if (!endDate) return formatShortDateTime(startDate, fallback, timeZone)
  const zone = safeZone(timeZone)
  const day = (date: Date) => date.toLocaleDateString('en-CA', { timeZone: zone })
  if (day(startDate) !== day(endDate)) {
    return `${formatShortDateTime(startDate, fallback, zone)} – ${formatShortDateTime(endDate, fallback, zone)}`
  }
  const datePart = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: zone })
  const time = (date: Date) => date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: zone })
  return `${datePart}, ${time(startDate)} – ${time(endDate)} ${timeZoneLabel(zone, startDate)}`
}

/**
 * A course calendar date ("Oct 21, 2026"; `withYear: false` gives "Oct 21").
 * Plain "YYYY-MM-DD" values are calendar dates and are never shifted by a
 * time zone; timestamps are shown as their Guam date.
 */
export function formatShortDate(
  value: string | Date | null | undefined,
  fallback = '—',
  { withYear = true, weekday = false, timeZone }: { withYear?: boolean; weekday?: boolean; timeZone?: string | null } = {},
): string {
  if (!value) return fallback
  const dateOnly = typeof value === 'string' && DATE_ONLY.test(value)
  const date = dateOnly ? new Date(`${value}T00:00:00Z`) : toDate(value)
  if (!date || Number.isNaN(date.getTime())) return fallback
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {}),
    ...(weekday ? { weekday: 'short' } : {}),
    timeZone: dateOnly ? 'UTC' : safeZone(timeZone),
  })
}
