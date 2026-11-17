// @vitest-environment jsdom
import { act, Suspense, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

/*
 * W8 PR 8.2: the redesigned Today behind the new student experience switch.
 * Off (Cohort 3, Lance), /dashboard renders today's Dashboard with identical
 * markup and the payload never carries `student_today`. On, Today shows the
 * server's next step, Needs you, waiting work, grades and the next session.
 */
const state = vi.hoisted(() => ({ cohort: {} as Record<string, unknown>, auth: { user: { id: 4, is_staff: false, full_name: 'Lance Example' }, enrollments: [] as unknown[], schoolFeatures: {} } }))
const mocks = vi.hoisted(() => ({ getDashboard: vi.fn(), getWeeklyPlan: vi.fn(), createDirectConversation: vi.fn(), markNotificationRead: vi.fn(), dismissStartHere: vi.fn() }))
vi.mock('../../lib/api', () => ({ api: mocks }))
vi.mock('../../contexts/CohortContext', () => ({ useCohortContext: () => state.cohort }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => state.auth }))
vi.mock('../../lib/routePreload', async () => ({
  Dashboard: (await import('./Dashboard')).Dashboard,
  StudentToday: (await import('./Today')).StudentTodayPage,
  MyWork: () => <p data-testid="my-work">My work</p>,
  CourseOutline: () => null, Materials: () => null, ModuleView: () => null,
}))

import { TodayRoute, MyWorkRoute } from './StudentExperienceRoutes'
import { Dashboard } from './Dashboard'

const lanceDashboard = {
  enrolled: true, user: { id: 4, full_name: 'Lance Example', role: 'student' }, enrollment_status: 'active', review_response_time: 'usually reviewed within 2 days',
  cohort: { id: 3, name: 'Cohort 3', cohort_type: 'bootcamp', features: { student_experience_v2: false }, announcements: [] },
  capabilities: { features: { student_experience_v2: false, office_hours: true }, can_submit: true, read_only: false, support_mode: 'guided_help', live_support: true },
  overall_progress: { completed: 1, total: 2, percentage: 50, completed_lessons: 1, total_lessons: 2 },
  modules: [{ id: 5, name: 'JavaScript Foundations', module_type: 'live_class', available: true, total_blocks: 2, completed_blocks: 1, progress_percentage: 50, completed_lessons: 1, total_lessons: 2, assigned: true, unlocked: true, unlock_date: null,
    lessons: [
      { id: 11, title: 'Intro to Functions', lesson_type: 'exercise', kind: 'reading', available: true, required: true, unlock_date: null, completed: true, total_blocks: 1, completed_blocks: 1, learner_status: 'done', review_status: null, submission_window: null },
      { id: 12, title: 'Loops and Iteration', lesson_type: 'exercise', kind: 'exercise', available: true, required: true, unlock_date: null, completed: false, total_blocks: 1, completed_blocks: 0, learner_status: 'open', review_status: null, submission_window: null },
    ] }],
  continue_lesson: { id: 12, title: 'Loops and Iteration' },
  action_items: [{ type: 'redo', submission_id: 70, content_block_id: 701, lesson_id: 11, lesson_title: 'Intro to Functions', content_block_title: 'Practice', feedback: 'Return the string.', submission_type: 'text_submission', submissions_closed: false }],
  recently_graded: [], resources: [], office_hours: [{ office_hour_id: 1, title: 'Office hours', description: null, starts_at: '2026-11-19T08:00:00Z', ends_at: '2026-11-19T09:00:00Z', meeting_url: 'https://meet.example.com/office', timezone: 'Pacific/Guam', recurrence: 'weekly', event_kind: 'office_hours' }],
}

