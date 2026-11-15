// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// L-0.6 on staff list pages: state comes from the URL, unknown values fall
// back to the default, choosing a filter pushes history and Back restores it.

const auth = vi.hoisted(() => ({ user: { id: 1, is_admin: true, is_staff: true, role: 'admin' }, schoolFeatures: {} }))
const cohortContext = vi.hoisted(() => ({ refreshCohorts: () => Promise.resolve(), selectedCohort: null, cohorts: [] }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => auth }))
vi.mock('../../contexts/CohortContext', () => ({ useCohortContext: () => cohortContext }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ error: () => {}, success: () => {} }) }))
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => async () => true }))
vi.mock('../../contexts/UploadContext', () => ({ useUpload: () => ({ attachUpload: () => {} }) }))
vi.mock('./CourseResourcesPanel', () => ({ CourseResourcesPanel: () => null }))
vi.mock('../../components/admin/StudentContextDrawer', () => ({ StudentContextDrawer: () => null }))

import { api } from '../../lib/api'
import { CohortManagement } from './CohortManagement'
import { SupportQueue } from './SupportQueue'
import { ContentManagement } from './ContentManagement'
import { Grading } from './Grading'
import { CohortWorkspace } from './CohortWorkspace'

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  window.sessionStorage.clear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})
const settle = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)))
async function render(path: string, element: React.ReactNode, entry: string) {
  const router = createMemoryRouter([{ path, element }, { path: '*', element: <p>Elsewhere</p> }], { initialEntries: [entry] })
  await act(async () => root.render(<RouterProvider router={router} />))
  await settle()
  return router
}
const buttonNamed = (name: string) => [...container.querySelectorAll('button')].find((item) => item.textContent?.trim().startsWith(name))!
const back = async (router: ReturnType<typeof createMemoryRouter>) => {
  await act(async () => router.navigate(-1))
  await settle()
}

describe('Cohorts', () => {
  beforeEach(() => {
    vi.spyOn(api, 'getCohorts').mockResolvedValue({ data: { cohorts: [
      { id: 1, name: 'Current cohort', status: 'active', start_date: '2026-10-01' },
      { id: 2, name: 'Old cohort', status: 'completed', start_date: '2025-10-01' },
    ] }, error: null } as never)
    vi.spyOn(api, 'getCurricula').mockResolvedValue({ data: { curricula: [] }, error: null } as never)
  })
  const names = () => [...container.querySelectorAll('h3')].map((item) => item.textContent)

  it('reads the status filter, ignores unknown values, and Back from a cohort restores it', async () => {
    const router = await render('/admin/cohorts', <CohortManagement />, '/admin/cohorts?status=bogus')
    expect(names()).toEqual(['Current cohort'])
    await act(async () => buttonNamed('Inactive').click())
    expect(router.state.location.search).toBe('?status=inactive')
    expect(names()).toEqual(['Old cohort'])
    const link = container.querySelector<HTMLAnchorElement>('a[href="/admin/cohorts/2"]')!
    await act(async () => link.click())
    expect(router.state.location.state).toEqual({ returnTo: '/admin/cohorts?status=inactive', returnLabel: 'Cohorts · Inactive' })
    await back(router)
    expect(names()).toEqual(['Old cohort'])
    await back(router)
    expect(names()).toEqual(['Current cohort'])
  })
})

describe('Support', () => {
  beforeEach(() => {
    const request = (id: number, urgency: string, status: string) => ({ id, urgency, status, category: 'concept', message: `Message ${id}`, context_label: `Lesson ${id}`, context_path: '/lessons/1', cohort: { id: 3, name: 'Cohort 3' }, student: { id: id + 10, full_name: `Student ${id}` }, created_at: '2026-11-12T00:00:00Z', owner: null })
    vi.spyOn(api, 'getSupportQueue').mockResolvedValue({ data: { support_queue: {
      help_requests: [request(1, 'urgent', 'open'), request(2, 'normal', 'open')], recently_resolved: [request(3, 'normal', 'resolved')],
      students: [], interventions: [], recovery_plans: [], summary: { open_help_count: 2, active_intervention_count: 0, due_follow_up_count: 0, due_recovery_check_in_count: 0 },
    } }, error: null } as never)
  })
  const messages = () => [...container.querySelectorAll('article p.whitespace-pre-wrap')].map((item) => item.textContent)

  it('restores view and urgency through Back and ignores a bad cohort id', async () => {
    const router = await render('/admin/support', <SupportQueue />, '/admin/support?view=nonsense&cohort_id=-2')
    expect(api.getSupportQueue).toHaveBeenCalledWith(undefined)
    expect(messages()).toEqual(['Message 1', 'Message 2'])
    await act(async () => buttonNamed('Urgent only').click())
    expect(new URLSearchParams(router.state.location.search).get('urgency')).toBe('urgent')
    expect(messages()).toEqual(['Message 1'])
    const record = container.querySelector<HTMLAnchorElement>('a[href^="/admin/help-requests/1"]')!
    expect(new URLSearchParams(record.getAttribute('href')!.split('?')[1]).get('return_to')).toBe('/admin/support?view=nonsense&cohort_id=-2&urgency=urgent')
    await back(router)
    expect(messages()).toEqual(['Message 1', 'Message 2'])
  })
})

