// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { StudentPacePanel } from './StudentPacePanel'
import type { PersonalPace } from '../../types/api'

const api = vi.hoisted(() => ({ getPersonalPace: vi.fn(), savePersonalPace: vi.fn() }))
vi.mock('../../lib/api', () => ({ api }))
let host: HTMLDivElement, root: ReturnType<typeof createRoot>
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove(); vi.clearAllMocks() })

const pace: PersonalPace = {
  enrollment_id: 7, available: true, options: [3, 4, 6], weeks: 6, plan_source: 'learner_pace', starts_on: '2026-11-18', start_set_by_staff: false,
  ends_on: '2026-12-29', current_week: 2, status: 'behind', weeks_behind: 1, final_project: null,
  next_milestone: { title: 'Week 1', due_on: '2026-11-24', total: 3, completed: 2, status: 'behind', lessons: [] },
  milestones: [{ title: 'Week 1', due_on: '2026-11-24', total: 3, completed: 2, status: 'behind' }, { title: 'Week 2', due_on: '2026-12-01', total: 2, completed: 0, status: 'current' }],
  can_change: true, changes_left: 1, chosen_by: { id: 3, full_name: 'Rehearsal Learner' }, chosen_at: '2026-11-28T00:00:00Z',
}

function setValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')!.set!
  setter.call(element, value)
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
}
const button = (label: string) => Array.from(host.querySelectorAll('button')).find((item) => item.textContent?.includes(label))!

it('renders nothing for a course without learner-chosen pace', async () => {
  api.getPersonalPace.mockResolvedValue({ data: { personal_pace: null } })
  await act(async () => root.render(<StudentPacePanel enrollmentId={7} onSaved={vi.fn()} />))
  expect(host.innerHTML).toBe('')
})

it('shows the pace, who chose it, the targets and status; staff override the pace and move the start', async () => {
  api.getPersonalPace.mockResolvedValue({ data: { personal_pace: pace } })
  api.savePersonalPace.mockResolvedValue({ data: { personal_pace: { ...pace, weeks: 8, status: 'on_track', weeks_behind: 0 } } })
  const onSaved = vi.fn()
  await act(async () => root.render(<StudentPacePanel enrollmentId={7} onSaved={onSaved} />))
  expect(host.textContent).toContain('6 weeks')
  expect(host.textContent).toContain('Set by Rehearsal Learner')
  expect(host.textContent).toContain('1 learner change left')
  expect(host.textContent).toContain('1 week behind')
  expect(host.textContent).toContain('Week 1 · 2/3')
  expect(button('Change pace').disabled).toBe(true)

  await act(async () => setValue(host.querySelector('select')!, '8'))
  await act(async () => button('Change pace').click())
  expect(api.savePersonalPace).toHaveBeenCalledWith(7, { weeks: 8 })
  expect(onSaved).toHaveBeenCalledTimes(1)
  expect(host.querySelector('[role="status"]')?.textContent).toContain('Pace set to 8 weeks')

  api.savePersonalPace.mockResolvedValue({ data: { personal_pace: { ...pace, starts_on: '2026-11-25', start_set_by_staff: true } } })
  await act(async () => setValue(host.querySelector('input[type="date"]')!, '2026-11-25'))
  await act(async () => button('Save start').click())
  expect(api.savePersonalPace).toHaveBeenLastCalledWith(7, { starts_on: '2026-11-25' })
  expect(host.textContent).toContain('Set by staff')
})
