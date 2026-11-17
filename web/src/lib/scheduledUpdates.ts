import { toDateTimeInputValueInTimeZone } from './dateTime'
import { formatShortDateTime } from './format'
import { schoolTimeZone, schoolWallTimeToIso } from './schoolTime'

const HOUR = 3_600_000

/**
 * When a scheduled update actually goes out (U-3.6). The scheduled tick runs
 * once an hour, on the hour (UTC), and posts what is due, so an update sends
 * at the first whole hour at or after its time. The cron can start a few
 * minutes late, so callers say "about".
 */
export function sendsAbout(scheduledFor: string | Date): Date {
  const at = new Date(scheduledFor).getTime()
  return new Date(Math.ceil(at / HOUR) * HOUR)
}

/** "Sends about Nov 20, 2026, 9:00 AM ChST". */
export function sendsAboutLabel(scheduledFor: string, timeZone?: string | null) {
  return `Sends about ${formatShortDateTime(sendsAbout(scheduledFor), '', timeZone || schoolTimeZone)}`
}

/** A send time as the composer's date and hour fields, in the school's zone. */
export function scheduleFields(scheduledFor: string, timeZone = schoolTimeZone): { date: string; hour: string } {
  const local = toDateTimeInputValueInTimeZone(sendsAbout(scheduledFor).toISOString(), timeZone)
  return { date: local.slice(0, 10), hour: String(Number(local.slice(11, 13))) }
}

/** Tomorrow at 9:00 AM school time, the composer's first suggestion. */
export function defaultScheduleFields(timeZone = schoolTimeZone, now = new Date()): { date: string; hour: string } {
  const tomorrow = toDateTimeInputValueInTimeZone(new Date(now.getTime() + 24 * HOUR).toISOString(), timeZone)
  return { date: tomorrow.slice(0, 10), hour: '9' }
}

/** Today's date in the school's zone, the earliest the date field allows. */
export function schoolToday(timeZone = schoolTimeZone, now = new Date()) {
  return toDateTimeInputValueInTimeZone(now.toISOString(), timeZone).slice(0, 10)
}

/** The ISO time for a date and hour in the school's zone, or null when it doesn't exist there. */
export function scheduleIso(date: string, hour: string, timeZone = schoolTimeZone): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}$/.test(hour)) return null
  return schoolWallTimeToIso(`${date}T${hour.padStart(2, '0')}:00`, timeZone)
}

/** "12:00 AM" … "11:00 PM": scheduling is to the hour, since that is when the tick runs. */
export const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => ({
  value: String(hour),
  label: `${hour % 12 === 0 ? 12 : hour % 12}:00 ${hour < 12 ? 'AM' : 'PM'}`,
}))

/** Whether a send time has already passed (checked when the poster submits). */
export function scheduleHasPassed(iso: string, now = Date.now()) {
  return Date.parse(iso) <= now
}
