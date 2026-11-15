import { afterEach, expect, it } from 'vitest'
import { configureSchoolTime, schoolTimeZone, schoolTimeZoneLabel, schoolWallTimeToIso, schoolWeekEndsAt } from './schoolTime'
import { formatShortDateTime } from './format'
import { formatGuamMeetingTime } from './privateMeetings'

afterEach(() => configureSchoolTime())

it('defaults to Guam with byte-identical labels and offsets', () => {
  expect(schoolTimeZone).toBe('Pacific/Guam')
  expect(schoolTimeZoneLabel).toBe('ChST')
  expect(schoolWallTimeToIso('2026-10-21T18:00')).toBe('2026-10-21T08:00:00.000Z')
})

it('uses session configuration for formatting and wall-time inputs', () => {
  configureSchoolTime({ time_zone: 'America/New_York', time_zone_label: 'EST' })
  expect(formatShortDateTime('2026-10-21T08:00:00Z')).toBe('Oct 21, 2026, 4:00 AM EDT')
  expect(formatGuamMeetingTime('2026-10-21T08:00:00Z')).toContain('4:00 AM EDT')
  expect(schoolWallTimeToIso('2026-10-21T18:00')).toBe('2026-10-21T22:00:00.000Z')
})

it('uses calendar weeks across DST and rejects missing wall times', () => {
  configureSchoolTime({ time_zone: 'America/New_York', time_zone_label: 'EST' })
  expect(schoolWeekEndsAt('2026-03-02', 1)).toBe(Date.parse('2026-03-09T04:00:00Z'))
  expect(schoolWallTimeToIso('2026-03-08T02:30')).toBeNull()
  expect(schoolWallTimeToIso('2026-11-01T01:30')).toBe('2026-11-01T05:30:00.000Z')
  expect(schoolWallTimeToIso('invalid')).toBeNull()
})
