import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { expect, it } from 'vitest'
import { PersonalLearningPlan } from './PersonalLearningPlan'
import type { PersonalLearningPlan as Plan } from '../../types/api'

it('shows current milestone, truthful review status and source-cohort task links', () => {
  const task = { lesson_id: 12, module_id: 2, title: 'Backend project', required: true, available: true, completed: false, review_status: 'redo_requested' as const }
  const plan: Plan = { title: 'Finish my application', description: 'Keep building the organizer.', target_date: '2026-12-05', next_check_in_on: '2026-10-31', updated_at: '2026-10-24T10:00:00Z', required_count: 2, completed_count: 1, awaiting_review_count: 1, milestones: [{ title: 'Backend milestone', due_on: '2026-10-31', required_count: 1, completed_count: 0, lessons: [task] }], submission_deadlines: [{ lesson_id: 12, title: 'Backend project', closes_at: '2026-10-30T08:00:00Z', closed: true }], next_lesson: task, requirement_changes: [{ lesson_id: 14, title: 'AI engineering', required: false, reason: 'Available after the core application' }] }
  const html = renderToStaticMarkup(<MemoryRouter><PersonalLearningPlan plan={plan} cohortId={9} /></MemoryRouter>)
  expect(html).toContain('1 of 2 required lessons done or submitted.')
  expect(html).toContain('1 awaiting instructor review.')
  expect(html).toContain('/lessons/12?cohort_id=9')
  expect(html).toContain('Current milestone')
  expect(html).toContain('Redo requested')
  expect(html).toContain('Submissions closed')
  expect(html).toContain('Milestone targets do not extend submission windows.')
  expect(html).toContain('Available after the core application')
})
