// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api } from '../../lib/api'
import { AdminDashboard } from './AdminDashboard'

vi.mock('../../contexts/CohortContext', () => ({ useCohortContext: () => ({ cohorts: [{ id: 3, name: 'Cohort 3' }] }) }))
vi.mock('../../components/admin/MessageStudentsDialog', () => ({ useMessageStudent: () => ({ open: vi.fn(), opening: null }) }))

const today = {
  items: [{ id: 7, kind: 'review', urgent: false, student_record: true, user_id: 5, full_name: 'Alex Example', cohort_id: 3, cohort_name: 'Cohort 3', text: 'Try loops', since: '2026-11-16T01:00:00Z', action_label: 'Open grading', web_path: '/admin/grading?cohort_id=3&submission=7', native_path: '/staff/submission/7' }],
  counts: { review: 2 },
  attention_remaining: 0,
  upcoming: [],
}
let container: HTMLDivElement
let root: Root
beforeEach(() => {
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  vi.spyOn(api, 'getDashboard').mockResolvedValue({ data: { dashboard: { cohorts: [], today } }, error: null } as never)
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks() })

async function render(path: string) {
  const router = createMemoryRouter([{ path: '/admin', element: <AdminDashboard /> }, { path: '*', element: <p>Elsewhere</p> }], { initialEntries: [path] })
  await act(async () => root.render(<RouterProvider router={router} />))
  await act(async () => { await Promise.resolve() })
  return router
}
const link = (text: string) => [...container.querySelectorAll('a')].find((item) => item.textContent?.includes(text))!

it('sends Waiting for review straight to the Grading workbench, keeping the cohort and a way back', async () => {
  await render('/admin?cohort_id=3')
  expect(link('Waiting for review').getAttribute('href')).toBe('/admin/grading?cohort_id=3&return_to=%2Fadmin%3Fcohort_id%3D3')
  // Open grading opens that attempt in the workbench queue, not the single-record page.
  expect(link('Open grading').getAttribute('href')).toBe('/admin/grading?cohort_id=3&submission=7&return_to=%2Fadmin%3Fcohort_id%3D3')
})

it('links Waiting for review to every cohort when Today is unscoped', async () => {
  await render('/admin')
  expect(link('Waiting for review').getAttribute('href')).toBe('/admin/grading?return_to=%2Fadmin')
})

it('names a cohort outside your list plainly instead of "Cohort N"', async () => {
  await render('/admin?cohort_id=99')
  expect(container.textContent).toContain('Not one of your cohorts')
  expect(container.textContent).not.toContain('Cohort 99')
})
