// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { Dashboard } from './Dashboard'
const state = vi.hoisted(() => ({ cohortId: 1, user: { id: 7, full_name: 'Learner', is_staff: false }, api: { getDashboard: vi.fn(), getWeeklyPlan: vi.fn(), dismissStartHere: vi.fn() } }))
vi.mock('../../lib/api', () => ({ api: state.api }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: state.user, enrollments: [] }) }))
vi.mock('../../contexts/CohortContext', () => ({ useCohortContext: () => ({ selectedCohortId: state.cohortId }) }))
it('keeps B’s Start here card when A’s dismissal resolves after switching courses', async () => {
  let resolve!: (result: unknown) => void
  state.api.dismissStartHere.mockReturnValue(new Promise(done => { resolve = done }))
  state.api.getWeeklyPlan.mockResolvedValue({ data: { weekly_plan: { enrolled: false } } })
  state.api.getDashboard.mockImplementation(async (id: number) => ({ data: { dashboard: { enrolled: true, start_here: true, user: state.user, cohort: { id, name: `Course ${id}` }, modules: [], action_items: [] } } }))
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  const render = () => act(async () => root.render(<MemoryRouter><Dashboard /></MemoryRouter>))
  try {
    await render()
    await act(async () => [...host.querySelectorAll('button')].find(x => x.textContent === 'Got it, let’s start')!.click())
    state.cohortId = 2; await render()
    expect(host.textContent).toContain('Course 2')
    await act(async () => resolve({ data: { dismissed: true } }))
    expect(state.api.dismissStartHere).toHaveBeenCalledWith(1)
    expect(host.querySelector('#start-here-title')?.textContent).toBe('Start here')
  } finally { act(() => root.unmount()); host.remove(); state.cohortId = 1 }
})
