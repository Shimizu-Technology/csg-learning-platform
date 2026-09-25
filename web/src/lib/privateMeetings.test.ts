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
