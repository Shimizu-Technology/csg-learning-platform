// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { CohortWatchProgress } from './CohortWatchProgress'
vi.mock('../../lib/api', () => ({ api: {
  getCohort: async () => ({ data: { cohort: { name: 'QA Program' } } }),
  getCohortWatchProgress: async () => ({ data: { recordings: [{ id: 1, title: 'First recording' }, { id: 2, title: 'Second recording' }], students: [] } }),
  getCohortLessonVideoProgress: async () => ({ data: { videos: [], students: [] } }),
} }))
it('focuses the selected recording and returns to Learning', async () => {
 const container = document.createElement('div'); const root = createRoot(container)
 const router = createMemoryRouter([{ path: '/admin/cohorts/:id/watch-progress', element: <CohortWatchProgress /> }], { initialEntries: ['/admin/cohorts/4/watch-progress?recording_id=2'] })
 try {
  await act(async () => root.render(<RouterProvider router={router} />))
  expect(container.querySelector('a[href="/admin/cohorts/4?tab=learning"]')?.textContent).toContain('Back to QA Program')
  expect(container.querySelector('table')?.textContent).toContain('Second recording')
  expect(container.querySelector('table')?.textContent).not.toContain('First recording')
 } finally { act(() => root.unmount()) }
})
