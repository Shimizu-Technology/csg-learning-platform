import { afterEach, describe, expect, it } from 'vitest'
import { courseWeekForSlot, currentBookingForWeek, formatMeetingTime, partitionMeetingWeeks, slotsForWeek } from './privateMeetings'
import { configureSchoolTime, timeZoneDescriptionWithLabel } from './schoolTime'
import type { PrivateMeetingBooking, PrivateMeetingSlot } from '../types/api'

afterEach(() => {
  configureSchoolTime({ time_zone: 'Pacific/Guam', time_zone_label: 'ChST' })
})

function slot(id: number, startsAt: string): PrivateMeetingSlot {
  return { id, starts_at: startsAt, ends_at: startsAt, instructor_id: 1, instructor_name: 'Leon', available: true }
}

describe('private meeting course weeks', () => {
  it('uses Guam calendar dates across UTC boundaries', () => {
    expect(courseWeekForSlot('2026-10-05', '2026-10-04T14:30:00Z', 3)).toBe(1)
    expect(courseWeekForSlot('2026-10-05', '2026-10-11T14:30:00Z', 3)).toBe(2)
    expect(courseWeekForSlot('2026-10-05', '2026-10-25T14:30:00Z', 3)).toBeNull()
  })

  it('groups and sorts available slots by course week', () => {
    const slots = [slot(2, '2026-10-05T03:00:00Z'), slot(3, '2026-10-11T20:00:00Z'), slot(1, '2026-10-05T01:00:00Z')]
    expect(slotsForWeek(slots, '2026-10-05', 1, 3).map((item) => item.id)).toEqual([1, 2])
    expect(slotsForWeek(slots, '2026-10-05', 2, 3).map((item) => item.id)).toEqual([3])
  })

  it('does not count canceled history as a current booking', () => {
    const booking = { week_number: 1, status: 'canceled' } as PrivateMeetingBooking
    expect(currentBookingForWeek([booking], 1)).toBeUndefined()
  })
})

describe('private meeting copy and cutoffs', () => {
  it('labels times in ChST instead of GMT+10', async () => {
    const { formatGuamMeetingTime } = await import('./privateMeetings')
    const label = formatGuamMeetingTime('2026-10-21T03:00:00Z')
    expect(label).toMatch(/^Wednesday, October 21.*1:00 PM ChST$/)
    expect(label).not.toContain('GMT')
  })

  it('closes a week once its last day is inside the learner cutoff', async () => {
    const { isWeekBookingClosed, isPastLearnerCutoff } = await import('./privateMeetings')
    const now = Date.parse('2026-10-18T07:00:00Z') // Sunday 5 PM in Guam
    expect(isWeekBookingClosed('2026-10-05', 1, 24, now)).toBe(true)
    expect(isWeekBookingClosed('2026-10-05', 2, 24, now)).toBe(true)
    expect(isWeekBookingClosed('2026-10-05', 3, 24, now)).toBe(false)
    expect(isPastLearnerCutoff('2026-10-19T00:00:00Z', 24, now)).toBe(true)
    expect(isPastLearnerCutoff('2026-10-20T00:00:00Z', 24, now)).toBe(false)
  })

  it('warns when cancelling uses or has used the only change', async () => {
    const { cancelConsequence } = await import('./privateMeetings')
    expect(cancelConsequence(2, 0, 1)).toBe('Booking a new Week 2 time after cancelling uses your only schedule change for this week.')
    expect(cancelConsequence(2, 1, 1)).toContain("you won't be able to book another Week 2 time yourself")
    expect(cancelConsequence(2, 0, 3)).toContain('one of your 3 remaining')
  })
})

describe('meeting week order', () => {
  const start = '2026-10-10' // week 1 is Oct 10–16; it ends at Guam midnight as Oct 17 begins
  it('puts the current week first and folds finished weeks away, most recent first', () => {
    const now = Date.parse('2026-10-20T03:00:00+10:00')
    expect(partitionMeetingWeeks(start, 3, now)).toEqual({ current: [2, 3], past: [1] })
  })

  it('keeps a week current until it ends at Guam midnight', () => {
    expect(partitionMeetingWeeks(start, 3, Date.parse('2026-10-16T23:59:00+10:00'))).toEqual({ current: [1, 2, 3], past: [] })
    expect(partitionMeetingWeeks(start, 3, Date.parse('2026-10-17T00:00:00+10:00'))).toEqual({ current: [2, 3], past: [1] })
  })

  it('handles a finished course and an unknown start date', () => {
    expect(partitionMeetingWeeks(start, 3, Date.parse('2026-12-01T00:00:00Z'))).toEqual({ current: [], past: [3, 2, 1] })
    expect(partitionMeetingWeeks('', 2, Date.now())).toEqual({ current: [1, 2], past: [] })
  })
})

describe('cohort timezone overrides and DST boundaries', () => {
  it('formats Chicago cohorts in CST/CDT even on a Guam school and groups local Chicago dates', () => {
    configureSchoolTime({ time_zone: 'Pacific/Guam', time_zone_label: 'ChST' })
    // 2026-11-30T05:30:00Z is Nov 29 11:30 PM CST in Chicago (Week 1) vs Nov 30 3:30 PM ChST in Guam (Week 2)
    expect(courseWeekForSlot('2026-11-23', '2026-11-30T05:30:00Z', 3, 'America/Chicago')).toBe(1)
    expect(courseWeekForSlot('2026-11-23', '2026-11-30T06:00:00Z', 3, 'America/Chicago')).toBe(2)
    expect(formatMeetingTime('2026-11-30T05:30:00Z', 'America/Chicago')).toMatch(/^Sunday, November 29.*11:30 PM CST$/)
    // Summer DST in Chicago: July 15 2026 18:00Z is 1:00 PM CDT
    expect(formatMeetingTime('2026-07-15T18:00:00Z', 'America/Chicago')).toMatch(/^Wednesday, July 15.*1:00 PM CDT$/)
    expect(timeZoneDescriptionWithLabel('America/Chicago')).toBe('Central Time (CT)')
    expect(timeZoneDescriptionWithLabel('America/Chicago')).not.toContain('CT time (CT)')
  })

  it('formats Guam cohorts in ChST even on a Chicago school and falls back cleanly when cohort zone is missing or invalid', () => {
    configureSchoolTime({ time_zone: 'America/Chicago', time_zone_label: 'CST' })
    expect(formatMeetingTime('2026-11-30T05:30:00Z', 'Pacific/Guam')).toMatch(/^Monday, November 30.*3:30 PM ChST$/)
    expect(timeZoneDescriptionWithLabel('Pacific/Guam')).toBe('Guam time (ChST)')
    // Missing or invalid cohort timezone falls back to school default (America/Chicago here)
    expect(formatMeetingTime('2026-11-30T05:30:00Z', undefined)).toMatch(/^Sunday, November 29.*11:30 PM CST$/)
    expect(formatMeetingTime('2026-11-30T05:30:00Z', 'Invalid/Zone')).toMatch(/^Sunday, November 29.*11:30 PM CST$/)
  })
})
