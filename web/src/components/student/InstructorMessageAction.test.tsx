// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { InstructorMessageAction } from './InstructorMessageAction'
const state = vi.hoisted(() => ({ dashboard: vi.fn(), create: vi.fn() }))
vi.mock('../../lib/api', () => ({ api: { getDashboard: state.dashboard, createDirectConversation: state.create } }))
vi.mock('../../contexts/CohortContext', () => ({
  useCohortContext: () => ({ selectedCohortId: 3, selectedCohort: { id: 3, name: 'Python' } }),
}))
function Location() {
  const location = useLocation()
  return (
    <output>
      {location.pathname}
      {location.search}
    </output>
  )
}
it('opens the assigned instructor conversation and gives a named empty state when nobody is assigned', async () => {
  state.dashboard.mockResolvedValue({ data: { dashboard: { support_instructor_id: 9 } } })
  state.create.mockResolvedValue({ data: { direct_conversation: { id: 77, cohort_id: 3 } } })
  const host = document.createElement('div')
  const root = createRoot(host)
  try {
    await act(async () =>
      root.render(
        <MemoryRouter>
          <InstructorMessageAction />
          <Location />
        </MemoryRouter>
      )
    )
    await act(async () => host.querySelector('button')!.click())
    expect(state.create).toHaveBeenLastCalledWith({ cohort_id: 3, user_ids: [9] })
    expect(host.querySelector('output')?.textContent).toBe('/messages/dm/77?cohort_id=3')
    state.dashboard.mockResolvedValue({ data: { dashboard: {} } })
    state.create.mockClear()
    await act(async () => host.querySelector('button')!.click())
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('No instructor is assigned to Python yet')
    expect(state.create).not.toHaveBeenCalled()
  } finally {
    await act(async () => root.unmount())
  }
})
