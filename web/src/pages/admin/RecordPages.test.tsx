// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

// L-0.3 / L-0.4 on real record pages: the header names where the record was
// opened from, shows the role's breadcrumb, and the related panel shows the
// server's permission-checked rows with links that keep the context.

const mocks = vi.hoisted(() => ({
  user: { id: 1, is_staff: true, is_admin: false } as { id: number; is_staff: boolean; is_admin: boolean },
  getHelpRequest: vi.fn(),
  getRecordRelated: vi.fn(),
  getLesson: vi.fn(),
}))
vi.mock('../../lib/api', () => ({ api: { getHelpRequest: mocks.getHelpRequest, getRecordRelated: mocks.getRecordRelated, getLesson: mocks.getLesson, getHelpRequests: vi.fn().mockResolvedValue({ data: { help_requests: [] } }) } }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: mocks.user }) }))
vi.mock('../../contexts/CohortContext', () => ({ useCohortContext: () => ({ selectedCohortId: 3, cohorts: [{ id: 3, name: 'Cohort 3' }] }) }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }))
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => vi.fn().mockResolvedValue(true) }))
vi.mock('../../components/admin/StudentContextDrawer', () => ({ StudentContextDrawer: () => null }))
vi.mock('../../lib/useMediaQuery', () => ({ useMediaQuery: () => false }))
vi.mock('../../components/shared/ContentBlockRenderer', () => ({ ContentBlockRenderer: () => <p>Block</p> }))
vi.mock('../../components/shared/RubricPanel', () => ({ RubricPanel: () => null }))
vi.mock('../../components/student/ContextualHelp', () => ({ ContextualHelp: () => <button type="button">Ask for help</button> }))
vi.mock('../../components/shared/LearningObjectivesPanel', () => ({ LearningObjectivesPanel: () => null }))

import { HelpRequestDetail } from './HelpRequestDetail'
import { LessonView } from '../student/LessonView'

const request = {
  id: 4, cohort: { id: 3, name: 'Cohort 3' }, context_type: 'lesson', context_source: 'primary', context_id: 40, context_label: 'Make decisions',
  context_path: '/lessons/40', category: 'concept', urgency: 'normal', status: 'open', message: 'Synthetic question', staff_response: null,
  acknowledged_at: null, resolved_at: null, canceled_at: null, created_at: '2026-11-12T09:00:00Z', updated_at: '2026-11-12T09:00:00Z', owner: null,
  student: { id: 9, full_name: 'Alex Rivera', email: 'alex@example.com' },
}
const context = { cohort: { id: 3, name: 'Cohort 3' }, student: { id: 9, name: 'Alex Rivera' }, lesson: { id: 40, title: 'Make decisions' }, module: { id: 7, name: 'Week 10' } }

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  mocks.user = { id: 1, is_staff: true, is_admin: false }
  mocks.getHelpRequest.mockResolvedValue({ data: { help_request: request }, error: null })
  mocks.getRecordRelated.mockImplementation(async (type: string) => type === 'help_request'
    ? { data: { related: { type, id: 4, context, items: [
      { key: 'lesson', count: null, value: 'Make decisions', lesson_id: 40 },
      { key: 'follow_up', count: 0, value: null, intervention_id: null },
      { key: 'conversation', count: null, value: null, direct_conversation_id: 12, cohort_id: 3 },
      { key: 'other_requests', count: 2, value: null, cohort_id: 3, user_id: 9 },
    ] } }, error: null }
    : { data: { related: { type, id: 40, view: 'learner', context, items: [
      { key: 'your_work', count: 0, value: null, content_block_id: 81, work_count: 1 },
      { key: 'recordings', count: 2, value: null, cohort_id: 3 },
    ] } }, error: null })
  mocks.getLesson.mockResolvedValue({ data: { lesson: { id: 40, cohort_id: 3, title: 'Make decisions', module_id: 7, lesson_type: 'exercise', required: true, content_blocks: [{ id: 81, position: 0, block_type: 'exercise' }], objectives: [], prev_lesson: null, next_lesson: null, capabilities: { read_only: false, can_submit: true } } } })
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks() })

