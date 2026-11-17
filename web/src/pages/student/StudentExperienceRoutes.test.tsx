// @vitest-environment jsdom
import { act, Suspense, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

/*
 * W8 PR 8.1: the "New student experience" switch. Off, Learn, a module and the
 * cohort page render exactly today's components with today's markup (Cohort 3
 * keeps the current experience until it is turned on); on, they become the one
 * course outline.
 */
const state = vi.hoisted(() => ({ cohort: {} as Record<string, unknown>, auth: { user: { id: 4, is_staff: false }, enrollments: [], schoolFeatures: {} } }))
const mocks = vi.hoisted(() => ({ getDashboard: vi.fn(), getCourseOutline: vi.fn(), getModule: vi.fn(), getCohortHome: vi.fn() }))
vi.mock('../../lib/api', () => ({ api: mocks }))
vi.mock('../../contexts/CohortContext', () => ({ useCohortContext: () => state.cohort }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => state.auth }))
vi.mock('../../lib/routePreload', async () => ({
  Materials: (await import('./Materials')).Materials,
  ModuleView: (await import('./ModuleView')).ModuleView,
  CourseOutline: () => <p data-testid="new-outline">New outline</p>,
}))

import { CohortHomeRoute, LearnRoute, ModuleRoute } from './StudentExperienceRoutes'
import { Materials } from './Materials'
import { ModuleView } from './ModuleView'

const dashboard = {
  enrolled: true, user: { id: 4, full_name: 'Lance Example', role: 'student' }, enrollment_status: 'active',
  cohort: { id: 3, name: 'Cohort 3', cohort_type: 'bootcamp', features: { student_experience_v2: false } },
  overall_progress: { completed: 1, total: 2, percentage: 50, completed_lessons: 1, total_lessons: 2 },
  modules: [{ id: 5, name: 'JavaScript Foundations', module_type: 'live_class', available: true, total_blocks: 2, completed_blocks: 1, progress_percentage: 50, completed_lessons: 1, total_lessons: 2, assigned: true, unlocked: true, unlock_date: null,
    lessons: [
      { id: 11, title: 'Intro to Functions', lesson_type: 'exercise', kind: 'reading', available: true, unlock_date: null, completed: true, total_blocks: 1, completed_blocks: 1, learner_status: 'done', review_status: null, submission_window: null },
      { id: 12, title: 'Loops and Iteration', lesson_type: 'exercise', kind: 'exercise', available: true, unlock_date: null, completed: false, total_blocks: 1, completed_blocks: 0, learner_status: 'open', review_status: null, submission_window: null },
    ] }],
  action_items: [],
}

let container: HTMLDivElement
let root: Root
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  localStorage.clear()
  mocks.getDashboard.mockResolvedValue({ data: { dashboard } })
  mocks.getModule.mockResolvedValue({ data: { module: { id: 5, name: 'JavaScript Foundations', module_type: 'live_class', description: null, lessons: [{ id: 11, title: 'Intro to Functions', lesson_type: 'exercise', position: 0, release_day: 0, required: true, available: true }] } } })
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks() })

const cohort = (v2: boolean) => ({ id: 3, name: 'Cohort 3', features: { student_experience_v2: v2 }, capabilities: { features: { student_experience_v2: v2 } } })
function Where() { const location = useLocation(); return <p data-testid="where">{location.pathname}{location.search}</p> }

let renders = 0
async function render(path: string, element: ReactNode, routePath: string) {
  await act(async () => {
    root.render(<MemoryRouter key={`${routePath}:${path}:${++renders}`} initialEntries={[path]}><Suspense fallback={null}><Routes><Route path={routePath} element={element} /><Route path="/materials" element={<Where />} /></Routes></Suspense></MemoryRouter>)
  })
  await act(async () => { await Promise.resolve() })
  return container.innerHTML
}

it('with the switch off, Learn and a module render exactly today’s pages', async () => {
  state.cohort = { ready: true, selectedCohort: cohort(false), selectedCohortId: 3, error: null }
  const viaSwitch = await render('/materials?cohort_id=3', <LearnRoute />, '/materials')
  const today = await render('/materials?cohort_id=3', <Materials />, '/materials')
  expect(viaSwitch).toBe(today)
  expect(viaSwitch).toContain('Loops and Iteration')
  expect(viaSwitch).toContain('Expand all')
  expect(container.querySelector('[data-testid="new-outline"]')).toBeNull()
  expect(mocks.getCourseOutline).not.toHaveBeenCalled()

  const moduleViaSwitch = await render('/modules/5?cohort_id=3', <ModuleRoute />, '/modules/:id')
  const moduleToday = await render('/modules/5?cohort_id=3', <ModuleView />, '/modules/:id')
  expect(moduleViaSwitch).toBe(moduleToday)
  expect(moduleViaSwitch).toContain('Intro to Functions')
})

