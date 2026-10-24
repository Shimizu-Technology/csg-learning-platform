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

describe('Dashboard hierarchy', () => {
  const redo = { type: 'redo', submission_id: 1, lesson_id: 239, lesson_title: 'Lesson 2', content_block_title: 'E2 — repair two errors', feedback: 'Define the name first.' }
  const weekly: WeeklyPlan = {
    enrolled: true,
    cohort: { id: 2, name: 'Python Fundamentals Pilot' },
    week_number: 3,
    starts_on: '2026-10-19',
    ends_on: '2026-10-25',
    timezone: 'Pacific/Guam',
    summary: { required_count: 2, required_completed_count: 0, open_redo_count: 1, optional_count: 0 },
    required: [
      { id: 'l1', kind: 'lesson', lesson_id: 239, module_id: 1, title: 'E2 — repair two errors', module_title: 'Python Fundamentals', lesson_type: 'exercise', required: true, scheduled_for: '2026-10-19', carried_forward: true, state: 'open', review_status: 'redo_requested', submission_close_at: null, submissions_closed: false },
      { id: 'l2', kind: 'lesson', lesson_id: 240, module_id: 1, title: 'Lesson 7', module_title: 'Python Fundamentals', lesson_type: 'reading', required: true, scheduled_for: '2026-10-19', carried_forward: false, state: 'open', submission_close_at: null, submissions_closed: false },
    ],
    optional: [],
    redos: [{ id: 'r1', kind: 'redo', submission_id: 1, lesson_id: 239, title: 'E2 — repair two errors', lesson_title: 'Lesson 2', feedback: 'Define the name first.', state: 'open', submission_close_at: null }],
    events: [],
    upcoming_unlocks: [],
    recording_catch_up: [],
  }

  function render(data: DashboardData, plan: WeeklyPlan | null) {
    return renderToStaticMarkup(<MemoryRouter><Dashboard previewData={data} previewWeeklyPlan={plan} disableStaffRedirect /></MemoryRouter>)
  }

  it('puts a redo first in the single next-action hero, linking to the feedback', () => {
    const html = render({ ...previewData, cohort: { ...previewData.cohort!, course_delivery: 'guided' } as DashboardData['cohort'], action_items: [redo] }, weekly)
    const hero = html.slice(html.indexOf('data-region="next-action"'), html.indexOf('this-week-title'))
    expect(hero).toContain('Redo requested')
    expect(hero).toContain('href="/lessons/239#redo"')
    expect(hero).toContain('Read feedback and resubmit')
    // The plan does not repeat the redo the hero already shows.
    expect(html).not.toContain('Redo first')
  })

  it('has exactly one primary action on the page (the hero) and no progress rings', () => {
    const html = render({ ...previewData, action_items: [redo] }, weekly)
    expect(html.match(/data-variant="primary"/g)?.length).toBe(1)
    expect(html).not.toContain('role="progressbar" aria-label="Overall"')
    expect(html.match(/role="progressbar"/g)?.length).toBe(2) // course + this week
  })

  it('keeps the weekly plan on a light surface with neutral open rows', () => {
    const html = render(previewData, weekly)
    const plan = html.slice(html.indexOf('this-week-title') - 200)
    expect(plan).not.toContain('bg-slate-950')
    expect(plan).not.toContain('surface-inverse')
    expect(plan).not.toMatch(/\b(text|bg|border)-(red|primary)-\d/)
    expect(plan).toContain('lucide-circle ')
  })

  it('shows a one-time week-complete moment when all required work is in', () => {
    window.localStorage.clear()
    const done: WeeklyPlan = {
      ...weekly,
      summary: { required_count: 2, required_completed_count: 2, open_redo_count: 0, optional_count: 0 },
      required: weekly.required!.map((item) => ({ ...item, state: 'completed', review_status: 'reviewed' })),
      redos: [],
    }
    const html = render(previewData, done)
    expect(html).toContain('Week 3</span> complete')
    expect(html).toContain('data-week-complete="animate"')
    expect(html).toContain('milestone-ring-animate')
  })
})

describe('Dashboard acquisition recovery', () => {
  it('shows owned pending purchases before the generic unenrolled state', () => {
    const html = renderToStaticMarkup(<MemoryRouter><Dashboard previewData={{ enrolled: false, user: previewData.user, catalog_enabled: true, pending_purchases: [{ id: 20, cohort_id: 13, course_name: 'Python' }] }} disableStaffRedirect /></MemoryRouter>)
    expect(html).toContain('Confirming your enrollment in Python')
    expect(html).toContain('/courses?checkout=return&amp;purchase_id=20&amp;offering_id=13')
    expect(html).not.toContain('Not enrolled yet')
    expect(html).not.toContain('Contact your instructor')
  })
  it('offers the enabled catalog and school contact for a learner with no enrollment', () => {
    const html = renderToStaticMarkup(<MemoryRouter><Dashboard previewData={{ enrolled: false, user: previewData.user, catalog_enabled: true, pending_purchases: [] }} disableStaffRedirect /></MemoryRouter>)
    expect(html).toContain('Browse courses')
    expect(html).toContain('Contact CSG')
  })
})

it('keeps a closed-window redo available to read without offering resubmission', () => {
  const data: DashboardData = { ...previewData, action_items: [{ type: 'redo', submission_id: 1, lesson_id: 239, lesson_title: 'Review ownership', content_block_title: 'Two-user check', feedback: 'Recheck isolation', submissions_closed: true }] }
  const html = renderToStaticMarkup(<MemoryRouter><Dashboard previewData={data} previewWeeklyPlan={previewWeeklyPlan} disableStaffRedirect /></MemoryRouter>)
  expect(html).toContain('Read feedback')
  expect(html).not.toContain('Read feedback and resubmit')
})
