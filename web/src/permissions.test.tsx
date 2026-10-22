// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ role: 'instructor' }))
vi.mock('./contexts/AuthContext', () => ({ useAuthContext: () => ({
  isSignedIn: true, isLoading: false, enrollments: [],
  user: { id: 1, full_name: 'Staff', role: state.role, is_staff: true, is_admin: state.role === 'admin' },
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
  CohortWorkspace: () => null, CohortManagement: () => null, CohortModuleGrading: () => null,
  CohortStudentView: () => null, CohortWatchProgress: () => null, ContentManagement: () => null,
  Dashboard: () => <p>Dashboard destination</p>, PrivateMeetings: () => null, StaffPrivateMeetings: () => null,
  Grading: () => null, LessonEditor: () => null, LessonView: () => null, Materials: () => null,
  Messages: () => null, ModuleView: () => null, Profile: () => null, Recordings: () => null,
  Resources: () => null, SignInPage: () => null, SignUpPage: () => null, StudentDetail: () => null,
  StudentWorkspace: () => null, SubmissionDetail: () => null, StudentManagement: () => null,
  SupportQueue: () => null, Moderation: () => <p>Private safety review</p>, InterventionDetail: () => null,
  HelpRequestDetail: () => null, TeamManagement: () => null,
}))
import App from './App'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let container: HTMLDivElement
let root: Root
beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container); window.history.replaceState({}, '', '/admin/moderation') })
afterEach(() => { act(() => root.unmount()); container.remove() })

it('instructors cannot open the Safety queue by URL and do not see its navigation entry', async () => {
  state.role = 'instructor'
  await act(async () => root.render(<App />))
  expect(window.location.pathname).toBe('/dashboard')
  expect(container.textContent).toContain('Dashboard destination')
  expect(container.textContent).not.toContain('Private safety review')
  expect(container.querySelector('a[href="/admin/moderation"]')).toBeNull()
})
it('admins can open the Safety queue and navigate back to it', async () => {
  state.role = 'admin'
  await act(async () => root.render(<App />))
  expect(window.location.pathname).toBe('/admin/moderation')
  expect(container.textContent).toContain('Private safety review')
  expect(container.querySelector('a[href="/admin/moderation"]')?.textContent).toContain('Safety queue')
})

it.each(['/admin/activity', '/admin/cohorts/4/settings'])('blocks instructor direct access to %s', async (path) => {
  state.role = 'instructor'
  window.history.replaceState({}, '', path)
  await act(async () => root.render(<App />))
  expect(window.location.pathname).toBe('/dashboard')
  expect(container.querySelector('a[href="/admin/activity"]')).toBeNull()
  expect(container.textContent).not.toContain('Administrative cohort settings')
})
it.each([['/admin/activity', 'School activity feed'], ['/admin/cohorts/4/settings', 'Administrative cohort settings']])('allows admin direct access to %s', async (path, text) => {
  state.role = 'admin'
  window.history.replaceState({}, '', path)
  await act(async () => root.render(<App />))
  expect(window.location.pathname).toBe(path)
  expect(container.textContent).toContain(text)
  expect(container.querySelector('a[href="/admin/activity"]')?.textContent).toContain('School activity')
})
