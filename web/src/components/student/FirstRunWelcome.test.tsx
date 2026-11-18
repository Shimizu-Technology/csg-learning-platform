// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { FirstRunWelcome } from './FirstRunWelcome'
import type { DashboardData, PersonalPace, StudentToday } from '../../types/api'

vi.mock('../../lib/api', () => ({ api: { dismissStartHere: vi.fn() } }))
let host: HTMLDivElement, root: ReturnType<typeof createRoot>
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

const data = { cohort: { id: 4 }, review_response_time: 'usually reviewed within 2 days' } as DashboardData
const today = (personal_pace?: Partial<PersonalPace>, mode = 'program') => ({
  mode, next_lesson: null, reviewer: null, support: { mode: 'guided_help', live_support: false, ends_on: null, ended: false },
  ...(personal_pace ? { personal_pace: { available: true, status: 'not_chosen', ...personal_pace } } : {}),
}) as unknown as StudentToday

async function render(value: StudentToday) {
  await act(async () => root.render(<MemoryRouter><FirstRunWelcome data={data} today={value} lessonPath={null} learnPath="/materials" onDismiss={vi.fn()} /></MemoryRouter>))
}

it('advertises choosing a pace only when the learner can choose one', async () => {
  await render(today({}))
  expect(host.textContent).toContain('Learn at the pace you choose')
  expect(host.textContent).toContain('unless your instructor schedules one later')
  await render(today({ available: false }))
  expect(host.textContent).not.toContain('Learn at the pace you choose')
  await render(today({ status: 'staff_plan' }))
  expect(host.textContent).not.toContain('Learn at the pace you choose')
  await render(today())
  expect(host.textContent).toContain('Follow the class schedule')
})

it('in a self-paced course, describes the pace to choose, a pace kept after pace was turned off, or no deadlines', async () => {
  await render(today({}, 'self_paced'))
  expect(host.textContent).toContain('Learn at the pace you choose')
  await render(today({ available: false, status: 'on_track', plan_source: 'learner_pace', weeks: 4 }, 'self_paced'))
  expect(host.textContent).toContain('Keep to your pace')
  expect(host.textContent).toContain('one firm final-project date')
  expect(host.textContent).not.toContain('no class times or deadlines')
  await render(today(undefined, 'self_paced'))
  expect(host.textContent).toContain('There are no class times or deadlines')
})