async function render(entry: string | { pathname: string; search?: string; state?: unknown }) {
  const router = createMemoryRouter([
    { path: '/admin/help-requests/:id', element: <HelpRequestDetail /> },
    { path: '/lessons/:id', element: <LessonView /> },
    { path: '*', element: <p>Elsewhere</p> },
  ], { initialEntries: [entry] })
  await act(async () => root.render(<RouterProvider router={router} />))
  await act(async () => { await Promise.resolve() })
  return router
}
const backLink = () => container.querySelector<HTMLAnchorElement>('[data-back-link]')!
const crumbs = () => [...container.querySelectorAll('nav[aria-label="Breadcrumb"] li')].map((item) => item.textContent)
const row = (key: string) => container.querySelector(`[data-related-row="${key}"]`)

it('a help request opened from Grading says so, shows Cohort › Student › Record and its related rows', async () => {
  await render('/admin/help-requests/4?return_to=%2Fadmin%2Fgrading%3Ffilter%3Dredo')
  expect(backLink().textContent).toBe('Back to Grading inbox · Redo')
  expect(backLink().getAttribute('href')).toBe('/admin/grading?filter=redo')
  expect(crumbs()).toEqual(['Cohort 3', 'Alex Rivera', 'Help request #4'])
  expect(container.querySelector('h1')?.textContent).toBe('Make decisions')
  expect(container.querySelector('[data-record-type]')?.textContent).toBe('Help request #4 · concept')
  expect(mocks.getRecordRelated).toHaveBeenCalledWith('help_request', 4, { cohortId: undefined, studentId: undefined }, expect.any(AbortSignal))
  expect(row('lesson')?.querySelector('a')?.getAttribute('href')).toBe('/lessons/40?cohort_id=3')
  expect(row('follow_up')?.querySelector('a')).toBeNull()
  expect(row('conversation')?.querySelector('a')?.getAttribute('href')).toBe('/messages/dm/12?cohort_id=3')
  expect(row('other_requests')?.querySelector('a')?.getAttribute('href')).toContain('/admin/cohorts/3/students/9/support?return_to=')
  expect(container.querySelector('[data-copy-link]')).not.toBeNull()
})

it('a help request with no origin goes back to Support, and rejects an unsafe return_to', async () => {
  await render('/admin/help-requests/4?return_to=https%3A%2F%2Fevil.example%2Fadmin')
  expect(backLink().textContent).toBe('Back to Support')
  expect(backLink().getAttribute('href')).toBe('/admin/support')
})

it('a help request opened from Today via router state says "Back to Today"', async () => {
  await render({ pathname: '/admin/help-requests/4', state: { returnTo: '/admin', returnLabel: 'Today' } })
  expect(backLink().textContent).toBe('Back to Today')
})

it('the related panel disappears row by row with the feature, never leaving a dead link', async () => {
  mocks.getRecordRelated.mockResolvedValueOnce({ data: { related: { type: 'help_request', id: 4, context, items: [{ key: 'conversation', count: null, value: null, direct_conversation_id: null, cohort_id: 3 }] } }, error: null })
  await render('/admin/help-requests/4')
  expect(row('follow_up')).toBeNull()
  expect(row('conversation')?.querySelector('button')?.textContent).toContain('Start')
})

it('a learner lesson shows Cohort › Learn › Module › Lesson, Back to Learn from Learn, and their own related rows', async () => {
  mocks.user = { id: 9, is_staff: false, is_admin: false }
  await render({ pathname: '/lessons/40', search: '?cohort_id=3', state: { returnTo: '/materials?cohort_id=3', returnLabel: 'Learn' } })
  expect(backLink().textContent).toBe('Back to Learn')
  expect(crumbs()).toEqual(['Cohort 3', 'Learn', 'Week 10', 'Make decisions'])
  expect(container.querySelector('nav[aria-label="Breadcrumb"] a[href="/materials?cohort_id=3"]')).not.toBeNull()
  expect(container.querySelector('[data-record-type]')?.textContent).toBe('Exercise · Week 10')
  expect(row('your_work')?.querySelector('a')?.getAttribute('href')).toBe('/lessons/40?cohort_id=3#block-81')
  expect(row('recordings')?.querySelector('a')?.getAttribute('href')).toBe('/recordings?cohort_id=3')
  expect(container.textContent).toContain('Ask for help')
})

it('a learner lesson with no origin goes back to its module by name', async () => {
  mocks.user = { id: 9, is_staff: false, is_admin: false }
  await render('/lessons/40?cohort_id=3')
  expect(backLink().textContent).toBe('Back to Week 10')
  expect(backLink().getAttribute('href')).toBe('/modules/7?cohort_id=3')
})
