// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ meetings: vi.fn() }))

vi.mock('../../lib/api', () => ({
  api: {
    getStaffPrivateMeetings: state.meetings,
    getCohorts: vi.fn().mockResolvedValue({ data: { cohorts: [] }, error: null }),
    getUsers: vi.fn().mockResolvedValue({ data: { users: [] }, error: null }),
  },
}))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: { id: 3, is_admin: true, full_name: 'Audit Admin' } }) }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => vi.fn() }))

import { StaffPrivateMeetings } from './PrivateMeetings'

const iso = (value: string) => new Date(value).toISOString()

describe('staff meetings order', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-20T03:00:00+10:00'))
    state.meetings.mockResolvedValue({
      data: {
        cohorts: [{
          id: 2, name: 'Python pilot', start_date: '2026-10-10', end_date: null, instructor_id: 3, instructor_name: 'Audit Admin', weeks: 3,
          reschedule_cutoff_hours: 24, max_student_changes: 1,
          slots: [
            { id: 1, starts_at: iso('2026-10-12T09:00:00+10:00'), ends_at: iso('2026-10-12T10:00:00+10:00'), available: false, instructor_id: 3, instructor_name: 'Audit Admin' },
            { id: 2, starts_at: iso('2026-10-22T09:00:00+10:00'), ends_at: iso('2026-10-22T10:00:00+10:00'), available: false, instructor_id: 3, instructor_name: 'Audit Admin' },
          ],
          bookings: [
            { id: 1, cohort_id: 2, student_name: 'Maria Santos', instructor_name: 'Audit Admin', starts_at: iso('2026-10-12T09:00:00+10:00'), ends_at: iso('2026-10-12T10:00:00+10:00'), zoom_url: 'https://zoom.us/j/1', status: 'confirmed', week_number: 1, reschedule_count: 0 },
            { id: 2, cohort_id: 2, student_name: 'Jose Cruz', instructor_name: 'Audit Admin', starts_at: iso('2026-10-22T09:00:00+10:00'), ends_at: iso('2026-10-22T10:00:00+10:00'), zoom_url: null, status: 'confirmed', week_number: 2, reschedule_count: 0 },
          ],
        }],
      },
      error: null,
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
  })

  it('lists the current week and upcoming bookings first, with past ones folded away', async () => {
    await act(async () => root.render(<StaffPrivateMeetings />))
    const weekHeadings = Array.from(container.querySelectorAll('h3')).map((h) => h.textContent).filter((text) => text?.startsWith('Week'))
    expect(weekHeadings).toEqual(['Week 2', 'Week 3', 'Week 1'])
    const pastWeeks = container.querySelector<HTMLDetailsElement>('[data-testid="staff-past-meeting-weeks"]')!
    expect(pastWeeks.open).toBe(false)
    expect(pastWeeks.textContent).toContain('Week 1')

    const pastBookings = container.querySelector<HTMLDetailsElement>('[data-testid="staff-past-bookings"]')!
    expect(pastBookings.open).toBe(false)
    expect(pastBookings.textContent).toContain('Maria Santos')
    expect(pastBookings.textContent).not.toContain('Save link')
    const upcoming = container.textContent!.indexOf('Jose Cruz')
    expect(upcoming).toBeGreaterThan(-1)
    expect(upcoming).toBeLessThan(container.textContent!.indexOf('Past meetings'))
  })
})
