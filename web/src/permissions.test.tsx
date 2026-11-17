// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ role: 'instructor', signedIn: true }))
vi.mock('./contexts/AuthContext', () => ({ useAuthContext: () => ({
  isSignedIn: state.signedIn, isLoading: false, enrollments: [],
  user: { id: 1, full_name: 'Staff', role: state.role, is_staff: state.role !== 'student', is_admin: state.role === 'admin' },
}) }))
vi.mock('./contexts/UploadContext', () => ({ UploadProvider: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('./components/shared/AccountMenu', () => ({ AccountMenu: () => null }))
vi.mock('./components/shared/CommandPalette', () => ({ CommandPalette: () => null }))
vi.mock('./lib/realtime', () => ({ subscribeToUserMessages: async () => () => {} }))
vi.mock('./lib/api', () => ({ api: {
  getNotifications: async () => ({ data: { unread_count: 0 } }),
  getChannels: async () => ({ data: { channels: [] } }),
  getDirectConversations: async () => ({ data: { direct_conversations: [] } }),
  getAccessibleCohorts: async () => ({ data: { cohorts: [] }, error: null }),
  updatePresence: async () => ({}),
} }))
vi.mock('./lib/routePreload', () => ({
  preloadPrimaryRoutes: () => {}, preloadRoute: () => {},
  AdminActivity: () => <p>School activity feed</p>, AdminDashboard: () => <p>Staff dashboard</p>, Announcements: () => null, CohortDetail: () => <p>Administrative cohort settings</p>,
  CohortWorkspace: () => <p>Cohort page</p>, CohortManagement: () => null, CohortModuleGrading: () => null,
  CohortStudentView: () => null, CohortWatchProgress: () => null, ContentManagement: () => null, SubmissionAudit: () => <p>Lazy submission audit</p>,
  Dashboard: () => <p>Dashboard destination</p>, PrivateMeetings: () => null, StaffPrivateMeetings: () => null,
  Grading: () => null, LessonEditor: () => null, LessonView: () => null, Materials: () => null,
  Messages: () => null, ModuleView: () => null, Profile: () => null, Recordings: () => null,
  Resources: () => null, SignInPage: () => null, SignUpPage: () => null, StudentDetail: () => null,
  StudentWorkspace: () => null, SubmissionDetail: () => null, StudentManagement: () => null,
  SupportQueue: () => null, Moderation: () => <p>Private safety review</p>, InterventionDetail: () => null,
  HelpRequestDetail: () => null, TeamManagement: () => null, TeamMemberDetail: () => <p>Team member record</p>,
  CurriculumRecord: () => <p>Curriculum record</p>, ModuleRecord: () => <p>Module record</p>, LessonRecord: () => <p>Lesson record</p>,
  RecordingRecord: () => <p>Recording record</p>, OfficeHourRecord: () => <p>Session record</p>, PrivateMeetingRecord: () => <p>Meeting record</p>,
  LearningPlanRecord: () => <p>Plan record</p>, ChannelRecord: () => <p>Conversation record</p>, RubricRecord: () => <p>Rubric record</p>,
  ActivityEventRecord: () => <p>Event record</p>, RecoveryPlanRecord: () => <p>Return plan record</p>,
  ContentReportRecord: () => <p>Report record</p>, OfferingRecord: () => <p>Offering record</p>,
}))
import App from './App'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let container: HTMLDivElement
let root: Root
beforeEach(() => { state.signedIn = true; container = document.createElement('div'); document.body.append(container); root = createRoot(container); window.history.replaceState({}, '', '/admin/moderation') })
afterEach(() => { act(() => root.unmount()); container.remove() })

it('instructors cannot open the Safety queue by URL and do not see its navigation entry', async () => {
  state.role = 'instructor'
  await act(async () => root.render(<App />))
  expect(window.location.pathname).toBe('/admin/moderation')
  expect(container.textContent).toContain('No access')
  expect(container.textContent).not.toContain('Private safety review')
  expect(container.querySelector('a[href="/admin/moderation"]')).toBeNull()
})
it('admins can open the Safety queue and navigate back to it', async () => {
  state.role = 'admin'
  await act(async () => root.render(<App />))
  expect(window.location.pathname).toBe('/admin/moderation')
  expect(container.textContent).toContain('Private safety review')
  expect(container.querySelector('a[href="/admin/moderation"]')?.textContent).toContain('Safety')
})

it('team member pages are admin-only, like Team', async () => {
  window.history.replaceState({}, '', '/admin/team/7')
  state.role = 'instructor'
  await act(async () => root.render(<App />))
  expect(container.textContent).toContain('No access')
  expect(container.textContent).not.toContain('Team member record')
  act(() => root.unmount())
  root = createRoot(container)
  state.role = 'admin'
  await act(async () => root.render(<App />))
  expect(window.location.pathname).toBe('/admin/team/7')
  expect(container.textContent).toContain('Team member record')
})

// L-5.2 / L-3.2: a community report and an offering's purchases are admin pages, like Safety and the offering settings.
it.each([
  ['/admin/moderation/reports/16', 'Report record'],
  ['/admin/offerings/17', 'Offering record'],
])('%s is admin-only', async (path, text) => {
  for (const role of ['student', 'instructor']) {
    window.history.replaceState({}, '', path)
    state.role = role
    await act(async () => root.render(<App />))
    expect(container.textContent, role).toContain('No access')
    expect(container.textContent, role).not.toContain(text)
    act(() => root.unmount())
    root = createRoot(container)
  }
  window.history.replaceState({}, '', path)
  state.role = 'admin'
  await act(async () => root.render(<App />))
  expect(window.location.pathname).toBe(path)
  expect(container.textContent).toContain(text)
})

// L-5: content record pages are staff pages. Students get No access before anything loads.
it.each([
  ['/admin/curricula/3', 'Curriculum record'],
  ['/admin/modules/5', 'Module record'],
  ['/admin/lessons/7', 'Lesson record'],
  // L-5.2: the remaining staff record pages. Learners keep their own booking (/meetings) and Recordings.
  ['/admin/recordings/8', 'Recording record'],
  ['/admin/office-hours/9', 'Session record'],
  ['/admin/meetings/10', 'Meeting record'],
  ['/admin/learning-plans/11', 'Plan record'],
  ['/admin/channels/12', 'Conversation record'],
  ['/admin/rubrics/13', 'Rubric record'],
  ['/admin/activity/14', 'Event record'],
  ['/admin/recovery-plans/15', 'Return plan record'],
])('%s opens for staff and refuses students', async (path, text) => {
  window.history.replaceState({}, '', path)
  state.role = 'student'
  await act(async () => root.render(<App />))
  expect(window.location.pathname).toBe(path)
  expect(container.textContent).toContain('No access')
  expect(container.textContent).not.toContain(text)
  for (const role of ['instructor', 'admin']) {
    act(() => root.unmount())
    root = createRoot(container)
    state.role = role
    await act(async () => root.render(<App />))
    expect(container.textContent, role).toContain(text)
  }
})

it.each(['/admin/activity'])('blocks instructor direct access to %s', async (path) => {
  state.role = 'instructor'
  window.history.replaceState({}, '', path)
  await act(async () => root.render(<App />))
  expect(window.location.pathname).toBe(path)
  expect(container.querySelector('a[href="/admin/activity"]')).toBeNull()
  expect(container.textContent).not.toContain('Administrative cohort settings')
})
it.each([['/admin/activity', 'School activity feed'], ['/admin/cohorts/4/settings', 'Cohort page']])('allows admin direct access to %s', async (path, text) => {
  state.role = 'admin'
  window.history.replaceState({}, '', path)
  await act(async () => root.render(<App />))
  expect(window.location.pathname + window.location.search).toBe(path.endsWith('/settings') ? '/admin/cohorts/4?tab=settings' : path)
  expect(container.textContent).toContain(text)
  expect(container.querySelector('a[href="/admin/activity"]')?.textContent).toContain('School activity')
})

it('normalizes instructor legacy settings to the teaching workspace without loading the editor', async () => {
  state.role = 'instructor'
  window.history.replaceState({}, '', '/admin/cohorts/4/settings')
  await act(async () => root.render(<App />))
  expect(window.location.pathname + window.location.search).toBe('/admin/cohorts/4?settings_notice=1')
  expect(container.textContent).not.toContain('Administrative cohort settings')
})

it.each(['admin', 'instructor', 'student', 'signed-out'])('unknown routes show Not found for %s without redirecting', async role => {
  state.role = role
  state.signedIn = role !== 'signed-out'
  window.history.replaceState({}, '', '/missing-page')
  await act(async () => root.render(<App />))
  expect(window.location.pathname).toBe('/missing-page')
  expect(container.querySelector('h1')?.textContent).toBe('Page not found')
  expect(Boolean(container.querySelector('aside'))).toBe(state.signedIn)
  const destination = state.signedIn ? role === 'student' ? '/dashboard' : '/admin' : '/'
  expect(container.querySelector('main a')?.getAttribute('href')).toBe(destination)
  if (state.signedIn) expect([...container.querySelectorAll('a[aria-label="Go to Today"]')].every(a => a.getAttribute('href') === destination)).toBe(true)
})

it('loads Submission audit through the lazy route registry for admins', async () => {
  window.history.replaceState({}, '', '/admin/content/submission-audit')
  state.role = 'admin'
  await act(async () => root.render(<App />))
  expect(container.textContent).toContain('Lazy submission audit')
})
it.each(['student', 'instructor'])('blocks %s from the lazy audit route', async (role) => {
  window.history.replaceState({}, '', '/admin/content/submission-audit')
  state.role = role
  await act(async () => root.render(<App />))
  expect(container.textContent).toContain('No access')
  expect(container.textContent).not.toContain('Lazy submission audit')
})
