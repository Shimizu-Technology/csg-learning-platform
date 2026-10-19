import { describe, expect, it } from 'vitest'
import { courseWeekForSlot, currentBookingForWeek, slotsForWeek } from './privateMeetings'
import type { PrivateMeetingBooking, PrivateMeetingSlot } from '../types/api'

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
