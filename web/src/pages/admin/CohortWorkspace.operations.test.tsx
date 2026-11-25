// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { CohortWorkspace } from './CohortWorkspace'
const state = vi.hoisted(() => ({ admin: false, features: {} as Record<string, boolean> }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: { id: 1, is_staff: true, is_admin: state.admin }, schoolFeatures: state.features }) }))
vi.mock('../../lib/api', () => ({ api: {
  getCohort: async () => ({ data: { cohort: { id: 4, name: 'Cohort', status: 'active', modules: [], students: [], curriculum_name: 'Python' } } }),
  getCohortHome: async () => ({ data: { home: { cohort: { id: 4, name: 'Cohort', workspace_id: 7 }, upcoming_events: [], recent_announcements: [], permissions: { can_manage_schedule: true, can_manage_learning_schedule: true } } } }),
  getChannels: async () => ({ data: { channels: [{ id: 21, cohort_id: 4, name: 'Class Chat', visibility: 'cohort' }, { id: 22, cohort_id: 5, name: 'Elsewhere', visibility: 'cohort' }] } }),
} }))
vi.mock('../../components/admin/CohortScheduleManager', () => ({ CohortScheduleManager: ({ canManage, canManageLearningSchedule }: { canManage: boolean; canManageLearningSchedule: boolean }) => <p>Classes & office hours · {canManage ? 'Add session' : 'Read only'} · {canManageLearningSchedule ? 'Lesson releases' : 'No release edits'}</p> }))
vi.mock('../../components/admin/RecordingUploadManager', () => ({ RecordingUploadManager: ({ cohortId }: { cohortId: number }) => <p>Recording manager for {cohortId}</p> }))
vi.mock('./PrivateMeetings', () => ({ StaffPrivateMeetings: ({ cohortId }: { cohortId: number }) => <p>Private meetings for {cohortId}</p> }))
it('retains teacher recording/session operations while administrative learning settings stay admin-only', async () => {
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container)
  const router = createMemoryRouter([{ path: '/admin/cohorts/:id', element: <CohortWorkspace /> }], { initialEntries: ['/admin/cohorts/4?tab=learning'] })
  try {
    await act(async () => root.render(<RouterProvider router={router} />))
    expect(container.textContent).not.toContain('Configure learning')
    expect(container.textContent).not.toContain('Manage cohort')
    expect(container.textContent).toContain('Insights')
    await act(async () => router.navigate('/admin/cohorts/4?tab=recordings&settings_notice=1'))
    expect(container.textContent).toContain('Recording manager for 4')
    expect(container.textContent).toContain('Cohort settings are managed by admins.')
    await act(async () => router.navigate('/admin/cohorts/4?tab=schedule'))
    expect(container.textContent).toContain('Classes & office hours · Add session · No release edits')
    expect(container.textContent).toContain('Private meetings for 4')
    state.admin = true
    await act(async () => router.navigate('/admin/cohorts/4?tab=learning'))
    expect(container.textContent).toContain('Configure learning')
  } finally { act(() => root.unmount()); container.remove(); state.admin = false }
})

it.each(['team', 'settings'])('instructor forbidden tab %s renders overview and no editor', async tab => {
  const container = document.createElement('div'); const root = createRoot(container)
  const router = createMemoryRouter([{ path: '/admin/cohorts/:id', element: <CohortWorkspace /> }], { initialEntries: [`/admin/cohorts/4?tab=${tab}`] })
  try {
    await act(async () => root.render(<RouterProvider router={router} />))
    expect(container.querySelector('nav[aria-label="Cohort sections"] a[aria-current="page"]')?.textContent).toBe('Overview')
    expect(container.querySelector('a[href="/admin/cohorts/4?tab=settings"]')).toBeNull()
    expect(container.textContent).not.toContain('Save settings')
  } finally { act(() => root.unmount()) }
})

it('keeps communication scope and hides disabled cohort tabs', async () => {
 const container = document.createElement('div'); const root = createRoot(container)
 const router = createMemoryRouter([{ path: '/admin/cohorts/:id', element: <CohortWorkspace /> }], { initialEntries: ['/admin/cohorts/4?tab=communication'] })
 try {
  await act(async () => root.render(<RouterProvider router={router} />))
  expect(container.querySelector('a[href="/messages?workspace_id=7&cohort_id=4"]')).not.toBeNull()
  // L-5.2: this cohort's group conversations open their own page; other cohorts' aren't listed.
  await act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)))
  expect(container.querySelector('a[href^="/admin/channels/21"]')?.textContent).toBe('Class Chat')
  expect(container.textContent).not.toContain('Elsewhere')
  state.features = { recordings: false, private_meetings: false, office_hours: false, class_channels: false, announcements: false }
  await act(async () => router.navigate('/admin/cohorts/4?tab=recordings'))
  const nav = container.querySelector('nav[aria-label="Cohort sections"]')!
  expect(nav.textContent).not.toContain('Recordings'); expect(nav.textContent).not.toContain('Schedule'); expect(nav.textContent).not.toContain('Communication')
  expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe('Overview')
 } finally { act(() => root.unmount()); state.features = {} }
})
