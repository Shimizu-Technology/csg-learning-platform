// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { DashboardData, WeeklyPlan } from '../../types/api'
import { Dashboard } from './Dashboard'

const previewData: DashboardData = {
  enrolled: true,
  user: { id: 0, full_name: 'Student Preview', role: 'student' },
  cohort: { id: 4, name: 'CSG Alumni', start_date: '2026-09-13', status: 'active' },
  overall_progress: { completed: 0, total: 1, percentage: 0 },
  modules: [{
    id: 1,
    name: 'Rails APIs and Databases',
    module_type: 'recording',
    progress_percentage: 0,
    completed_blocks: 0,
    total_blocks: 1,
    assigned: true,
    unlocked: true,
    available: true,
    unlock_date: '2026-09-13',
    lessons: [{
      id: 239,
      title: 'Model One-to-Many Relationships in Rails',
      lesson_type: 'exercise',
      required: false,
      available: true,
      unlock_date: '2026-09-13',
      completed: false,
      total_blocks: 1,
      completed_blocks: 0,
    }],
  }],
  continue_lesson: { id: 239, title: 'Model One-to-Many Relationships in Rails' },
  action_items: [],
  resources: [],
  office_hours: [],
}

const previewWeeklyPlan: WeeklyPlan = {
  enrolled: true,
  mode: 'library',
  cohort: { id: 4, name: 'CSG Alumni' },
  timezone: 'Pacific/Guam',
  library_summary: { module_count: 10, lesson_count: 5, recording_count: 0 },
  events: [],
  recording_catch_up: [],
}

describe('Dashboard alumni preview', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('renders the alumni library card and an available lesson', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Dashboard previewData={previewData} previewWeeklyPlan={previewWeeklyPlan} disableStaffRedirect />
      </MemoryRouter>,
    )

    expect(html).toContain('Alumni Learning Library')
    expect(html).toContain('Model One-to-Many Relationships in Rails')
    expect(html).not.toContain('fully caught up')
  })

  it('replaces the alumni library summary when preview props change', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <Dashboard previewData={previewData} previewWeeklyPlan={previewWeeklyPlan} disableStaffRedirect />
        </MemoryRouter>,
      )
    })

    expect(container.textContent).toContain('5available lessons')

    const updatedPlan: WeeklyPlan = {
      ...previewWeeklyPlan,
      library_summary: { module_count: 10, lesson_count: 9, recording_count: 0 },
    }
    const updatedData: DashboardData = {
      ...previewData,
      user: { ...previewData.user, full_name: 'Another Alumni' },
    }

    await act(async () => {
      root.render(
        <MemoryRouter>
          <Dashboard previewData={updatedData} previewWeeklyPlan={updatedPlan} disableStaffRedirect />
        </MemoryRouter>,
      )
    })

    expect(container.textContent).toContain('9available lessons')
    expect(container.textContent).not.toContain('5available lessons')
  })
})
