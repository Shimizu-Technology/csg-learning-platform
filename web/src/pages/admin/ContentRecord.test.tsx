// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { CurriculumUsage, LessonUsage, ModuleUsage } from '../../types/api'

// L-5: staff record pages for a curriculum, a module and a lesson. Each has a
// record header with a Back link and breadcrumb, "Used in" with only the
// cohorts the server listed (others as a bare number), and a related panel.

const mocks = vi.hoisted(() => ({
  user: { id: 1, is_staff: true, is_admin: false } as { id: number; is_staff: boolean; is_admin: boolean },
  getRecordUsage: vi.fn(),
}))
vi.mock('../../lib/api', () => ({ api: { getRecordUsage: mocks.getRecordUsage, getRecordSummary: vi.fn() } }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: mocks.user }) }))

import { CurriculumRecord, LessonRecord, ModuleRecord } from './ContentRecord'

const teal = { id: 4, name: 'Cohort Teal', status: 'active' as const, course_delivery: 'program' as const, start_date: '2026-11-10', end_date: '2027-02-01', on_sale: false }
const lesson: LessonUsage = {
  type: 'lesson', id: 40, title: 'Make decisions', lesson_type: 'exercise', required: true, archived: false, release_day: 2, week: 1, day_name: 'Wednesday',
  curriculum: { id: 1, name: 'Usage curriculum' }, module: { id: 7, name: 'JavaScript basics' }, can_edit: false,
  blocks: [{ id: 81, block_type: 'text', title: 'Why decisions matter', has_work: false }, { id: 82, block_type: 'exercise', title: 'Ticket prices', has_work: true }],
  objectives: [{ id: 5, code: 'JS.4', title: 'Choose a branch' }],
  cohorts: [{ ...teal, assigned: true, release_date: '2026-11-12', submissions: 2, waiting: 1, open_help: 1 }],
  other_cohorts_count: 1,
  help_requests: [{ id: 55, status: 'open', urgency: 'urgent', category: 'concept', cohort_id: 4, created_at: '2026-11-16T09:00:00Z', student: { id: 9, name: 'Alex Rivera' } }],
  totals: { submissions: 2, waiting: 1, open_help: 1 },
}
const mod: ModuleUsage = {
  type: 'module', id: 7, name: 'JavaScript basics', description: null, module_type: 'live_class', scheduled_day_names: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
  week_count: 2, curriculum: { id: 1, name: 'Usage curriculum' }, can_edit: false,
  lessons: [
    { id: 40, title: 'Make decisions', lesson_type: 'exercise', release_day: 2, week: 1, day_name: 'Wednesday', required: true, archived: false, has_work: true },
    { id: 41, title: 'Loops', lesson_type: 'lesson', release_day: 7, week: 2, day_name: 'Monday', required: false, archived: false, has_work: false },
  ],
  cohorts: [{ ...teal, assigned: true, starts_on: '2026-11-10', ends_on: '2026-11-17', submissions: 2, waiting: 1, open_help: null }],
  other_cohorts_count: 0,
  totals: { submissions: 2, waiting: 1, open_help: null },
}
const curriculum: CurriculumUsage = {
  type: 'curriculum', id: 1, name: 'Usage curriculum', description: 'Synthetic course', status: 'active', total_weeks: 12, imported: true, package_revision: 'r7', can_edit: true,
  modules: [{ id: 7, name: 'JavaScript basics', module_type: 'live_class', position: 0, scheduled_day_names: ['Monday'], lessons_count: 2 }],
  cohorts: [
    { ...teal, students: 12, waiting: 3, open_help: 0 },
    { id: 6, name: 'Cohort Sand', status: 'active', course_delivery: 'self_paced', start_date: '2026-11-01', end_date: null, on_sale: true, students: 4, waiting: 0, open_help: 0 },
  ],
  other_cohorts_count: 0,
  copy_of: null,
  copies: [{ id: 3, cohort: { id: 8, name: 'Cohort Coral' }, copy_curriculum: { id: 9, name: "Cohort Coral's copy" }, created_by: { id: 2, name: 'Ada Admin' }, created_at: '2026-11-16T00:00:00Z', lessons_count: 18 }],
  other_copies_count: 0,
  rubrics: [{ id: 11, title: 'Ticket rubric', active: true, criteria_count: 2, lessons: [{ id: 40, title: 'Make decisions', module_id: 7, archived: false }] }],
  objectives: [{ id: 5, code: 'JS.4', title: 'Choose a branch', active: true, lessons: [] }],
  totals: { waiting: 3, open_help: 0, resources: 2 },
}

