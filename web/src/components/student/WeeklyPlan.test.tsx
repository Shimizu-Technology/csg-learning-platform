import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import type { WeeklyPlan } from '../../types/api'
import { WeeklyPlanCard } from './WeeklyPlan'

const plan: WeeklyPlan = {
  enrolled: true,
  cohort: { id: 4, name: 'Cohort 4' },
  week_number: 3,
  starts_on: '2026-07-20',
  ends_on: '2026-07-26',
  timezone: 'Pacific/Guam',
  summary: { required_count: 2, required_completed_count: 1, open_redo_count: 1, optional_count: 1 },
  required: [
    { id: 'lesson-1', kind: 'lesson', lesson_id: 1, module_id: 2, title: 'Required lesson', module_title: 'Foundations', lesson_type: 'exercise', required: true, scheduled_for: '2026-07-20', carried_forward: false, state: 'open', submission_close_at: null, submissions_closed: false },
  ],
  optional: [
    { id: 'lesson-2', kind: 'lesson', lesson_id: 2, module_id: 2, title: 'Stretch lesson', module_title: 'Foundations', lesson_type: 'reading', required: false, scheduled_for: '2026-07-22', carried_forward: false, state: 'upcoming', submission_close_at: null, submissions_closed: false },
  ],
  redos: [{ id: 'redo-1', kind: 'redo', submission_id: 1, content_block_id: 8, lesson_id: 1, title: 'Fix the exercise', lesson_title: 'Required lesson', feedback: 'Try again.', state: 'open', submission_close_at: null }],
  events: [],
  upcoming_unlocks: [],
  recording_catch_up: [],
}

describe('WeeklyPlanCard', () => {
  it('keeps required, redo, and optional work visibly distinct with lesson links', () => {
    const html = renderToStaticMarkup(<MemoryRouter><WeeklyPlanCard plan={plan} /></MemoryRouter>)

    expect(html).toContain('This week')
    expect(html).toContain('Redo first')
    expect(html).toContain('href="/lessons/1?cohort_id=4#block-8"')
    expect(html).toContain('Required work')
    expect(html).toContain('Optional stretch')
    expect(html).toContain('href="/lessons/1?cohort_id=4"')
    expect(html).toContain('does not count against your required week')
  })

  it('presents alumni enrollment as an open library without weekly requirements', () => {
    const html = renderToStaticMarkup(<MemoryRouter><WeeklyPlanCard plan={{
      enrolled: true,
      mode: 'library',
      cohort: { id: 9, name: 'CSG Alumni' },
      timezone: 'Pacific/Guam',
      library_summary: { module_count: 9, lesson_count: 79, recording_count: 79 },
      events: [],
      recording_catch_up: [],
    }} /></MemoryRouter>)

    expect(html).toContain('Alumni Learning Library')
    expect(html).toContain('79')
    expect(html).toContain('href="/materials"')
    expect(html).not.toContain('Required work')
    expect(html).not.toContain('This week')
  })

  it('labels submitted work as awaiting review and never shows 100% for an empty week', () => {
    const html = renderToStaticMarkup(<MemoryRouter><WeeklyPlanCard plan={{
      ...plan,
      required: [{ ...plan.required![0], state: 'completed', review_status: 'awaiting_review' }],
    }} /></MemoryRouter>)
    expect(html).toContain('Submitted · awaiting review')
    expect(html).not.toContain('>completed<')
    expect(html).toContain('Try again.')

    const empty = renderToStaticMarkup(<MemoryRouter><WeeklyPlanCard plan={{
      ...plan,
      summary: { required_count: 0, required_completed_count: 0, open_redo_count: 0, optional_count: 0 },
      required: [],
      optional: [],
      redos: [],
    }} /></MemoryRouter>)
    expect(empty).toContain('No required work is scheduled this week.')
    expect(empty).not.toContain('100%')
  })

  it('shows a redo row with the warning label and a plain-text feedback excerpt', () => {
    const html = renderToStaticMarkup(<MemoryRouter><WeeklyPlanCard plan={{
      ...plan,
      required: [{ ...plan.required![0], state: 'open', review_status: 'redo_requested' }],
      redos: [{ ...plan.redos![0], feedback: 'Explain **why**' }],
    }} /></MemoryRouter>)
    expect(html).toContain('Redo requested')
    expect(html).toContain('Explain why')
    expect(html).not.toContain('**why**')
  })
})


it('shows self-paced course dates, next lesson and redo feedback without alumni promises', () => {
  const html = renderToStaticMarkup(<MemoryRouter><WeeklyPlanCard plan={{ ...plan, mode: 'library', plan_kind: 'self_paced', course_overview: { course_name: 'Python Fundamentals', next_lesson: { lesson_id: 12, title: 'Python lists', module_id: 2 } }, capabilities: { can_submit: true, read_only: false, support_mode: 'course_question', support_instructor_id: 9, access_expires_at: '2026-12-01T00:00:00Z', support_expires_at: '2026-11-01T00:00:00Z' } }} /></MemoryRouter>)
  expect(html).toContain('Python Fundamentals')
  expect(html).toContain('Next lesson: Python lists')
  expect(html).toContain('Course access ends')
  expect(html).toContain('Instructor support ends')
  expect(html).toContain('Ask a course question')
  expect(html).toContain('/lessons/12?cohort_id=4')
  expect(html).toContain('Redo first')
  expect(html).toContain('Try again.')
  expect(html).not.toContain('Alumni Learning Library')
  expect(html).not.toContain('every CSG topic')
})

it('retains personal-plan recording routes, event zones, and access/support end dates', () => {
  const html = renderToStaticMarkup(<MemoryRouter><WeeklyPlanCard plan={{ ...plan, plan_kind: 'self_paced',
    personal_plan: { title: 'Personal course', description: null, target_date: null, next_check_in_on: null, updated_at: '', required_count: 0, completed_count: 0, awaiting_review_count: 0, milestones: [], next_lesson: null, requirement_changes: [] },
    capabilities: { access_expires_at: '2026-12-05T00:00:00Z', support_expires_at: '2026-11-28T00:00:00Z', support_mode: 'course_question', can_submit: true, read_only: false, support_instructor_id: null },
    recording_catch_up: [{ id: 'recording-15', recording_id: 15, cohort_id: 4, title: 'Authentication replay', recorded_on: null, progress_percentage: 0, kind: 'recording' }],
    events: [{ id: 'event-1', office_hour_id: 1, title: 'Tokyo session', description: null, starts_at: '2026-10-31T01:00:00Z', ends_at: '2026-10-31T02:00:00Z', meeting_url: 'https://meet.example.com/class', timezone: 'Asia/Tokyo', recurrence: 'once', kind: 'live_class', event_kind: 'live_class' }],
  }} /></MemoryRouter>)
  expect(html).toContain('/recordings?cohort_id=4&amp;recording=15')
  expect(html).toContain('10:00 AM')
  expect(html).toContain('Course access ends')
  expect(html).toContain('Instructor support ends')
})
