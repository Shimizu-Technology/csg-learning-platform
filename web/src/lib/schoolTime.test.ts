import { afterEach, expect, it, vi } from 'vitest'
import { schoolDateInputValue, schoolTimeLabel, schoolTimeGenericLabel, schoolTimeDescription, configureSchoolTime, schoolTimeZone, schoolTimeZoneLabel, schoolWallTimeToIso, schoolWeekEndsAt } from './schoolTime'
import { formatShortDateTime } from './format'
import { partitionMeetingWeeks, formatGuamMeetingTime } from './privateMeetings'

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

it('rolls computed Santiago midnight through the gap but rejects typed midnight', () => {
  expect(schoolWallTimeToIso('2026-09-06T00:00', 'America/Santiago')).toBeNull()
  expect(schoolWeekEndsAt('2026-08-30', 1, 'America/Santiago')).toBe(Date.parse('2026-09-06T04:00:00Z'))
})

it('normalizes hour 24 from Intl engines', () => {
  const original = Intl.DateTimeFormat.prototype.formatToParts
  const spy = vi.spyOn(Intl.DateTimeFormat.prototype, 'formatToParts').mockImplementation(function (this: Intl.DateTimeFormat, at) {
    return original.call(this, at).map((part) => part.type === 'hour' && part.value === '00' ? { ...part, value: '24' } : part)
  })
  try {
    expect(schoolWallTimeToIso('2026-01-12T00:00', 'Europe/London')).toBe('2026-01-12T00:00:00.000Z')
  } finally { spy.mockRestore() }
})

it('constructs only one wall formatter per zone over twelve weeks', () => {
  const Original = Intl.DateTimeFormat
  const spy = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (locales, options) {
    return new Original(locales, options)
  } as typeof Intl.DateTimeFormat)
  try {
    for (let week = 1; week <= 12; week++) schoolWeekEndsAt('2026-01-01', week, 'America/Chicago')
    expect(spy).toHaveBeenCalledTimes(1)
    for (let week = 1; week <= 12; week++) schoolWeekEndsAt('2026-01-01', week, 'Pacific/Guam')
    expect(spy).toHaveBeenCalledTimes(1)
  } finally { spy.mockRestore() }
})

it('preserves twelve-week Guam partitions and honors saved config zones', () => {
  expect(partitionMeetingWeeks('2026-01-01', 12, Date.parse('2026-01-22T00:00:00+10:00'))).toEqual({
    current: [4, 5, 6, 7, 8, 9, 10, 11, 12], past: [3, 2, 1],
  })
  expect(partitionMeetingWeeks('2026-01-01', 1, Date.parse('2026-01-08T00:00:00Z'), 'America/New_York')).toEqual({ current: [1], past: [] })
})

it('uses dated DST labels and generic undated labels', () => {
  configureSchoolTime({ time_zone: 'America/New_York', time_zone_label: 'EST' })
  expect(schoolTimeLabel(new Date('2026-07-01T12:00:00Z'))).toBe('EDT')
  expect(schoolTimeLabel(new Date('2026-01-01T12:00:00Z'))).toBe('EST')
  expect(schoolTimeGenericLabel()).toBe('ET')
  expect(schoolTimeDescription()).toBe('ET time')
})


it('round-trips Chicago end-of-day dates with the offset and label on each side of DST', () => {
  configureSchoolTime({ time_zone: 'America/Chicago', time_zone_label: 'CST' })
  const before = schoolWallTimeToIso('2027-03-13T23:59:59')
  const after = schoolWallTimeToIso('2027-03-14T23:59:59')
  expect(before).toBe('2027-03-14T05:59:59.000Z')
  expect(after).toBe('2027-03-15T04:59:59.000Z')
  expect(schoolDateInputValue(before!)).toBe('2027-03-13')
  expect(schoolDateInputValue(after!)).toBe('2027-03-14')
  expect(formatShortDateTime(before)).toBe('Mar 13, 2027, 11:59 PM CST')
  expect(formatShortDateTime(after)).toBe('Mar 14, 2027, 11:59 PM CDT')
})
