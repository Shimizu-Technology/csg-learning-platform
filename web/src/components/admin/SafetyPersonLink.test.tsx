// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SafetyPersonLink } from './SafetyPersonLink'
import { api } from '../../lib/api'
vi.mock('../../lib/api', () => ({ api: { getUser: vi.fn() } }))
let root: Root; let container: HTMLDivElement
beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container) })
afterEach(() => { act(() => root.unmount()); container.remove(); vi.resetAllMocks() })
async function open(role?: string) { await act(async () => root.render(<MemoryRouter><SafetyPersonLink person={{ id: 20, full_name: 'Person', role }} returnTo="/admin/moderation#report-9" /></MemoryRouter>)); await act(async () => container.querySelector('button')?.click()) }
it('offers real enrollment choices with the same safety queue item as return context', async () => {
  vi.mocked(api.getUser).mockResolvedValue({ data: { user: { id: 20, role: 'student' }, enrollments: [{ id: 1, cohort_id: 4, cohort_name: 'Cohort A', status: 'active' }, { id: 2, cohort_id: 8, cohort_name: 'Cohort B', status: 'completed' }] } } as never)
  await open('student')
  const links = Array.from(document.querySelectorAll('[role="dialog"] a'))
  expect(links).toHaveLength(2)
  expect(links[0].getAttribute('href')).toBe('/admin/cohorts/4/students/20/overview?return_to=%2Fadmin%2Fmoderation%23report-9')
  expect(links[1].textContent).toContain('Cohort B')
})
it.each(['admin', 'student'])('does not invent an enrollment for an unenrolled %s', async (role) => {
  vi.mocked(api.getUser).mockResolvedValue({ data: { user: { id: 20, role }, enrollments: [] } } as never)
  await open()
  expect(document.querySelector('[role="dialog"] a')).toBeNull()
  expect(document.body.textContent).toContain('No learner workspace is available.')
})
it('leaves known staff names as text', async () => { await open('instructor'); expect(api.getUser).not.toHaveBeenCalled(); expect(document.querySelector('[role="dialog"]')).toBeNull() })
