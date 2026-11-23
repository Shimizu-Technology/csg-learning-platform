// @vitest-environment jsdom

import { act } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ meetings: vi.fn(), createSlot: vi.fn() }))

vi.mock('../../lib/api', () => ({
  api: {
    getStaffPrivateMeetings: state.meetings,
    createPrivateMeetingSlot: state.createSlot,
    getCohorts: vi.fn().mockResolvedValue({ data: { cohorts: [] }, error: null }),
    getUsers: vi.fn().mockResolvedValue({ data: { users: [] }, error: null }),
  },
}))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: { id: 3, is_admin: true, full_name: 'Audit Admin' } }) }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => vi.fn() }))

import { StaffPrivateMeetings } from './PrivateMeetings'
import { configureSchoolTime } from '../../lib/schoolTime'

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
            { id: 1, cohort_id: 2, student_id: 41, student_name: 'Maria Santos', instructor_name: 'Audit Admin', starts_at: iso('2026-10-12T09:00:00+10:00'), ends_at: iso('2026-10-12T10:00:00+10:00'), zoom_url: 'https://zoom.us/j/1', status: 'confirmed', week_number: 1, reschedule_count: 0 },
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

  it('keeps the exact profile origin while switching meeting cohorts', async () => {
    const result = await state.meetings()
    result.data.cohorts.push({ ...result.data.cohorts[0], id: 3, name: 'Other course', slots: [], bookings: [] })
    state.meetings.mockResolvedValue(result)
    const origin = '/admin/cohorts/2/students/41/communication?focus=meeting'
    function Location() { const location = useLocation(); return <pre data-location>{JSON.stringify({ search: location.search, state: location.state })}</pre> }
    await act(async () => root.render(<MemoryRouter initialEntries={[{ pathname: '/admin/meetings', search: `?cohort_id=2&booking_id=1&week=1&return_to=${encodeURIComponent(origin)}`, state: { returnTo: origin, returnLabel: 'Maria Santos' } }]}><StaffPrivateMeetings /><Location /></MemoryRouter>))
    await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === 'Other course')!.click())
    const location = JSON.parse(container.querySelector('[data-location]')!.textContent!)
    expect(new URLSearchParams(location.search).get('return_to')).toBe(origin)
    expect(new URLSearchParams(location.search).get('cohort_id')).toBe('3')
    expect(new URLSearchParams(location.search).has('booking_id')).toBe(false)
    expect(location.state.returnTo).toBe(origin)
    expect(container.querySelector(`a[href="${origin}"]`)?.textContent).toBe('Back to Maria Santos')
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
    configureSchoolTime({ time_zone: 'Pacific/Guam', time_zone_label: 'ChST' })
  })

  it('asks the server for the selected student and cohort full meeting list', async () => {
    await act(async () => root.render(<MemoryRouter initialEntries={['/admin/meetings?cohort_id=2&student_id=41']}><StaffPrivateMeetings /></MemoryRouter>))
    expect(state.meetings).toHaveBeenCalledWith({ cohort_id: 2, student_id: 41 })
  })

  it('opens the exact past booking and links its learner with a return context', async () => {
    Element.prototype.scrollIntoView = vi.fn()
    await act(async () => root.render(<MemoryRouter initialEntries={['/admin/meetings?cohort_id=2&booking_id=1&week=1']}><StaffPrivateMeetings /></MemoryRouter>))
    await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)) })
    expect(container.querySelector<HTMLDetailsElement>('[data-testid="staff-past-bookings"]')!.open).toBe(true)
    const link = container.querySelector<HTMLAnchorElement>('#booking-1 h3 a')!
    expect(link.pathname).toBe('/admin/cohorts/2/students/41/overview')
    expect(new URL(link.href).searchParams.get('return_to')).toBe('/admin/meetings?cohort_id=2&booking_id=1&week=1')
  })

  it('lists the current week and upcoming bookings first, with past ones folded away', async () => {
    await act(async () => root.render(<MemoryRouter><StaffPrivateMeetings /></MemoryRouter>))
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

  it('shows clean Central Time (CT) labels and converts published slot wall times in the selected cohort timezone', async () => {
    configureSchoolTime({ time_zone: 'Pacific/Guam', time_zone_label: 'ChST' })
    state.createSlot.mockResolvedValue({ data: { slots: [] }, error: null })
    const result = await state.meetings()
    result.data.cohorts[0].timezone = 'America/Chicago'
    result.data.cohorts[0].slots[1].starts_at = '2026-10-22T15:00:00Z'
    result.data.cohorts[0].bookings[1].starts_at = '2026-10-22T15:00:00Z'
    state.meetings.mockResolvedValue(result)
    await act(async () => root.render(<MemoryRouter><StaffPrivateMeetings /></MemoryRouter>))
    expect(container.textContent).toContain('Start in Central Time (CT)')
    expect(container.textContent).not.toContain('CT time (CT)')
    expect(container.textContent).toContain('10:00 AM CDT')

    const input = container.querySelector<HTMLInputElement>('input[type="datetime-local"]')!
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      valueSetter.call(input, '2026-11-12T10:00')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const form = input.closest('form')!
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    // Nov 12 2026 10:00 AM CST (Chicago, UTC-6) = 2026-11-12T16:00:00.000Z
    expect(state.createSlot).toHaveBeenCalledWith(2, '2026-11-12T16:00:00.000Z', 1)
  })
})

it('keeps an embedded cohort schedule scoped even when the query names another cohort', async () => {
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container)
  state.meetings.mockResolvedValue({ data: { cohorts: [{ id: 99, name: 'Other private cohort', bookings: [], slots: [] }] }, error: null })
  try {
    await act(async () => root.render(<MemoryRouter initialEntries={['/admin/cohorts/2?tab=schedule&cohort_id=99']}><StaffPrivateMeetings cohortId={2} /></MemoryRouter>))
    expect(container.textContent).toContain('Meetings')
    expect(container.textContent).toContain('No meetings in this cohort')
    expect(container.textContent).not.toContain('Other private cohort')
    expect(container.textContent).not.toContain('Publish an available hour')
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/admin/meetings?cohort_id=2')
  } finally { act(() => root.unmount()); container.remove() }
})
