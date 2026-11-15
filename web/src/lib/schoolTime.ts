export interface SchoolTimeConfig { features?: Record<string, boolean>; public_catalog_mode?: string; name?: string; product_name?: string; support_email?: string; site_url?: string; time_zone: string; time_zone_label: string }

export let schoolTimeZone = 'Pacific/Guam'
export let schoolTimeZoneLabel = 'ChST'

/** Apply the authoritative session configuration before rendering signed-in pages. */
export function configureSchoolTime(school?: SchoolTimeConfig) {
  schoolTimeZone = school?.time_zone || 'Pacific/Guam'
  schoolTimeZoneLabel = school?.time_zone_label || 'ChST'
}

export function schoolTimeGenericLabel(zone = schoolTimeZone) {
  if (zone === 'Pacific/Guam') return 'ChST'
  return new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortGeneric' })
    .formatToParts(new Date()).find((part) => part.type === 'timeZoneName')?.value || zone.split('/').pop()!.replaceAll('_', ' ')
}

export function schoolTimeDescription() {
  return schoolTimeZone === 'Pacific/Guam' ? 'Guam time' : `${schoolTimeGenericLabel()} time`
}

export function schoolTimeLabel(at = new Date()) {
  if (schoolTimeZone === 'Pacific/Guam') return 'ChST'
  return new Intl.DateTimeFormat('en-US', { timeZone: schoolTimeZone, timeZoneName: 'short' })
    .formatToParts(at).find((part) => part.type === 'timeZoneName')?.value || schoolTimeZoneLabel
}

// Reuse the expensive Intl formatter on Hermes; Guam has no DST and needs none.
const wallFormatters = new Map<string, Intl.DateTimeFormat>()
const fixedOffsets: Record<string, number> = { 'Pacific/Guam': 10 * 3_600_000, UTC: 0, 'Etc/UTC': 0 }

function wallTime(at: number, zone: string) {
  if (Object.hasOwn(fixedOffsets, zone)) return at + fixedOffsets[zone]
  let formatter = wallFormatters.get(zone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    })
    wallFormatters.set(zone, formatter)
  }
  const parts = Object.fromEntries(formatter.formatToParts(at).map((part) => [part.type, part.value]))
  // Some engines emit 24 even with h23: it denotes midnight on this date.
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second)
}

/** Convert school wall time, rejecting nonexistent DST times; choose the earlier fold. */
export function schoolWallTimeToIso(value: string, zone = schoolTimeZone, rollForward = false): string | null {
  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(value)) {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return null
  const wall = Date.parse(`${value}Z`)
  if (!Number.isFinite(wall) || new Date(wall).toISOString().slice(0, 16) !== value.slice(0, 16)) return null
  if (Object.hasOwn(fixedOffsets, zone)) return new Date(wall - fixedOffsets[zone]).toISOString()
  // Sample both sides of a transition to find all possible offsets.
  const offsets = [-2, -1, 0, 1, 2].map((day) => {
    const at = wall + day * 86_400_000
    return wallTime(at, zone) - at
  })
  const candidates = offsets.map((offset) => wall - offset).filter((at) => wallTime(at, zone) === wall)
  if (candidates.length) return new Date(Math.min(...candidates)).toISOString()
  // Computed calendar boundaries roll through a midnight gap, like Rails zone.local.
  // Staff-typed times keep the strict default and are rejected in a gap.
  if (rollForward) {
    const after = offsets.map((offset) => wall - offset).filter((at) => wallTime(at, zone) > wall)
    if (after.length) return new Date(Math.min(...after)).toISOString()
  }
  return null
}

export function schoolWeekEndsAt(startDate: string, week: number, zone = schoolTimeZone) {
  const day = new Date(Date.parse(`${startDate}T00:00:00Z`) + week * 7 * 86_400_000)
  if (Number.isNaN(day.getTime())) return NaN
  const iso = schoolWallTimeToIso(`${day.toISOString().slice(0, 10)}T00:00:00`, zone, true)
  return iso ? Date.parse(iso) : NaN
}