let container: HTMLDivElement
let root: Root
let router: ReturnType<typeof createMemoryRouter>
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

beforeEach(() => {
  mocks.user = { id: 1, is_staff: true, is_admin: false }
  mocks.getRecordUsage.mockImplementation(async (type: string) => ({ data: { usage: { lesson, module: mod, curriculum }[type] }, error: null, status: 200 }))
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks() })

async function mount(entry: string | { pathname: string; search?: string; state?: unknown }) {
  router = createMemoryRouter([
    { path: '/admin/lessons/:id', element: <LessonRecord /> },
    { path: '/admin/modules/:id', element: <ModuleRecord /> },
    { path: '/admin/curricula/:id', element: <CurriculumRecord /> },
    { path: '*', element: <p>Elsewhere</p> },
  ], { initialEntries: [entry] })
  await act(async () => root.render(<RouterProvider router={router} />))
  await flush()
}

const href = (selector: string) => container.querySelector(selector)?.getAttribute('href')
const crumbs = () => Array.from(container.querySelectorAll('nav[aria-label="Breadcrumb"] li')).map((item) => item.textContent)
const row = (key: string) => container.querySelector(`[data-related-row="${key}"]`)

it('a lesson page shows what it is, where it is used for this instructor, its work and help, and links to edit and view as student', async () => {
  await mount({ pathname: '/admin/lessons/40', search: '?cohort_id=4&return_to=%2Fadmin%2Fgrading%3Ffilter%3Dall' })
  expect(mocks.getRecordUsage).toHaveBeenCalledWith('lesson', 40)
  expect(container.querySelector('h1')?.textContent).toBe('Make decisions')
  expect(container.querySelector('[data-record-type]')?.textContent).toBe('Lesson · Week 1, Wed · Required')
  expect(container.querySelector('[data-back-link]')?.textContent).toBe('Back to Grading · All submissions')
  expect(crumbs()).toEqual(['Usage curriculum', 'JavaScript basics', 'Make decisions'])
  expect(href('nav[aria-label="Breadcrumb"] a')).toBe('/admin/curricula/1')

  // Used in: the one cohort the instructor teaches, highlighted as the page's cohort, and the rest as a number.
  const used = container.querySelector('#used-in')!
  expect(used.querySelectorAll('[data-used-in-cohort]')).toHaveLength(1)
  expect(used.querySelector('[data-used-in-cohort="4"]')?.getAttribute('aria-current')).toBe('true')
  expect(used.textContent).toContain('Live program · Opened Thu, Nov 12')
  expect(used.querySelector('[data-other-cohorts]')?.textContent).toBe("1 other cohort uses this curriculum. You don't teach it, so it isn’t listed or counted here.")
  expect(href('#used-in a[href^="/admin/grading"][href*="filter=all"]')).toBe('/admin/grading?cohort_id=4&lesson_id=40&filter=all')
  expect(href('#used-in a[aria-label="View as student in Cohort Teal"]')).toBe('/admin/cohorts/4/student-view/lessons/40')

  // Header actions: an instructor without editing access reads it in the editor; View as student uses the page's cohort.
  const actions = Array.from(container.querySelectorAll('[data-record-header] a')).map((link) => [link.textContent, link.getAttribute('href')])
  expect(actions).toContainEqual(['View as student', '/admin/cohorts/4/student-view/lessons/40'])
  expect(actions).toContainEqual(['Open in editor', '/admin/lessons/40/edit'])

  expect(container.textContent).toContain('Why decisions matter')
  expect(container.textContent).toContain('JS.4')
  expect(container.querySelector('#help a[data-record-link="help_request"]')?.textContent).toBe("Alex Rivera's question")
  expect(row('submissions')?.querySelector('a')?.getAttribute('href')).toBe('/admin/grading?cohort_id=4&lesson_id=40&filter=all')
  expect(row('waiting')?.textContent).toContain('1')
  expect(row('curriculum')?.querySelector('a')?.getAttribute('href')).toBe('/admin/curricula/1')
})

