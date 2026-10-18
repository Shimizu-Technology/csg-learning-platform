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
  cohort: { id: 4, name: 'CSG Alumni', cohort_type: 'alumni', start_date: '2026-09-13', status: 'active' },
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

describe('Dashboard empty and review states', () => {
  it('says the course is not open (never 100% or caught up) when nothing is assigned', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Dashboard previewData={{ ...previewData, overall_progress: { completed: 0, total: 0, percentage: 0 }, modules: [], continue_lesson: null }} previewWeeklyPlan={null} disableStaffRedirect />
      </MemoryRouter>,
    )

    expect(html).toContain('Your course isn’t open yet')
    expect(html).toContain('Message your instructor')
    expect(html).not.toContain('caught up')
    expect(html).not.toContain('100%')
    expect(html).not.toContain('0 of 0')
  })

  it('says work is awaiting review instead of calling the learner caught up', () => {
    const module = previewData.modules![0]
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Dashboard previewData={{ ...previewData, modules: [{ ...module, lessons: [{ ...module.lessons[0], completed: true, review_status: 'awaiting_review' }] }] }} previewWeeklyPlan={null} disableStaffRedirect />
      </MemoryRouter>,
    )

    expect(html).toContain('Your instructor is reviewing one piece of work')
    expect(html).not.toContain('caught up')
  })

  it('shows redo feedback as a plain-text excerpt', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Dashboard previewData={{ ...previewData, action_items: [{ type: 'redo', submission_id: 1, lesson_id: 239, lesson_title: 'E2', content_block_title: 'E2', feedback: 'Explain *why* with **one** sentence.\n\n```python\nprint(x)\n```' }] }} previewWeeklyPlan={null} disableStaffRedirect />
      </MemoryRouter>,
    )

    expect(html).toContain('Explain why with one sentence. print(x)')
    expect(html).not.toContain('*why*')
    expect(html).not.toContain('```')
  })
})