const person = (id: number, full_name: string) => ({ id, full_name })
const work = (submission_id: number, status: 'redo' | 'waiting' | 'graded', extra: Record<string, unknown> = {}) => ({
  submission_id, status, ask_to: status === 'waiting' ? null : person(2, 'Audreana Synthetic'), cohort_id: 9, lesson_id: 100 + submission_id, content_block_id: 700 + submission_id, lesson_title: `Lesson ${submission_id}`, block_title: `Lesson ${submission_id}`,
  module_name: 'JavaScript Foundations', week: 8, attempt: 1, grade: status === 'redo' ? 'R' : status === 'graded' ? 'A' : null, feedback: status === 'waiting' ? null : 'Return the string instead, then **resubmit**.',
  submitted_at: '2026-11-15T00:00:00Z', graded_at: status === 'waiting' ? null : '2026-11-17T00:00:00Z', grader: status === 'waiting' ? null : person(2, 'Audreana Synthetic'),
  submission_type: 'text_submission', submissions_closed: false, can_resubmit: status === 'redo', ...extra,
})
function studentToday(overrides: Record<string, unknown> = {}) {
  return {
    mode: 'program', read_only: false, paused: false, course_week: { current: 11, total: 16 }, counts: { completed_lessons: 155, total_lessons: 243 },
    next_lesson: { id: 404, title: 'Loops and Iteration', kind: 'exercise', module_id: 5, module_name: 'JavaScript Foundations', week: 10, number: 156, position: 4, module_lesson_count: 5, status: 'open' },
    this_week: { total: 5, completed: 3, ends_on: '2026-11-22' }, pace: { behind: false, weeks_behind: 0, overdue_count: 0 }, catch_up_plan: null,
    needs_you: { count: 3, items: [
      { ...work(1, 'redo'), kind: 'redo' },
      { kind: 'help_answer', help_request_id: 31, notification_id: 81, context_label: 'Make Decisions with JavaScript', path: '/lessons/120?cohort_id=9&help_request=31', replied_by: person(2, 'Audreana Synthetic'), replied_at: '2026-11-17T00:00:00Z', excerpt: 'Check the condition first.', resolved: false },
      { kind: 'message', message_id: 91, direct_conversation_id: 12, author: person(2, 'Audreana Synthetic'), excerpt: 'Nice work on the conditionals exercise.', sent_at: '2026-11-17T00:00:00Z' },
    ] },
    waiting: { count: 2, items: [work(2, 'waiting'), work(3, 'waiting')] },
    recently_graded: [work(4, 'graded')], reviews_count: 39,
    questions: { count: 0, items: [] },
    next_session: { office_hour_id: 1, title: 'Week 11: Loops in practice', description: null, starts_at: '2026-11-21T23:00:00Z', ends_at: '2026-11-22T00:00:00Z', meeting_url: 'https://zoom.example.com/j/1', timezone: 'Pacific/Guam', recurrence: 'weekly', event_kind: 'live_class' },
    reviewer: person(2, 'Audreana Synthetic'), contact: person(2, 'Audreana Synthetic'), can_ask_for_plan: true, review_response_time: 'usually reviewed within 2 days',
    support: { mode: 'guided_help', live_support: true, ends_on: null, ended: false }, recently_added: [],
    ...overrides,
  }
}
const onDashboard = (today: Record<string, unknown> = studentToday()) => ({
  ...lanceDashboard, user: { id: 5, full_name: 'Alex Rivera', role: 'student' },
  cohort: { ...lanceDashboard.cohort, id: 9, name: 'Cohort 4', features: { student_experience_v2: true } },
  capabilities: { ...lanceDashboard.capabilities, features: { student_experience_v2: true } },
  support_instructor_id: 2, student_today: today,
})

let container: HTMLDivElement
let root: Root
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  localStorage.clear()
  mocks.getDashboard.mockResolvedValue({ data: { dashboard: lanceDashboard } })
  mocks.getWeeklyPlan.mockResolvedValue({ data: { weekly_plan: { enrolled: false, timezone: 'Pacific/Guam' } } })
  mocks.markNotificationRead.mockResolvedValue({ data: {} })
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks() })

