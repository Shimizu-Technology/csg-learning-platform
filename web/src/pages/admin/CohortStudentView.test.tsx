// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '../../lib/api'
import type { CohortDetail, CohortStudentView as CohortStudentViewData, StudentProgressResponse } from '../../types/api'
import { CohortStudentView, previewSectionsForCohort } from './CohortStudentView'

vi.mock('../../lib/api', () => ({
  api: {
    getCohortStudentView: vi.fn(),
    getCohort: vi.fn(),
    getStudentProgress: vi.fn(),
  },
}))

vi.mock('../student/Dashboard', () => ({ Dashboard: () => <div>Dashboard</div> }))
vi.mock('../student/Materials', () => ({ Materials: () => <div>Learn</div> }))

const student = {
  enrollment_id: 21,
  user_id: 12,
  full_name: 'Alumni Student',
  email: 'alumni@example.com',
  github_username: null,
  status: 'active',
  enrolled_at: '2026-09-26T00:00:00Z',
  last_sign_in_at: null,
  module_assignments: [],
}

const cohort = {
  id: 4,
  name: 'CSG Alumni',
  cohort_type: 'alumni',
  curriculum_id: 2,
  curriculum_name: 'CSG Alumni Learning Library',
  start_date: '2026-09-26',
  end_date: null,
  github_organization_name: null,
  repository_name: null,
  requires_github: false,
  status: 'active',
  settings: {},
  enrolled_count: 1,
  active_count: 1,
  announcements: [],
  students: [student],
  modules: [],
} satisfies CohortDetail

const studentView = {
  cohort: {
    id: 4,
    name: 'CSG Alumni',
    cohort_type: 'alumni',
    status: 'active',
    start_date: '2026-09-26',
    end_date: null,
    curriculum_name: 'CSG Alumni Learning Library',
    active_count: 1,
  },
  read_only: true,
  generated_at: '2026-09-26T00:00:00Z',
  summary: {
    assigned_modules: 0,
    available_modules: 0,
    locked_modules: 0,
    total_lessons: 0,
    visible_lessons: 0,
    locked_lessons: 0,
  },
  modules: [],
  dashboard: {
    enrolled: true,
    user: { id: 12, full_name: 'Alumni Student', role: 'student' },
    cohort: { id: 4, name: 'CSG Alumni', cohort_type: 'alumni', start_date: '2026-09-26', status: 'active' },
    overall_progress: { completed: 0, total: 0, percentage: 0 },
    modules: [],
    continue_lesson: null,
    action_items: [],
    resources: [],
    office_hours: [],
  },
  weekly_plan: null,
  announcements: [],
  resources: [],
  recordings: { uploaded_count: 0, legacy_count: 0, items: [] },
} satisfies CohortStudentViewData

const progress = {
  enrollment: { id: 21, status: 'active', module_assignments: [] },
  user: {
    id: 12,
    full_name: 'Alumni Student',
    email: 'alumni@example.com',
    github_username: null,
    avatar_url: null,
    last_sign_in_at: null,
    last_seen_at: null,
  },
  cohort: { id: 4, name: 'CSG Alumni', start_date: '2026-09-26', status: 'active' },
  overall_progress: { completed: 0, total: 0, percentage: 0 },
  modules: [],
  recent_activity: [],
} satisfies StudentProgressResponse

const standardCohort = {
  ...cohort,
  id: 5,
  name: 'Standard Cohort',
  cohort_type: 'standard',
} satisfies CohortDetail

const standardStudentView = {
  ...studentView,
  cohort: {
    ...studentView.cohort,
    id: 5,
    name: 'Standard Cohort',
    cohort_type: 'standard',
  },
  dashboard: {
    ...studentView.dashboard,
    cohort: {
      ...studentView.dashboard.cohort,
      id: 5,
      name: 'Standard Cohort',
      cohort_type: 'standard',
    },
  },
} satisfies CohortStudentViewData

describe('CohortStudentView routing', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    vi.mocked(api.getCohortStudentView).mockResolvedValue({ data: { student_view: studentView }, error: null })
    vi.mocked(api.getCohort).mockResolvedValue({ data: { cohort }, error: null })
    vi.mocked(api.getStudentProgress).mockResolvedValue({ data: progress, error: null })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  it('redirects a legacy alumni recordings URL to Learn and preserves the selected student', async () => {
    const router = createMemoryRouter(
      [{ path: '/admin/cohorts/:id/student-view/*', element: <CohortStudentView /> }],
      { initialEntries: ['/admin/cohorts/4/student-view/recordings?student_id=12'] },
    )

    await act(async () => {
      root.render(<RouterProvider router={router} />)
    })

    await vi.waitFor(() => {
      expect(router.state.location.pathname).toBe('/admin/cohorts/4/student-view/materials')
      expect(router.state.location.search).toBe('?student_id=12')
    })
  })

  it('does not redirect a new cohort using stale alumni preview data', async () => {
    vi.mocked(api.getCohortStudentView).mockImplementation(async (cohortId) => ({
      data: { student_view: cohortId === 5 ? standardStudentView : studentView },
      error: null,
    }))
    vi.mocked(api.getCohort).mockImplementation(async (cohortId) => ({
      data: { cohort: cohortId === 5 ? standardCohort : cohort },
      error: null,
    }))
    const router = createMemoryRouter(
      [{ path: '/admin/cohorts/:id/student-view/*', element: <CohortStudentView /> }],
      { initialEntries: ['/admin/cohorts/4/student-view'] },
    )

    await act(async () => {
      root.render(<RouterProvider router={router} />)
    })
    await vi.waitFor(() => expect(container.textContent).toContain('CSG Alumni'))

    await act(async () => {
      await router.navigate('/admin/cohorts/5/student-view/recordings?student_id=12')
    })

    await vi.waitFor(() => {
      expect(router.state.location.pathname).toBe('/admin/cohorts/5/student-view/recordings')
      expect(router.state.location.search).toBe('?student_id=12')
      expect(container.textContent).toContain('Standard Cohort')
    })
  })
})

describe('previewSectionsForCohort', () => {
  it('keeps alumni recordings inside the learning library', () => {
    expect(previewSectionsForCohort('alumni')).not.toContain('recordings')
    expect(previewSectionsForCohort('alumni')).toContain('materials')
  })

  it('preserves the recordings navigation for regular cohorts', () => {
    expect(previewSectionsForCohort('standard')).toContain('recordings')
  })
})
