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
  redos: [{ id: 'redo-1', kind: 'redo', submission_id: 1, lesson_id: 1, title: 'Fix the exercise', lesson_title: 'Required lesson', feedback: 'Try again.', state: 'open', submission_close_at: null }],
  events: [],
  upcoming_unlocks: [],
  recording_catch_up: [],
}

describe('WeeklyPlanCard', () => {
  it('keeps required, redo, and optional work visibly distinct with lesson links', () => {
    const html = renderToStaticMarkup(<MemoryRouter><WeeklyPlanCard plan={plan} /></MemoryRouter>)

    expect(html).toContain('This Week')
    expect(html).toContain('Redo first')
    expect(html).toContain('Required work')
    expect(html).toContain('Optional stretch')
    expect(html).toContain('href="/lessons/1"')
    expect(html).toContain('does not count against your required week')
  })
})