it('an admin who can edit sees Edit lesson', async () => {
  mocks.user = { id: 2, is_staff: true, is_admin: true }
  mocks.getRecordUsage.mockResolvedValueOnce({ data: { usage: { ...lesson, can_edit: true, other_cohorts_count: 0 } }, error: null, status: 200 })
  await mount('/admin/lessons/40')
  const edit = Array.from(container.querySelectorAll('[data-record-header] a')).find((link) => link.textContent === 'Edit lesson')
  expect(edit?.getAttribute('href')).toBe('/admin/lessons/40/edit')
  expect(container.querySelector('[data-other-cohorts]')).toBeNull()
  // No history: Back goes to the lesson's module.
  expect(container.querySelector('[data-back-link]')?.textContent).toBe('Back to JavaScript basics')
  expect(href('[data-back-link]')).toBe('/admin/modules/7')
})

it('a record the viewer may not see, or that does not exist, shows No access', async () => {
  mocks.getRecordUsage.mockResolvedValueOnce({ data: null, error: 'Not found', status: 404 })
  await mount('/admin/lessons/99')
  expect(container.textContent).toContain('No access')
  expect(container.querySelector('h1')?.textContent).not.toBe('Make decisions')
})

it('a failed load explains itself and retries', async () => {
  mocks.getRecordUsage.mockResolvedValueOnce({ data: null, error: 'Network error', status: 0 })
  await mount('/admin/modules/7')
  expect(container.textContent).toContain("Couldn't load this module")
  const retry = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Try again')!
  await act(async () => retry.click())
  await flush()
  expect(container.querySelector('h1')?.textContent).toBe('JavaScript basics')
})

it('a module page lists lessons by week and each cohort schedule with its module grading', async () => {
  await mount('/admin/modules/7')
  expect(crumbs()).toEqual(['Usage curriculum', 'JavaScript basics'])
  expect(container.querySelector('[data-back-link]')?.textContent).toBe('Back to Usage curriculum')
  expect(Array.from(container.querySelectorAll('#lessons h3')).map((heading) => heading.textContent)).toEqual(['Week 1', 'Week 2'])
  expect(href('#lessons a[data-record-link="lesson"]')).toMatch(/^\/admin\/lessons\/40/)
  const used = container.querySelector('#used-in')!
  expect(used.textContent).toContain('Cohort schedules')
  expect(used.textContent).toContain('Tue, Nov 10 to Tue, Nov 17')
  expect(href('#used-in a[href$="/modules/7/grading"]')).toBe('/admin/cohorts/4/modules/7/grading')
  // Help is switched off there: no help count and no help row.
  expect(used.textContent).not.toContain('open help')
  expect(row('help')).toBeNull()
  expect(row('lessons')?.textContent).toContain('2')
})

it('a curriculum page lists cohorts with delivery, modules, copy history, rubrics and objectives', async () => {
  await mount('/admin/curricula/1')
  expect(container.querySelector('[data-record-type]')?.textContent).toBe('Curriculum · Imported course package r7')
  expect(container.querySelector('[data-back-link]')?.textContent).toBe('Back to Content')
  const used = container.querySelector('#used-in')!
  expect(used.textContent).toContain('Live program')
  expect(used.textContent).toContain('Self-paced')
  expect(used.textContent).toContain('On sale')
  expect(used.textContent).toContain('12 active students')
  expect(href('#modules a[data-record-link="module"]')).toBe('/admin/modules/7?return_to=%2Fadmin%2Fcurricula%2F1')
  expect(container.querySelector('#copies')?.textContent).toContain("Cohort Coral's copy")
  expect(href('#copies a[data-record-link="curriculum"]')).toBe('/admin/curricula/9?return_to=%2Fadmin%2Fcurricula%2F1')
  expect(container.querySelector('#rubrics')?.textContent).toContain('Ticket rubric2 criteriaMake decisions')
  expect(container.querySelector('#objectives')?.textContent).toContain('Not used in a lesson yet')
  expect(row('files')?.querySelector('a')?.getAttribute('href')).toBe('/admin/content?curriculum=1&pane=files')
  expect(row('copies')?.textContent).toContain('1')
})