const cohort = (id: number, v2: boolean) => ({ id, name: `Cohort ${id}`, features: { student_experience_v2: v2 }, capabilities: { features: { student_experience_v2: v2 } } })
function Where() { const location = useLocation(); return <p data-testid="where">{location.pathname}{location.search}</p> }

let renders = 0
async function render(path: string, element: ReactNode, routePath = '/dashboard') {
  await act(async () => {
    root.render(<MemoryRouter key={`${path}:${++renders}`} initialEntries={[path]}><Suspense fallback={null}><Routes><Route path={routePath} element={element} /><Route path="*" element={<Where />} /></Routes></Suspense></MemoryRouter>)
  })
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
  return container.innerHTML
}
const text = () => container.textContent || ''

it('with the switch off (Lance in Cohort 3), Today is exactly today’s Dashboard', async () => {
  state.cohort = { ready: true, selectedCohort: cohort(3, false), selectedCohortId: 3, error: null }
  const viaSwitch = await render('/dashboard', <TodayRoute />)
  const today = await render('/dashboard', <Dashboard />)
  expect(viaSwitch).toBe(today)
  expect(viaSwitch).toMatchSnapshot()
  expect(viaSwitch).toContain('Welcome back, Lance')
  expect(viaSwitch).toContain('Continue learning')
  expect(container.querySelector('[data-today="v2"]')).toBeNull()

  // A cohort list without the key (cached, or an older server) is not an explicit on.
  state.cohort = { ready: true, selectedCohort: { id: 3, name: 'Cohort 3', features: {}, capabilities: { features: {} } }, selectedCohortId: 3, error: null }
  expect(await render('/dashboard', <TodayRoute />)).toBe(today)
})

