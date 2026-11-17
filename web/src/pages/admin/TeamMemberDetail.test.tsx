// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getTeamMember: vi.fn(), createDirectConversation: vi.fn(), getRecordSummary: vi.fn(), success: vi.fn(), error: vi.fn() }))
vi.mock('../../lib/api', () => ({ api: mocks }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: { id: 1, is_staff: true, is_admin: true }, enrollments: [] }) }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ success: mocks.success, error: mocks.error }) }))
vi.mock('../../components/shared/ActivityTimeline', () => ({ ActivityTimeline: ({ userId }: { userId: number }) => <section data-activity-user={userId}>Activity history</section> }))
import { TeamMemberDetail } from './TeamMemberDetail'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const member = {
  id: 7, email: 'ina@example.invalid', first_name: 'Ina', last_name: 'Teacher', full_name: 'Ina Teacher', role: 'instructor', avatar_url: null, github_username: null,
  last_sign_in_at: '2026-11-15T02:00:00Z', archived_at: null, invite_pending: false, created_at: '2026-09-01T00:00:00Z', is_self: false, message_cohort_id: 4,
  teaching: [
    { cohort: { id: 4, name: 'Cohort Teal', status: 'active', course_delivery: 'program', start_date: '2026-10-01' }, assigned_at: '2026-09-02T00:00:00Z', can_edit_lessons: true, edit_granted_at: '2026-11-14T02:00:00Z', edit_granted_by: { id: 1, full_name: 'Ada Admin' }, waiting_review: 3, open_help: 1 },
    { cohort: { id: 2, name: 'Cohort Coral', status: 'completed', course_delivery: 'program', start_date: '2026-05-01' }, assigned_at: '2026-04-02T00:00:00Z', can_edit_lessons: false, edit_granted_at: null, edit_granted_by: null, waiting_review: 0, open_help: 0 },
  ],
  workload: {
    follow_ups_count: 1, owned_help_count: 2,
    follow_ups: [{ id: 61, status: 'contacted', severity: 'normal', next_follow_up_at: '2026-11-20T00:00:00Z', student: { id: 9, name: 'Alex Rivera' }, cohort: { id: 4, name: 'Cohort Teal' } }],
  },
}

let container: HTMLDivElement
let root: Root
let router: ReturnType<typeof createMemoryRouter>
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

beforeEach(() => {
  vi.clearAllMocks()
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })

async function mount(entry: string | { pathname: string; state?: unknown } = '/admin/team/7') {
  router = createMemoryRouter([
    { path: '/admin/team/:id', element: <TeamMemberDetail /> },
    { path: '/admin/cohorts/:id', element: <p>Cohort page</p> },
    { path: '/messages/dm/:id', element: <p>Conversation</p> },
  ], { initialEntries: [entry] })
  await act(async () => root.render(<RouterProvider router={router} />))
  await flush()
}

it('shows role, the cohorts they teach with read-only editing access, and their activity', async () => {
  mocks.getTeamMember.mockResolvedValue({ data: { team_member: member }, error: null })
  await mount({ pathname: '/admin/team/7', state: { returnTo: '/admin/cohorts/4?tab=team', returnLabel: 'Teaching team' } })
  expect(container.querySelector('h1')?.textContent).toBe('Ina Teacher')
  expect(container.textContent).toContain('Team member · Instructor')
  expect(container.querySelector('a[href="/admin/cohorts/4?tab=team"]')?.textContent).toContain('Back to Teaching team')
  expect(container.querySelector('a[data-record-link="cohort"][href="/admin/cohorts/4"]')?.textContent).toBe('Cohort Teal')
  expect(container.textContent).toContain('Can edit lessons')
  expect(container.textContent).toContain('Ada gave this access on')
  expect(container.textContent).toContain('Lessons read only')
  // Editing access is shown here and changed on the cohort's Teaching team tab.
  expect(container.querySelector('a[aria-label="Change lesson editing for Ina Teacher in Cohort Teal"]')?.getAttribute('href')).toBe('/admin/cohorts/4?tab=team')
  expect(container.querySelector('button[role="switch"]')).toBeNull()
  expect(container.querySelector('[data-activity-user="7"]')).not.toBeNull()
  // L-3.2: grading load per cohort, and the follow-up plans and help they own.
  expect(container.querySelector('a[href="/admin/grading?cohort_id=4"]')?.textContent).toBe('3 waiting for review')
  expect(container.querySelector('a[href="/admin/support?cohort_id=4"]')?.textContent).toBe('1 open help')
  const plans = container.querySelector('#follow-ups')!
  expect(plans.textContent).toContain('1 active plan, soonest follow-up first.')
  expect(plans.textContent).toContain('They also own 2 open help requests.')
  expect(plans.querySelector('a[data-record-link="intervention"]')?.textContent).toBe("Alex Rivera's follow-up plan")
  expect(plans.querySelector('a[data-record-link="student"]')?.getAttribute('href')).toMatch(/^\/admin\/cohorts\/4\/students\/9\/overview/)
  const related = container.querySelector('[data-related-panel]')!
  expect(related.querySelector('[data-related-row="grading"]')?.textContent).toContain('Grading load3')
  expect(related.querySelector('[data-related-row="follow_ups"]')?.textContent).toContain('1')
})

it('messages them through the cohort the API picked, under the existing messaging rules', async () => {
  mocks.getTeamMember.mockResolvedValue({ data: { team_member: member }, error: null })
  mocks.createDirectConversation.mockResolvedValue({ data: { direct_conversation: { id: 31 } }, error: null })
  await mount()
  const message = [...container.querySelectorAll('button')].find((el) => el.textContent === 'Message Ina')!
  await act(async () => message.click())
  await flush()
  expect(mocks.createDirectConversation).toHaveBeenCalledWith({ cohort_id: 4, user_ids: [7] })
  expect(router.state.location.pathname).toBe('/messages/dm/31')
})

it('explains a missing Message button and treats a non-team id as no access', async () => {
  mocks.getTeamMember.mockResolvedValueOnce({ data: { team_member: { ...member, message_cohort_id: null, teaching: [] } }, error: null })
  await mount()
  expect([...container.querySelectorAll('button')].some((el) => el.textContent?.startsWith('Message'))).toBe(false)
  expect(container.textContent).toContain('Messages go through a live cohort')

  act(() => root.unmount()); root = createRoot(container)
  mocks.getTeamMember.mockResolvedValueOnce({ data: null, error: 'Not found', status: 404 })
  await mount('/admin/team/99')
  expect(container.textContent).toContain('No access')
})
