// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { CohortWorkspace } from './CohortWorkspace'
const state = vi.hoisted(() => ({ admin: false }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: { id: 1, is_admin: state.admin } }) }))
vi.mock('../../lib/api', () => ({ api: {
  getCohort: async () => ({ data: { cohort: { id: 4, name: 'Cohort', status: 'active', modules: [], students: [], curriculum_name: 'Python' } } }),
  getCohortHome: async () => ({ data: { home: { permissions: { can_manage_schedule: true, can_manage_learning_schedule: true } } } }),
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
    expect(container.textContent).toContain('Learning insights')
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