it('with the switch on, Today has one primary action, Needs you with quoted feedback, waiting work, grades and Join', async () => {
  state.cohort = { ready: true, selectedCohort: cohort(9, true), selectedCohortId: 9, error: null }
  mocks.getDashboard.mockResolvedValue({ data: { dashboard: onDashboard() } })
  await render('/dashboard?cohort_id=9', <TodayRoute />)
  expect(container.querySelector('[data-today="v2"]')).not.toBeNull()
  expect(mocks.getWeeklyPlan).not.toHaveBeenCalled()

  const hero = container.querySelector('[data-region="next-action"]')!
  expect(hero.textContent).toContain('Loops and Iteration')
  expect(hero.textContent).toContain('JavaScript Foundations · Week 10 · Lesson 4 of 5 · 155 of 243 lessons')
  // S-11: one primary action on the page.
  const primaries = [...container.querySelectorAll('a, button')].filter((element) => element.className.includes('bg-action-primary'))
  expect(primaries.map((element) => element.textContent)).toEqual(['Continue', 'Join'])
  expect(hero.querySelector('a[href="/lessons/404?cohort_id=9"]')?.textContent).toBe('Continue')

  const needs = container.querySelector('[data-region="today-needs"]')!
  expect(needs.textContent).toContain('Needs you3')
  expect(needs.querySelector('blockquote strong')?.textContent).toBe('resubmit')
  expect(needs.querySelector('a[href="/lessons/101?cohort_id=9#block-701"]')?.textContent).toBe('Open feedback and resubmit')
  const response = [...needs.querySelectorAll('a')].find((link) => link.textContent === 'View response')!
  expect(response.getAttribute('href')).toBe('/lessons/120?cohort_id=9&help_request=31')
  await act(async () => { response.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
  expect(mocks.markNotificationRead).toHaveBeenCalledWith(81)
})

it('lists counts that match their lists and link to My work, the reviewer and the next session beyond this week', async () => {
  state.cohort = { ready: true, selectedCohort: cohort(9, true), selectedCohortId: 9, error: null }
  mocks.getDashboard.mockResolvedValue({ data: { dashboard: onDashboard() } })
  await render('/dashboard?cohort_id=9', <TodayRoute />)
  expect(text()).toContain('Waiting on your instructor2')
  expect(text()).toContain('Audreana usually reviews within 2 days')
  expect(container.querySelector('a[href="/my-work?cohort_id=9&tab=waiting"]')).not.toBeNull()
  expect(text()).toContain('Recently graded')
  expect(text()).toContain('“Return the string instead, then resubmit.” · Audreana')
  expect(text()).toContain('Next live class')
  expect(container.querySelector('a[href="https://zoom.example.com/j/1"]')?.textContent).toBe('Join')
  expect(text()).toContain('3 of 5')
  // No stat cards, no dead "support unavailable" copy (U-5.5, U-6.7).
  expect(text()).not.toContain('isn’t available')
})

it('caps a long Needs you list at five with Show all', async () => {
  state.cohort = { ready: true, selectedCohort: cohort(9, true), selectedCohortId: 9, error: null }
  const items = Array.from({ length: 8 }, (_, index) => ({ ...work(index + 1, 'redo'), kind: 'redo' }))
  mocks.getDashboard.mockResolvedValue({ data: { dashboard: onDashboard(studentToday({ needs_you: { count: 8, items } })) } })
  await render('/dashboard?cohort_id=9', <TodayRoute />)
  const needs = container.querySelector('[data-region="today-needs"]')!
  const button = [...needs.querySelectorAll('button')].find((element) => element.textContent?.startsWith('Show all'))!
  expect(button.textContent).toBe('Show all 8')
  expect(button.getAttribute('aria-expanded')).toBe('false')
  await act(async () => { button.click() })
  expect(button.getAttribute('aria-expanded')).toBe('true')
  expect(button.textContent).toBe('Show fewer')
})

it('behind with no agreed plan: how far behind, the next required lesson and Ask for a plan, never a suggestion', async () => {
  state.cohort = { ready: true, selectedCohort: cohort(9, true), selectedCohortId: 9, error: null }
  mocks.getDashboard.mockResolvedValue({ data: { dashboard: onDashboard(studentToday({ pace: { behind: true, weeks_behind: 3, overdue_count: 14 } })) } })
  mocks.createDirectConversation.mockResolvedValue({ data: { direct_conversation: { id: 12, cohort_id: 9 } } })
  await render('/dashboard?cohort_id=9', <TodayRoute />)
  const hero = container.querySelector('[data-region="next-action"]')!
  expect(hero.textContent).toContain('You’re about 3 weeks behind.')
  expect(hero.textContent).not.toContain('Catch-up plan')
  const ask = [...hero.querySelectorAll('button')].find((element) => element.textContent === 'Ask Audreana for a catch-up plan')!
  await act(async () => { ask.click() })
  await act(async () => { await Promise.resolve() })
  expect(mocks.createDirectConversation).toHaveBeenCalledWith({ cohort_id: 9, user_ids: [2] })
  expect(container.querySelector('[data-testid="where"]')?.textContent).toBe('/messages/dm/12?cohort_id=9')
})

it('an agreed plan shows who agreed it, five of its lessons, Show all in place and Ask to change it', async () => {
  state.cohort = { ready: true, selectedCohort: cohort(9, true), selectedCohortId: 9, error: null }
  const items = Array.from({ length: 14 }, (_, index) => ({ lesson_id: 500 + index, title: `Plan lesson ${index + 1}`, kind: 'exercise', due_on: `2026-11-${20 + Math.floor(index / 2)}`, available: true, status: 'open' }))
  const plan = { title: 'Catch up by December', target_date: '2026-11-28', agreed_at: '2026-11-12T00:00:00Z', agreed_by: person(2, 'Audreana Synthetic'), remaining_count: 14, items }
  mocks.getDashboard.mockResolvedValue({ data: { dashboard: onDashboard(studentToday({ pace: { behind: true, weeks_behind: 3, overdue_count: 14 }, catch_up_plan: plan })) } })
  await render('/dashboard?cohort_id=9', <TodayRoute />)
  const hero = container.querySelector('[data-region="next-action"]')!
  expect(hero.textContent).toContain('Catch-up plan · agreed with Audreana')
  expect(hero.textContent).toContain('You’re about 3 weeks behind. Your plan gets you caught up by Sat, Nov 28.')
  expect(hero.querySelectorAll('ol li')).toHaveLength(5)
  const showAll = [...hero.querySelectorAll('button')].find((element) => element.textContent === 'Show all 14')!
  expect(showAll.getAttribute('aria-expanded')).toBe('false')
  await act(async () => { showAll.click() })
  expect(showAll.getAttribute('aria-expanded')).toBe('true')
  expect(hero.querySelectorAll('ol li')).toHaveLength(14)
  expect(hero.querySelector('a[aria-label="Continue with Loops and Iteration"]')?.getAttribute('href')).toBe('/lessons/404?cohort_id=9')
  expect(hero.textContent).toContain('Ask Audreana to change it')
})

it('paused: says since when, that work is saved and how to resume, with no next step or Join', async () => {
  state.cohort = { ready: true, selectedCohort: cohort(9, true), selectedCohortId: 9, error: null }
  mocks.getDashboard.mockResolvedValue({ data: { dashboard: { ...onDashboard(studentToday({ paused: true, read_only: true, pace: null, this_week: null, next_session: null, needs_you: { count: 0, items: [] }, waiting: { count: 0, items: [] } })), enrollment_status: 'paused', paused_since: '2026-10-02' } } })
  await render('/dashboard?cohort_id=9', <TodayRoute />)
  const hero = container.querySelector('[data-region="next-action"]')!
  expect(hero.textContent).toContain('Paused since Oct 2')
  expect(hero.textContent).toContain('Your work is saved: 155 lessons completed')
  expect(hero.textContent).toContain('Where you left off')
  expect(hero.textContent).toContain('read only while paused')
  expect(container.querySelector('h1')?.textContent).toBe('Hi, Alex')
  expect(text()).not.toContain('Join')
  expect(text()).not.toContain('Continue')
})

it('the library has no progress or next step; switched-off features leave no card', async () => {
  state.cohort = { ready: true, selectedCohort: cohort(9, true), selectedCohortId: 9, error: null }
  mocks.getDashboard.mockResolvedValue({ data: { dashboard: onDashboard(studentToday({ mode: 'library', counts: null, next_lesson: null, pace: null, this_week: null, next_session: null, course_week: null, recently_added: [{ id: 7, title: 'Git basics', kind: 'reading' }], needs_you: { count: 0, items: [] }, waiting: { count: 0, items: [] }, recently_graded: [] })) } })
  await render('/dashboard?cohort_id=9', <TodayRoute />)
  expect(text()).toContain('CSG Alumni library')
  expect(text()).not.toContain('lessons ·')
  expect(text()).not.toContain('Needs you')
  expect(text()).not.toContain('Office hours')
  expect(text()).not.toContain('Your instructor')
})

it('a payload without student_today (an older server) shows today’s Dashboard', async () => {
  state.cohort = { ready: true, selectedCohort: cohort(9, true), selectedCohortId: 9, error: null }
  mocks.getDashboard.mockResolvedValue({ data: { dashboard: { ...onDashboard(), student_today: undefined } } })
  await render('/dashboard?cohort_id=9', <TodayRoute />)
  expect(container.querySelector('[data-today="v2"]')).toBeNull()
  expect(text()).toContain('Welcome back, Alex')
})

it('My work is only in the new experience; off, its address goes to Today', async () => {
  state.cohort = { ready: true, selectedCohort: cohort(3, false), selectedCohortId: 3, error: null }
  await render('/my-work?cohort_id=3', <MyWorkRoute />, '/my-work')
  expect(container.querySelector('[data-testid="where"]')?.textContent).toBe('/dashboard?cohort_id=3')
  state.cohort = { ready: true, selectedCohort: cohort(9, true), selectedCohortId: 9, error: null }
  await render('/my-work?cohort_id=9', <MyWorkRoute />, '/my-work')
  expect(container.querySelector('[data-testid="my-work"]')).not.toBeNull()
})

// Fix round (review P2s and CodeRabbit).
async function renderStable(path: string, element: ReactNode) {
  await act(async () => {
    root.render(<MemoryRouter key="stable" initialEntries={[path]}><Suspense fallback={null}><Routes><Route path="/dashboard" element={element} /><Route path="*" element={<Where />} /></Routes></Suspense></MemoryRouter>)
  })
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
}

it.each([false, true])('requests the dashboard at once while the switch is unknown, then reuses it (switch %s)', async (v2) => {
  state.cohort = { ready: false, selectedCohort: null, selectedCohortId: v2 ? 9 : 3, error: null }
  if (v2) mocks.getDashboard.mockResolvedValue({ data: { dashboard: onDashboard() } })
  await renderStable(`/dashboard?cohort_id=${v2 ? 9 : 3}`, <TodayRoute />)
  expect(mocks.getDashboard).toHaveBeenCalledTimes(1)
  expect(mocks.getDashboard).toHaveBeenCalledWith(v2 ? 9 : 3)
  // Until the switch is known: the loading state only, never either view.
  expect(container.querySelector('[data-today="v2"]')).toBeNull()
  expect(text()).not.toContain('Welcome back')
  state.cohort = { ready: true, selectedCohort: cohort(v2 ? 9 : 3, v2), selectedCohortId: v2 ? 9 : 3, error: null }
  await renderStable(`/dashboard?cohort_id=${v2 ? 9 : 3}`, <TodayRoute />)
  expect(container.querySelector('[data-today="v2"]') !== null).toBe(v2)
  if (!v2) expect(text()).toContain('Welcome back, Lance')
  expect(mocks.getDashboard).toHaveBeenCalledTimes(1)
})

it('a failed load for another cohort shows the error, not the last cohort’s Today', async () => {
  state.cohort = { ready: true, selectedCohort: cohort(9, true), selectedCohortId: 9, error: null }
  mocks.getDashboard.mockResolvedValueOnce({ data: { dashboard: onDashboard() } }).mockResolvedValueOnce({ data: null, error: 'You are offline.' })
  await renderStable('/dashboard?cohort_id=9', <TodayRoute />)
  expect(text()).toContain('Needs you')
  state.cohort = { ready: true, selectedCohort: cohort(11, true), selectedCohortId: 11, error: null }
  await renderStable('/dashboard?cohort_id=11', <TodayRoute />)
  expect(text()).toContain('Could not load Today')
  expect(text()).not.toContain('Needs you')
})

it('the plan’s Continue goes to the server’s next step, not a closed redo at the top of the plan', async () => {
  state.cohort = { ready: true, selectedCohort: cohort(9, true), selectedCohortId: 9, error: null }
  const items = [
    { lesson_id: 600, title: 'Closed redo', kind: 'exercise', due_on: '2026-11-20', available: true, status: 'redo' },
    { lesson_id: 404, title: 'Loops and Iteration', kind: 'exercise', due_on: '2026-11-21', available: true, status: 'open' },
  ]
  const plan = { title: 'Catch up', target_date: '2026-11-28', agreed_at: '2026-11-12T00:00:00Z', agreed_by: person(2, 'Audreana Synthetic'), remaining_count: 2, items }
  mocks.getDashboard.mockResolvedValue({ data: { dashboard: onDashboard(studentToday({ catch_up_plan: plan, contact: person(2, 'Audreana Synthetic'), can_ask_for_plan: true })) } })
  await render('/dashboard?cohort_id=9', <TodayRoute />)
  const hero = container.querySelector('[data-region="next-action"]')!
  const continueLink = [...hero.querySelectorAll('a')].find((link) => link.textContent?.startsWith('Continue your plan'))!
  expect(continueLink.getAttribute('href')).toBe('/lessons/404?cohort_id=9')
})

it('no catch-up ask without learning plans, and no message actions without anyone reachable', async () => {
  state.cohort = { ready: true, selectedCohort: cohort(9, true), selectedCohortId: 9, error: null }
  mocks.getDashboard.mockResolvedValue({ data: { dashboard: onDashboard(studentToday({ pace: { behind: true, weeks_behind: 3, overdue_count: 9 }, contact: person(2, 'Audreana Synthetic'), can_ask_for_plan: false })) } })
  await render('/dashboard?cohort_id=9', <TodayRoute />)
  expect(text()).toContain('You’re about 3 weeks behind.')
  expect(text()).not.toContain('catch-up plan')
  expect(text()).toContain('Message Audreana')

  mocks.getDashboard.mockResolvedValue({ data: { dashboard: onDashboard(studentToday({ pace: { behind: true, weeks_behind: 3, overdue_count: 9 }, contact: null, can_ask_for_plan: false })) } })
  await render('/dashboard?cohort_id=9', <TodayRoute />)
  expect(text()).not.toContain('Message Audreana')
  expect(container.querySelector('a[href^="mailto:"]')?.textContent).toContain('Contact')
  expect(text()).toContain('Audreana Synthetic')
})

it('six waiting questions: five shown, then Show all 6', async () => {
  state.cohort = { ready: true, selectedCohort: cohort(9, true), selectedCohortId: 9, error: null }
  const items = Array.from({ length: 6 }, (_, index) => ({ id: 40 + index, status: 'open', context_label: `Lesson ${index}`, message: `Question ${index}`, created_at: '2026-11-17T00:00:00Z', path: `/lessons/${index + 1}?cohort_id=9&help_request=${40 + index}` }))
  mocks.getDashboard.mockResolvedValue({ data: { dashboard: onDashboard(studentToday({ questions: { count: 6, items } })) } })
  await render('/dashboard?cohort_id=9', <TodayRoute />)
  const section = container.querySelector('[data-region="today-questions"]')!
  expect(section.querySelectorAll('li')).toHaveLength(5)
  const showAll = [...section.querySelectorAll('button')].find((button) => button.textContent === 'Show all 6')!
  await act(async () => { showAll.click() })
  expect(section.querySelectorAll('li')).toHaveLength(6)
})

it('first run replaces both the hero and purchase Start here with one enrollment welcome', async () => {
  state.cohort = { ready: true, selectedCohort: cohort(9, true), selectedCohortId: 9, cohorts: [], error: null }
  mocks.getDashboard.mockResolvedValue({ data: { dashboard: { ...onDashboard(studentToday({ first_run: true, mode: 'self_paced', support: { mode: 'course_question', ends_on: '2026-12-26', ended: false } })), start_here: true } } })
  mocks.dismissStartHere.mockResolvedValue({ data: { dismissed: true } })
  await render('/dashboard?cohort_id=9', <TodayRoute />)
  expect(text()).toContain('Welcome, Alex')
  expect(container.querySelectorAll('[data-region="next-action"]')).toHaveLength(1)
  expect(text()).not.toContain('Got it, let’s start')
  expect(text()).toContain('Dec 26')
  expect(text()).not.toContain('PM ChST')
  expect(container.querySelector('a[href="/lessons/404?cohort_id=9"]')?.textContent).toContain('Start Loops')
  expect(text()).toContain('Ask a question')
  const dismiss = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Dismiss welcome')!
  await act(async () => dismiss.click())
  expect(mocks.dismissStartHere).toHaveBeenCalledWith(9)
  expect(text()).not.toContain('Here’s how your course works')
})

it('Alumni Today points to active work in other courses and keeps library framing', async () => {
  state.cohort = { ready: true, selectedCohort: cohort(9, true), selectedCohortId: 9, cohorts: [{ id: 3, name: 'Cohort 3', cohort_type: 'bootcamp', enrollment_status: 'active' }], error: null }
  mocks.getDashboard.mockResolvedValue({ data: { dashboard: onDashboard(studentToday({ mode: 'library', read_only: true, counts: null, next_lesson: null, continue_watching: { title: 'Workshop', path: '/recordings?cohort_id=9&recording=10' } })) } })
  await render('/dashboard?cohort_id=9', <TodayRoute />)
  expect(text()).toContain('Continue watching: Workshop')
  expect(container.querySelector('a[href="/dashboard?cohort_id=3"]')?.textContent).toContain('Today in Cohort 3')
  expect(text()).not.toContain('0 of 80')
})

it('a failed welcome dismissal stays visible and retries the same enrollment', async () => {
  state.cohort = { ready: true, selectedCohort: cohort(9, true), selectedCohortId: 9, error: null }
  mocks.getDashboard.mockResolvedValue({ data: { dashboard: onDashboard(studentToday({ first_run: true })) } })
  mocks.dismissStartHere.mockResolvedValueOnce({ error: 'Offline' }).mockResolvedValueOnce({ data: { dismissed: true } })
  await render('/dashboard?cohort_id=9', <TodayRoute />)
  const dismiss = () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Dismiss welcome')!
  await act(async () => dismiss().click())
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Could not save')
  expect(text()).toContain('Here’s how your course works')
  await act(async () => dismiss().click())
  expect(mocks.dismissStartHere).toHaveBeenNthCalledWith(2, 9)
  expect(text()).not.toContain('Here’s how your course works')
})

it('a late dismissal cannot dismiss the next enrollment’s welcome', async () => {
  let finish!: (value: unknown) => void
  mocks.dismissStartHere.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  mocks.getDashboard.mockImplementation(async (id: number) => ({ data: { dashboard: { ...onDashboard(studentToday({ first_run: true, counts: { completed_lessons: 0, total_lessons: 2 } })), cohort: { id, name: `Course ${id}`, features: { student_experience_v2: true } } } } }))
  const stable = async () => { await act(async () => root.render(<MemoryRouter initialEntries={['/dashboard']}><TodayRoute /></MemoryRouter>)) }
  state.cohort = { ready: true, selectedCohort: cohort(9, true), selectedCohortId: 9, error: null }
  await stable()
  const dismiss = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Dismiss welcome')!
  await act(async () => dismiss.click())
  state.cohort = { ready: true, selectedCohort: cohort(11, true), selectedCohortId: 11, error: null }
  await stable()
  expect(text()).toContain('Course 11')
  expect(text()).toContain('Follow the class schedule')
  await act(async () => finish({ data: { dismissed: true } }))
  expect(text()).toContain('Here’s how your course works')
  expect(container.querySelector('[data-region="next-action"]')?.textContent).toContain('Dismiss welcome')
})

it.each([false, true])('first-run support date describes whether support ended (%s)', async (ended) => {
  state.cohort = { ready: true, selectedCohort: cohort(9, true), selectedCohortId: 9, error: null }
  mocks.getDashboard.mockResolvedValue({ data: { dashboard: onDashboard(studentToday({ first_run: true, mode: 'self_paced', support: { mode: ended ? 'none' : 'course_question', ends_on: '2026-12-26', ended } })) } })
  await render('/dashboard?cohort_id=9', <TodayRoute />)
  const welcome = container.querySelector('[aria-labelledby="welcome-title"]')!
  expect(welcome.textContent).toContain(ended ? 'Support ended on Dec 26, 2026.' : 'Support until Dec 26, 2026.')
  expect(welcome.textContent).not.toContain(ended ? 'Support until' : 'Support ended on')
})
