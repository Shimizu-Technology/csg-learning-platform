// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { StaffActivityFeed } from './StaffActivityFeed'
import { api } from '../../lib/api'
import type { ActivityEvent, CohortDetail } from '../../types/api'
vi.mock('../../lib/api', () => ({ api: { getActivityEvents: vi.fn() } }))
const event = { id: 80, actor: { id: 1, name: 'Teacher', role: 'instructor' }, subject_user: { id: 20, name: 'Learner', role: 'student' }, subject_user_id: 20, event_type: 'submission_graded', cohort_id: 4, cohort_name: 'Cohort 4', record_label: 'Arrays', record_type: 'Submission', record_id: 800, evidence: 'server_record', created_at: '2026-10-22T00:00:00Z', destination: { kind: 'submission', cohort_id: 4, student_id: 20, submission_id: 800 } } satisfies ActivityEvent
let root: Root; let container: HTMLDivElement
beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container); vi.mocked(api.getActivityEvents).mockResolvedValue({ error: null, data: { activity_events: [event], next_before_id: 80, recorded_since: '2026-10-21T00:00:00Z' } }) })
afterEach(() => { act(() => root.unmount()); container.remove(); vi.resetAllMocks() })
async function click(text: string) { await act(async () => { Array.from(container.querySelectorAll('a,button')).find((element) => element.textContent === text)!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })) }) }
it('uses explicit feed, identifies staff actions, preserves filters and cursor through a record round trip', async () => {
  const router = createMemoryRouter([{ path: '/admin/cohorts/:id', element: <StaffActivityFeed cohort={{ id: 4, students: [{ user_id: 20, full_name: 'Learner' }] } as CohortDetail} /> }, { path: '/admin/submissions/:id', element: <p>Review record</p> }], { initialEntries: ['/admin/cohorts/4?tab=activity&activity_category=work&activity_learner=20&activity_since=2026-10-20'] })
  await act(async () => root.render(<RouterProvider router={router} />))
  expect(api.getActivityEvents).toHaveBeenLastCalledWith(expect.objectContaining({ feed: 'cohort', cohort_id: 4, user_id: 20, category: 'work', since: '2026-10-20' }))
  expect(container.textContent).toContain('Staff acted for learner · Teacher')
  expect(container.textContent).toContain('Recorded since')
  await click('Earlier activity')
  expect(api.getActivityEvents).toHaveBeenLastCalledWith(expect.objectContaining({ before_id: 80 }))
  expect(router.state.location.search).toContain('activity_before=80')
  const learner = container.querySelector('a')!
  expect(learner.getAttribute('href')).toContain('/admin/cohorts/4/students/20/overview')
  await click('Arrays')
  expect(router.state.location.pathname).toBe('/admin/submissions/800')
  expect(router.state.location.search).toContain('cohort_id=4&student_id=20')
  expect(router.state.location.state.returnTo).toContain('activity_before=80')
  await act(async () => router.navigate(-1))
  expect(api.getActivityEvents).toHaveBeenLastCalledWith(expect.objectContaining({ before_id: 80, category: 'work', user_id: 20 }))
  const category = container.querySelectorAll('select')[1]
  await act(async () => { category.value = 'learning'; category.dispatchEvent(new Event('change', { bubbles: true })) })
  expect(router.state.location.search).not.toContain('activity_before')
  expect(api.getActivityEvents).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'learning', before_id: undefined }))
})
it('adds exact lesson return context and never invents destinations for deleted records', async () => {
  vi.mocked(api.getActivityEvents).mockResolvedValue({ error: null, data: { activity_events: [{ ...event, id: 1, destination: { kind: 'lesson', cohort_id: 4, student_id: 20, destination_path: '/lessons/77?cohort_id=4#block-7' } }, { ...event, id: 2, record_label: null, destination: null }], next_before_id: null } })
  const router = createMemoryRouter([{ path: '/admin/activity', element: <StaffActivityFeed /> }], { initialEntries: ['/admin/activity?activity_actor=1&activity_cohort=4'] })
  await act(async () => root.render(<RouterProvider router={router} />))
  expect(api.getActivityEvents).toHaveBeenLastCalledWith(expect.objectContaining({ feed: 'school', actor_id: 1, cohort_id: 4 }))
  expect(Array.from(container.querySelectorAll('a')).find((item) => item.textContent === 'Arrays')?.getAttribute('href')).toBe('/lessons/77?cohort_id=4&return_to=%2Fadmin%2Factivity%3Factivity_actor%3D1%26activity_cohort%3D4#block-7')
  expect(container.textContent).toContain('Record unavailable')
})
it('settles a failed feed and only retries explicitly', async () => {
  vi.mocked(api.getActivityEvents).mockResolvedValue({ data: null, error: 'Offline', status: 503 })
  const router = createMemoryRouter([{ path: '/', element: <StaffActivityFeed /> }])
  await act(async () => root.render(<RouterProvider router={router} />))
  expect(api.getActivityEvents).toHaveBeenCalledTimes(1)
  expect(container.textContent).toContain('Offline')
  await click('Try again')
  expect(api.getActivityEvents).toHaveBeenCalledTimes(2)
})
