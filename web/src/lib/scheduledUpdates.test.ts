import { describe, expect, it } from 'vitest'
import { HOUR_OPTIONS, defaultScheduleFields, scheduleFields, scheduleHasPassed, scheduleIso, sendsAbout, sendsAboutLabel } from './scheduledUpdates'

describe('scheduled update times (U-3.6)', () => {
  it('sends at the first hourly run at or after the chosen time', () => {
    expect(sendsAbout('2030-01-14T23:00:00.000Z').toISOString()).toBe('2030-01-14T23:00:00.000Z')
    expect(sendsAbout('2030-01-14T23:00:01.000Z').toISOString()).toBe('2030-01-15T00:00:00.000Z')
    expect(sendsAbout('2030-01-14T23:30:00.000Z').toISOString()).toBe('2030-01-15T00:00:00.000Z')
    expect(sendsAboutLabel('2030-01-14T23:30:00.000Z', 'Pacific/Guam')).toBe('Sends about Jan 15, 2030, 10:00 AM ChST')
  })

  it('converts a Guam day and hour, and back, without the browser zone', () => {
    expect(scheduleIso('2030-01-15', '9', 'Pacific/Guam')).toBe('2030-01-14T23:00:00.000Z')
    expect(scheduleIso('2030-01-15', '0', 'Pacific/Guam')).toBe('2030-01-14T14:00:00.000Z')
    expect(scheduleIso('', '9', 'Pacific/Guam')).toBeNull()
    expect(scheduleFields('2030-01-14T23:00:00.000Z', 'Pacific/Guam')).toEqual({ date: '2030-01-15', hour: '9' })
    // A time between runs opens at the run that will send it.
    expect(scheduleFields('2030-01-14T23:20:00.000Z', 'Pacific/Guam')).toEqual({ date: '2030-01-15', hour: '10' })
  })

  it('rejects an hour that a DST zone skips', () => {
    expect(scheduleIso('2026-03-08', '2', 'America/New_York')).toBeNull()
    expect(scheduleIso('2026-03-08', '3', 'America/New_York')).toBe('2026-03-08T07:00:00.000Z')
  })

  it('suggests tomorrow at 9:00 AM school time and labels every hour', () => {
    // 11 PM Nov 18 in Guam is still Nov 18 in UTC.
    expect(defaultScheduleFields('Pacific/Guam', new Date('2026-11-18T13:00:00Z'))).toEqual({ date: '2026-11-19', hour: '9' })
    expect(HOUR_OPTIONS).toHaveLength(24)
    expect(HOUR_OPTIONS[0].label).toBe('12:00 AM')
    expect(HOUR_OPTIONS[13].label).toBe('1:00 PM')
    expect(scheduleHasPassed('2026-11-18T13:00:00Z', Date.parse('2026-11-18T13:00:00Z'))).toBe(true)
  })
})