describe('Content', () => {
  beforeEach(() => {
    const lessons = [{ id: 1, title: 'Week one exercise', release_day: 0 }, { id: 2, title: 'Week two exercise', release_day: 7 }]
      .map((lesson, index) => ({ ...lesson, position: index, content_blocks_count: 1, lesson_type: 'exercise', archived_at: null, updated_at: '2026-10-22' }))
    vi.spyOn(api, 'getCurricula').mockResolvedValue({ data: { curricula: [{ id: 1 }] }, error: null } as never)
    vi.spyOn(api, 'getCurriculum').mockResolvedValue({ data: { curriculum: { id: 1, name: 'Python', status: 'active', modules: [{ id: 10, name: 'Foundations', module_type: 'live_class', position: 0, schedule_days: 'weekdays', week_count: 2, updated_at: '2026-10-22', lessons }] } }, error: null } as never)
  })
  const selectedWeek = () => container.querySelector('[role="tablist"] [aria-selected="true"]')?.textContent

  it('opens the module and week from the URL, clamps a missing week, and Back restores the week tab', async () => {
    const router = await render('/admin/content', <ContentManagement />, '/admin/content?open=10&week=10:2')
    expect(selectedWeek()).toBe('Week 2')
    expect(container.textContent).toContain('Week two exercise')
    await act(async () => [...container.querySelectorAll('[role="tablist"] button')].find((item) => item.textContent === 'Week 1')!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(router.state.location.search).toBe('?open=10')
    expect(selectedWeek()).toBe('Week 1')
    await back(router)
    expect(selectedWeek()).toBe('Week 2')
    await act(async () => root.unmount())
    root = createRoot(container)
    await render('/admin/content', <ContentManagement />, '/admin/content?open=10,abc&week=10:40')
    expect(selectedWeek()).toBe('Week 1')
  })

  it('collapsing a module replaces the history entry', async () => {
    const router = await render('/admin/content', <ContentManagement />, '/admin/content?open=10')
    await act(async () => buttonNamed('Foundations').click())
    expect(router.state.location.search).toBe('')
    expect(router.state.historyAction).toBe('REPLACE')
  })
})

describe('Grading inbox', () => {
  it('falls back for invalid values and Back undoes a filter choice', async () => {
    vi.spyOn(api, 'getSubmissions').mockResolvedValue({ data: { submissions: [] }, error: null })
    vi.spyOn(api, 'getCohorts').mockResolvedValue({ data: { cohorts: [] }, error: null } as never)
    const router = await render('/admin/grading', <Grading />, '/admin/grading?filter=bogus&cohort_id=-3&submission=abc')
    expect(api.getSubmissions).toHaveBeenCalledWith(undefined)
    expect(buttonNamed('Ungraded queue').getAttribute('aria-pressed')).toBe('true')
    await act(async () => buttonNamed('Redo requested').click())
    await settle()
    expect(new URLSearchParams(router.state.location.search).get('filter')).toBe('redo')
    await back(router)
    expect(buttonNamed('Ungraded queue').getAttribute('aria-pressed')).toBe('true')
  })
})

describe('Cohort roster', () => {
  beforeEach(() => {
    const student = (id: number, name: string, joined: boolean) => ({ enrollment_id: id, user_id: id, full_name: name, email: `s${id}@example.com`, github_username: null, joined_at: joined ? '2026-10-01' : null, last_sign_in_at: null, status: 'active', invite_pending: false })
    vi.spyOn(api, 'getCohort').mockResolvedValue({ data: { cohort: { id: 5, name: 'Cohort 5', curriculum_name: 'Python', status: 'active', github_organization_name: null, modules: [], students: [student(1, 'Ana Synthetic', true), student(2, 'Ben Synthetic', false)] } }, error: null } as never)
    vi.spyOn(api, 'getCohortHome').mockResolvedValue({ data: null, error: 'skip' } as never)
    vi.spyOn(api, 'getRecordRelated').mockResolvedValue({ data: null, error: 'skip' } as never)
  })
  const shown = () => container.textContent?.match(/Showing \d+ of \d+ enrolled/)?.[0]

  it('reads search and access filter, drops a GitHub filter without GitHub data, and remembers the roster', async () => {
    const router = await render('/admin/cohorts/:id', <CohortWorkspace />, '/admin/cohorts/5?tab=students&access=github_member')
    expect(shown()).toBe('Showing 2 of 2 enrolled')
    const select = container.querySelector<HTMLSelectElement>('select[aria-label], label select')!
    await act(async () => { select.value = 'cohort_not_opened'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(new URLSearchParams(router.state.location.search).get('access')).toBe('cohort_not_opened')
    expect(shown()).toBe('Showing 1 of 2 enrolled')
    const link = container.querySelector<HTMLAnchorElement>('a[data-record-link="student"][href^="/admin/cohorts/5/students/2"]')!
    expect(link).toBeTruthy()
    const listPath = `${router.state.location.pathname}${router.state.location.search}`
    expect(JSON.parse(window.sessionStorage.getItem('csg:roster:/admin/cohorts/5')!)).toEqual({ path: listPath, ids: ['5:2'] })
    await act(async () => link.click())
    expect(router.state.location.state).toEqual({ returnTo: listPath, returnLabel: 'Cohort 5 · Students' })
    await back(router)
    expect(shown()).toBe('Showing 1 of 2 enrolled')
  })
})
