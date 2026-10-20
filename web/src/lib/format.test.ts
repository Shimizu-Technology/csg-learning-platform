import { describe, expect, it } from 'vitest'
import { formatDateTimeRange, formatShortDate, formatShortDateTime, formatTime, timeZoneLabel } from './format'

// 2026-10-21 08:00 UTC = 2026-10-21 18:00 in Guam (UTC+10, no daylight saving).
const EVENT = '2026-10-21T08:00:00.000Z'

describe('course time formatting', () => {
  it('labels Guam times ChST, never GMT+10', () => {
    const text = formatShortDateTime(EVENT, 'TBD', 'Pacific/Guam')
    expect(text).toBe('Oct 21, 2026, 6:00 PM ChST')
    expect(text).not.toMatch(/GMT/)
  })

  it('defaults to Guam time regardless of the device zone', () => {
    expect(formatShortDateTime(EVENT)).toBe('Oct 21, 2026, 6:00 PM ChST')
    expect(formatShortDateTime(EVENT, 'TBD', null)).toBe('Oct 21, 2026, 6:00 PM ChST')
  })

  it('keeps an explicit non-Guam zone with its own short label', () => {
    expect(formatShortDateTime(EVENT, 'TBD', 'Pacific/Honolulu')).toBe('Oct 20, 2026, 10:00 PM HST')
  })

  it('falls back to Guam for an unknown zone name', () => {
    expect(formatShortDateTime(EVENT, 'TBD', 'Mars/Olympus')).toBe('Oct 21, 2026, 6:00 PM ChST')
  })

  it('returns the fallback for empty or invalid values', () => {
    expect(formatShortDateTime(null, 'Not scheduled')).toBe('Not scheduled')
    expect(formatShortDateTime('nope', 'Not scheduled')).toBe('Not scheduled')
  })

  it('formats times and same-day ranges once with the zone', () => {
    expect(formatTime(EVENT)).toBe('6:00 PM ChST')
    expect(formatDateTimeRange(EVENT, '2026-10-21T09:30:00.000Z')).toBe('Oct 21, 2026, 6:00 PM – 7:30 PM ChST')
  })

  it('shows both full times when a range crosses midnight in Guam', () => {
    expect(formatDateTimeRange(EVENT, '2026-10-21T15:00:00.000Z')).toBe('Oct 21, 2026, 6:00 PM ChST – Oct 22, 2026, 1:00 AM ChST')
  })

  it('never shifts a calendar date', () => {
    expect(formatShortDate('2026-03-02')).toBe('Mar 2, 2026')
    expect(formatShortDate('2026-03-02', '—', { withYear: false })).toBe('Mar 2')
    // 15:30 UTC on Oct 20 is already Oct 21 in Guam.
    expect(formatShortDate('2026-10-20T15:30:00Z')).toBe('Oct 21, 2026')
    expect(formatShortDate(null)).toBe('—')
  })

  it('names Guam ChST', () => {
    expect(timeZoneLabel('Pacific/Guam')).toBe('ChST')
    expect(timeZoneLabel()).toBe('ChST')
  })
})