it('with the switch off, the cohort page is today’s cohort home', async () => {
  state.cohort = { ready: true, selectedCohort: cohort(false), selectedCohortId: 3, error: null }
  mocks.getCohortHome.mockResolvedValue({ data: { home: { cohort: { id: 3, name: 'Cohort 3', status: 'active', curriculum_name: 'Bootcamp', workspace_id: 8 }, own_progress_percentage: 50, upcoming_events: [], recent_announcements: [] } } })
  const html = await render('/cohorts/3', <CohortHomeRoute />, '/cohorts/:id')
  expect(html).toContain('Your progress')
  expect(container.querySelector('a[href="/materials?cohort_id=3"]')?.textContent).toContain('Go to Learn')
})

it('with the switch on, Learn is the course outline and modules and the cohort page open it', async () => {
  state.cohort = { ready: true, selectedCohort: cohort(true), selectedCohortId: 3, error: null }
  await render('/materials?cohort_id=3', <LearnRoute />, '/materials')
  expect(container.querySelector('[data-testid="new-outline"]')).not.toBeNull()
  expect(mocks.getDashboard).not.toHaveBeenCalled()

  await render('/modules/5?cohort_id=3', <ModuleRoute />, '/modules/:id')
  expect(container.querySelector('[data-testid="where"]')?.textContent).toBe('/materials?cohort_id=3&module=5')
  expect(mocks.getModule).not.toHaveBeenCalled()

  await render('/cohorts/3', <CohortHomeRoute />, '/cohorts/:id')
  expect(container.querySelector('[data-testid="where"]')?.textContent).toBe('/materials?cohort_id=3')
})

it('shows neither view until the cohort’s switch is known', async () => {
  state.cohort = { ready: false, selectedCohort: null, selectedCohortId: 3, error: null }
  await render('/materials?cohort_id=3', <LearnRoute />, '/materials')
  expect(container.textContent).toContain('Loading Learn…')
  expect(mocks.getDashboard).not.toHaveBeenCalled()
  expect(container.querySelector('[data-testid="new-outline"]')).toBeNull()
})

it('a cached cohort without the switch keeps today’s Learn', async () => {
  state.cohort = { ready: true, selectedCohort: { id: 3, name: 'Cohort 3', features: { recordings: true }, capabilities: { features: { recordings: true } } }, selectedCohortId: 3, error: null }
  await render('/materials?cohort_id=3', <LearnRoute />, '/materials')
  expect(container.textContent).toContain('Expand all')
  expect(container.querySelector('[data-testid="new-outline"]')).toBeNull()
})

it('a failed switch lookup shows today’s Learn with a notice and Retry, not a spinner', async () => {
  const refreshCohorts = vi.fn()
  state.cohort = { ready: true, selectedCohort: null, selectedCohortId: 3, error: 'Could not load your cohorts.', refreshCohorts }
  await render('/materials?cohort_id=3', <LearnRoute />, '/materials')
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('couldn’t load your course settings')
  expect(container.textContent).not.toContain('Loading Learn…')
  expect(container.textContent).toContain('Expand all')
  await act(async () => Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Try again')!.click())
  expect(refreshCohorts).toHaveBeenCalledTimes(1)
})

it('stops waiting for a slow switch lookup and shows today’s Learn with Retry', async () => {
  vi.useFakeTimers()
  try {
    state.cohort = { ready: false, selectedCohort: null, selectedCohortId: 3, error: null, refreshCohorts: vi.fn() }
    await render('/materials?cohort_id=3', <LearnRoute />, '/materials')
    expect(container.textContent).toContain('Loading Learn…')
    await act(async () => { vi.advanceTimersByTime(10_000) })
    await act(async () => { await vi.runOnlyPendingTimersAsync() })
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('taking a while')
    expect(container.textContent).not.toContain('Loading Learn…')
    expect(container.querySelector('[data-testid="new-outline"]')).toBeNull()
  } finally {
    vi.useRealTimers()
  }
})
