// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { InstructorMessageAction } from './InstructorMessageAction'
const state = vi.hoisted(() => ({ dashboard: vi.fn(), directory: vi.fn(), create: vi.fn() }))
vi.mock('../../lib/api', () => ({ api: { getDashboard: state.dashboard, getAvailableDirectUsersForCohort: state.directory, createDirectConversation: state.create } }))
vi.mock('../../contexts/CohortContext', () => ({ useCohortContext: () => ({ selectedCohortId: 3, selectedCohort: { id: 3, name: 'Python' } }) }))
function Location() { const location = useLocation(); return <output>{location.pathname}{location.search}</output> }
async function render() {
  const host = document.createElement('div'); const root = createRoot(host)
  await act(async () => root.render(<MemoryRouter><InstructorMessageAction /><Location /></MemoryRouter>))
  return { host, close: async () => { await act(async () => root.unmount()) } }
}
it('opens the assigned instructor conversation and gives a named empty state when nobody is assigned', async () => {
  const capabilities = { support_mode: 'guided_help', features: { help_requests: true } }
  state.directory.mockResolvedValue({ data: { users: [{ id: 9, full_name: 'Tia Teacher' }] } })
  state.dashboard.mockResolvedValue({ data: { dashboard: { support_instructor_id: 9, capabilities } } })
  state.create.mockResolvedValue({ data: { direct_conversation: { id: 77, cohort_id: 3 } } })
  const page = await render()
  try {
    await act(async () => page.host.querySelector('button')!.click())
    expect(state.create).toHaveBeenLastCalledWith({ cohort_id: 3, user_ids: [9] })
    expect(page.host.querySelector('output')?.textContent).toBe('/messages/dm/77?cohort_id=3')
  } finally { await page.close() }
  state.dashboard.mockResolvedValue({ data: { dashboard: { capabilities } } })
  const empty = await render()
  try {
    expect(empty.host.textContent).toContain('No instructor is assigned to Python yet')
    expect(empty.host.querySelector('button')).toBeNull()
  } finally { await empty.close() }
})
it.each(['blocked', 'none', 'help off'])('offers no Message for %s', async mode => {
  state.directory.mockResolvedValue({ data: { users: mode === 'blocked' ? [] : [{ id: 9, full_name: 'Tia Teacher' }] } })
  state.dashboard.mockResolvedValue({ data: { dashboard: { support_instructor_id: 9, capabilities: { support_mode: mode === 'none' ? 'none' : 'course_question', features: { help_requests: mode !== 'help off' } } } } })
  const page = await render()
  try { expect(page.host.querySelector('button')).toBeNull() } finally { await page.close() }
})
