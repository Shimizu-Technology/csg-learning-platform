import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { expect, it } from 'vitest'
import { PersonalLearningPlan } from './PersonalLearningPlan'
import type { PersonalLearningPlan as Plan } from '../../types/api'

it('shows current milestone, truthful review status and source-cohort task links', () => {
  const task = { lesson_id: 12, module_id: 2, title: 'Backend project', required: true, available: true, completed: false, review_status: 'redo_requested' as const }
  const plan: Plan = { title: 'Finish my application', description: 'Keep building the organizer.', target_date: '2026-12-05', next_check_in_on: '2026-10-31', updated_at: '2026-10-24T10:00:00Z', required_count: 2, completed_count: 1, awaiting_review_count: 1, milestones: [{ title: 'Backend milestone', due_on: '2026-10-31', required_count: 1, completed_count: 0, lessons: [task] }], submission_deadlines: [{ lesson_id: 12, title: 'Backend project', available: true, closes_at: '2026-10-30T08:00:00Z', closed: true }, { lesson_id: 99, title: 'Future lesson', available: false, closes_at: '2026-11-30T08:00:00Z', closed: false }], next_lesson: task, requirement_changes: [{ lesson_id: 14, title: 'AI engineering', required: false, reason: 'Available after the core application' }] }
  const html = renderToStaticMarkup(<MemoryRouter><PersonalLearningPlan plan={plan} cohortId={9} /></MemoryRouter>)
  expect(html).toMatch(/<h2[^>]*>Your catch-up plan<\/h2>/)
  expect(html).toContain('Finish my application')
  expect(html).toContain('1 of 2 required lessons done or submitted.')
  expect(html).toContain('1 waiting for review.')
  expect(html).toContain('/lessons/12?cohort_id=9')
  expect(html).toContain('Current milestone')
  expect(html).toContain('Redo requested')
  expect(html).toContain('Submissions closed')
  expect(html).toContain('Future lesson · Not open yet')
  expect(html).not.toContain('/lessons/99')
  expect(html).toContain('Milestone targets do not extend submission windows.')
  expect(html).toContain('Available after the core application')
})

it('reads the staff note as Markdown, the way the plan editor wrote it', () => {
  const plan: Plan = { title: 'Catch up', description: 'Finish **JavaScript** first\n\n- then React', target_date: null, next_check_in_on: null, updated_at: '2026-11-17T00:00:00Z', required_count: 0, completed_count: 0, awaiting_review_count: 0, milestones: [], submission_deadlines: [], next_lesson: null, requirement_changes: [] }
  const html = renderToStaticMarkup(<MemoryRouter><PersonalLearningPlan plan={plan} /></MemoryRouter>)
  expect(html).toContain('<strong>JavaScript</strong>')
  expect(html).toContain('<li>then React</li>')
  expect(html).not.toContain('**')
})
