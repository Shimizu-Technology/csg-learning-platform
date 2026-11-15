export interface SchoolTimeConfig { time_zone: string; time_zone_label: string }

export let schoolTimeZone = 'Pacific/Guam'
export let schoolTimeZoneLabel = 'ChST'

/** Apply the authoritative session configuration before rendering signed-in pages. */
export function configureSchoolTime(school?: SchoolTimeConfig) {
  schoolTimeZone = school?.time_zone || 'Pacific/Guam'
  schoolTimeZoneLabel = school?.time_zone_label || 'ChST'
}

export function schoolTimeDescription() {
  return schoolTimeZone === 'Pacific/Guam' ? 'Guam time' : `${schoolTimeZone} time`
}

export function schoolTimeLabel(at = new Date()) {
  if (schoolTimeZone === 'Pacific/Guam') return 'ChST'
  return new Intl.DateTimeFormat('en-US', { timeZone: schoolTimeZone, timeZoneName: 'short' })
    .formatToParts(at).find((part) => part.type === 'timeZoneName')?.value || schoolTimeZoneLabel
}

function wallTime(at: number) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: schoolTimeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(at).map((part) => [part.type, part.value]))
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second)
}

/** Convert school wall time, rejecting nonexistent DST times; choose the earlier fold. */
export function schoolWallTimeToIso(value: string): string | null {
  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(value)) {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return null
  const wall = Date.parse(`${value}Z`)
  if (!Number.isFinite(wall) || new Date(wall).toISOString().slice(0, 16) !== value.slice(0, 16)) return null
  // Sample both sides of a transition to find all possible offsets.
  const offsets = [-2, -1, 0, 1, 2].map((day) => {
    const at = wall + day * 86_400_000
    return wallTime(at) - at
  })
  const candidates = offsets.map((offset) => wall - offset).filter((at) => wallTime(at) === wall)
  return candidates.length ? new Date(Math.min(...candidates)).toISOString() : null
}

export function schoolWeekEndsAt(startDate: string, week: number) {
  const day = new Date(Date.parse(`${startDate}T00:00:00Z`) + week * 7 * 86_400_000)
  if (Number.isNaN(day.getTime())) return NaN
  const iso = schoolWallTimeToIso(`${day.toISOString().slice(0, 10)}T00:00:00`)
  return iso ? Date.parse(iso) : NaN
}
