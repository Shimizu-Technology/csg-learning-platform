// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PersonalPaceCard, paceEndDate } from './PersonalPaceCard'
import type { PersonalPace } from '../../types/api'

const api = vi.hoisted(() => ({ savePersonalPace: vi.fn() }))
vi.mock('../../lib/api', () => ({ api }))
let host: HTMLDivElement, root: ReturnType<typeof createRoot>
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove(); vi.clearAllMocks() })

const base: PersonalPace = {
  enrollment_id: 41, available: true, options: [3, 4, 6], weeks: null, plan_source: null, starts_on: '2026-11-18', start_set_by_staff: false,
  ends_on: null, current_week: null, status: 'not_chosen', weeks_behind: 0, final_project: null, next_milestone: null, milestones: [],
  can_change: true, changes_left: 2, chosen_by: null, chosen_at: null,
}
const chosen: PersonalPace = {
  ...base, weeks: 4, plan_source: 'learner_pace', ends_on: '2026-12-15', current_week: 1, status: 'on_track',
  final_project: { lesson_id: 9, title: 'Final project', due_on: '2026-12-15', status: 'open' },
  next_milestone: { title: 'Week 1', due_on: '2026-11-24', total: 3, completed: 1, status: 'current', lessons: [
    { id: 1, title: 'Variables', kind: 'exercise', status: 'done', available: true },
    { id: 2, title: 'Strings', kind: 'exercise', status: 'open', available: true },
    { id: 3, title: 'Lists', kind: 'exercise', status: 'redo', available: true },
  ] },
  milestones: [{ title: 'Week 1', due_on: '2026-11-24', total: 3, completed: 1, status: 'current' }],
}

async function render(pace: PersonalPace, extra: Partial<Parameters<typeof PersonalPaceCard>[0]> = {}) {
  const onSaved = vi.fn()
  await act(async () => root.render(<MemoryRouter><PersonalPaceCard pace={pace} totalLessons={13} lessonPath={(id) => `/lessons/${id}`} onSaved={onSaved} {...extra} /></MemoryRouter>))
  return onSaved
}
const button = (label: string) => Array.from(host.querySelectorAll('button')).find((item) => item.textContent?.includes(label))!

it('counts a pace end from the start: start + 7 weeks - 1 day', () => {
  expect(paceEndDate('2026-11-18', 4)).toBe('2026-12-15')
  expect(paceEndDate('2026-12-30', 1)).toBe('2027-01-05')
})

it('asks a learner without a pace to pick one, says what each means, and saves only a choice', async () => {
  api.savePersonalPace.mockResolvedValue({ data: { personal_pace: chosen } })
  const onSaved = await render(base)
  expect(host.textContent).toContain('How fast do you want to go?')
  expect(host.textContent).toContain('only the final project has a firm date')
  const radios = Array.from(host.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
  expect(radios.map((radio) => radio.value)).toEqual(['3', '4', '6'])
  expect(host.textContent).toContain('About 5 lessons a week · done by Dec 8')
  expect(button('Set my pace').disabled).toBe(true)
  await act(async () => radios[1].click())
  await act(async () => button('Set my pace').click())
  expect(api.savePersonalPace).toHaveBeenCalledWith(41, { weeks: 4 })
  expect(onSaved).toHaveBeenCalledWith(chosen)
})

it('keeps the choice and explains a failed save', async () => {
  api.savePersonalPace.mockResolvedValue({ error: 'Offline' })
  const onSaved = await render(base)
  await act(async () => host.querySelectorAll<HTMLInputElement>('input[type="radio"]')[0].click())
  await act(async () => button('Set my pace').click())
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('Offline')
  expect(onSaved).not.toHaveBeenCalled()
  expect(host.querySelectorAll<HTMLInputElement>('input[type="radio"]')[0].checked).toBe(true)
})

it('shows the next target, how the learner is doing and the firm final date, and lets them change pace', async () => {
  await render(chosen)
  expect(host.textContent).toContain('Your pace · 4 weeks · week 1 of 4')
  expect(host.textContent).toContain('On track')
  expect(host.textContent).toContain('Week 1: 1 of 3 done')
  expect(host.textContent).toContain('Final project due')
  expect(host.textContent).toContain('firm date')
  expect(host.querySelectorAll('[data-pace-lessons] a')).toHaveLength(3)
  expect(host.textContent).toContain('Redo')
  await act(async () => button('Change pace').click())
  expect(button('Keep my pace').getAttribute('aria-expanded')).toBe('true')
  expect(host.textContent).toContain('You can change your pace 2 more times.')
})

it('says how far behind, and offers to ask the instructor once changes run out', async () => {
  const onAsk = vi.fn()
  await render({ ...chosen, status: 'behind', weeks_behind: 1, can_change: false, changes_left: 0, next_milestone: { ...chosen.next_milestone!, status: 'behind' } }, { contactName: 'Leon', onAsk })
  expect(host.textContent).toContain('1 week behind')
  expect(host.textContent).toContain('Target was')
  expect(button('Change pace')).toBeUndefined()
  await act(async () => button('Ask Leon to change your pace').click())
  expect(onAsk).toHaveBeenCalled()
})

it('hides itself for a staff plan or when plans are off', async () => {
  await render({ ...chosen, status: 'staff_plan', plan_source: 'staff' })
  expect(host.innerHTML).toBe('')
  await render({ ...base, available: false })
  expect(host.innerHTML).toBe('')
})
