// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ getPrivateMeetings: vi.fn(), createDirectConversation: vi.fn() }))

vi.mock('../../lib/api', () => ({ api: { getPrivateMeetings: state.getPrivateMeetings, createDirectConversation: state.createDirectConversation } }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => vi.fn() }))

import { PrivateMeetings } from './PrivateMeetings'

const DAY = 24 * 60 * 60 * 1000

describe('learner meetings week order', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-20T03:00:00+10:00'))
    const start = '2026-10-10'
    const pastMeeting = Date.parse('2026-10-12T09:00:00+10:00')
    state.getPrivateMeetings.mockResolvedValue({
      data: {
        cohorts: [{
          id: 2, name: 'Python pilot', start_date: start, end_date: null, instructor_id: 3, instructor_name: 'Audit Admin', weeks: 3,
          reschedule_cutoff_hours: 24, max_student_changes: 1, bookable_week_numbers: [2, 3],
          slots: [{ id: 9, starts_at: new Date(Date.now() + 3 * DAY).toISOString(), ends_at: new Date(Date.now() + 3 * DAY + 3600000).toISOString(), available: true, instructor_id: 3, instructor_name: 'Audit Admin' }],
          bookings: [{ id: 1, cohort_id: 2, instructor_name: 'Audit Admin', starts_at: new Date(pastMeeting).toISOString(), ends_at: new Date(pastMeeting + 3600000).toISOString(), zoom_url: 'https://zoom.us/j/1', status: 'confirmed', week_number: 1, reschedule_count: 0 }],
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

  it('opens and highlights the exact past booking from its notification', async () => {
    Element.prototype.scrollIntoView = vi.fn()
    await act(async () => root.render(<MemoryRouter initialEntries={['/meetings?cohort_id=2&booking_id=1&week=1']}><PrivateMeetings /></MemoryRouter>))
    await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)) })
    expect(container.querySelector<HTMLDetailsElement>('[data-testid="past-meeting-weeks"]')!.open).toBe(true)
    expect(container.querySelector('#meeting-2-1')!.className).toContain('ring-2')
  })

  it('shows the current week first and folds finished weeks away', async () => {
    await act(async () => root.render(<MemoryRouter><PrivateMeetings /></MemoryRouter>))
    const headings = Array.from(container.querySelectorAll('h3')).map((h) => h.textContent)
    expect(headings).toEqual(['Week 2', 'Week 3', 'Week 1'])
    const past = container.querySelector<HTMLDetailsElement>('[data-testid="past-meeting-weeks"]')!
    expect(past.open).toBe(false)
    expect(past.textContent).toContain('Week 1')
    expect(past.textContent).toContain('Completed')
    // A finished meeting offers no Join button.
    expect(past.textContent).not.toContain('Join on Zoom')
  })
  it('uses the linked cohort instructor for both page-level message actions', async () => {
    const response = await state.getPrivateMeetings()
    state.getPrivateMeetings.mockResolvedValue({ data: { cohorts: [{ ...response.data.cohorts[0], id: 1, instructor_id: 11 }, { ...response.data.cohorts[0], id: 2, instructor_id: 22 }] } })
    state.createDirectConversation.mockResolvedValue({ data: {} })
    await act(async () => root.render(<MemoryRouter initialEntries={['/meetings?cohort_id=2']}><PrivateMeetings /></MemoryRouter>))
    const actions = Array.from(container.querySelectorAll('button')).filter(button => button.textContent === 'Message your instructor')
    for (const button of [actions[0], actions.at(-1)!]) {
      await act(async () => button.click())
      expect(state.createDirectConversation).toHaveBeenLastCalledWith({ cohort_id: 2, user_ids: [22] })
    }
  })

  it('asks which instructor when an unscoped meeting page has multiple cohorts', async () => {
    const response = await state.getPrivateMeetings()
    state.getPrivateMeetings.mockResolvedValue({ data: { cohorts: [{ ...response.data.cohorts[0], id: 1, instructor_id: 11 }, { ...response.data.cohorts[0], id: 2, instructor_id: 22 }] } })
    state.createDirectConversation.mockClear()
    await act(async () => root.render(<MemoryRouter><PrivateMeetings /></MemoryRouter>))
    await act(async () => (container.querySelector('button')!).click())
    expect(container.querySelector('[aria-label="Choose your course instructor"]')).toBeTruthy()
    expect(state.createDirectConversation).not.toHaveBeenCalled()
  })

})
