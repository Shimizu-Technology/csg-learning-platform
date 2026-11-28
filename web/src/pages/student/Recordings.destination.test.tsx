// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createMemoryRouter, RouterProvider, MemoryRouter, Routes, Route } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({
  getRecordings: vi.fn(),
  paused: false,
  v2: false,
  isStaff: false,
  selectCohort: vi.fn(),
}))
vi.mock('../../lib/studentExperience', () => ({ useStudentExperience: () => ({ v2: state.v2 }) }))
vi.mock('../../lib/api', () => ({ api: { getRecordings: state.getRecordings, getDashboard: vi.fn(async () => ({ data: { dashboard: { cohort: { id: 2 }, paused_since: '2026-11-19', capabilities: { can_submit: true, read_only: false, support_mode: 'guided_help', support_expires_at: null, access_expires_at: null, support_instructor_id: 1 } } }, error: null })) } }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: { id: 9, is_staff: state.isStaff }, enrollments: state.paused ? [{ status: 'paused', cohort: { id: 2 } }] : [] }) }))
vi.mock('../../contexts/CohortContext', () => ({
  useCohortContext: () => ({
    selectedCohortId: 2,
    cohorts: state.isStaff ? [{ id: 2, name: 'Cohort 2' }, { id: 3, name: 'Cohort 3' }] : [],
    selectCohort: state.selectCohort,
  }),
}))
vi.mock('../../lib/useMediaQuery', () => ({ useMediaQuery: () => true }))
vi.mock('../../components/shared/VideoPlayer', () => ({ VideoPlayer: ({ title }: { title: string }) => <div data-testid="player">{title}</div> }))
vi.mock('../../components/student/ContextualHelp', () => ({ ContextualHelp: () => null }))
import { Recordings } from './Recordings'
import { api } from '../../lib/api'
it.each([['9', 'Requested recording'], ['legacy-2-2', 'Requested recording'], ['legacy-2-1', 'Legacy recording'], ['999', 'Recording unavailable']])('selects %s and never silently plays another recording', async (id, expected) => {
  state.getRecordings.mockResolvedValue({ data: { items: [{ id: 8, cohort_id: 2, title: 'First recording', source: 'uploaded' }, { id: 9, legacy_item_key: 'legacy-2-2', cohort_id: 2, title: 'Requested recording', source: 'uploaded' }, { id: 'legacy-2-1', cohort_id: 2, title: 'Legacy recording', source: 'external', url: 'https://example.com/video' }] } })
  const container = document.createElement('div'); const root = createRoot(container)
  try {
    await act(async () => root.render(<MemoryRouter initialEntries={[`/recordings?cohort_id=2&recording=${id}`]}><Recordings /></MemoryRouter>))
    expect(state.getRecordings).toHaveBeenCalledWith(2)
    const player = container.querySelector('[data-testid="player"]')
    if (id === '9' || id === 'legacy-2-2') expect(player?.textContent).toBe(expected)
    else if (id === '999') { expect(container.textContent).toContain(expected); expect(player).toBeNull() }
    else expect(container.textContent).toContain(expected)
  } finally { act(() => root.unmount()) }
})

it.each(['/admin/activity?activity_actor=1&activity_before=80&activity_pages=0', '/admin/cohorts/4?tab=activity&activity_category=learning&activity_before=80'])('returns from the actual destination to %s with scroll restoration', async (returnTo) => {
  state.getRecordings.mockResolvedValue({ data: { items: [{ id: 9, cohort_id: 2, title: 'Recording', source: 'uploaded' }] } })
  const path = '/recordings'
  const container = document.createElement('div'); const root = createRoot(container)
  const router = createMemoryRouter([{ path: '/recordings', element: <Recordings /> }, { path: '/admin/*', element: <p>Activity feed</p> }], { initialEntries: [`${path}?cohort_id=2&return_to=${encodeURIComponent(returnTo)}`] })
  try {
    await act(async () => root.render(<RouterProvider router={router} />))
    const back = Array.from(container.querySelectorAll('a')).find(link => link.textContent?.includes('Back to activity'))!
    expect(back.getAttribute('href')).toBe(returnTo)
    await act(async () => back.click())
    expect(router.state.location.pathname + router.state.location.search).toBe(returnTo)
    expect(router.state.location.state).toEqual({ restoreList: true })
  } finally { act(() => root.unmount()) }
})

it.each(['//evil.example/admin/activity', '/\\evil.example/admin/activity', '/dashboard'])('does not render an Activity return for %s', async (returnTo) => {
  state.getRecordings.mockResolvedValue({ data: { items: [{ id: 9, cohort_id: 2, title: 'Recording', source: 'uploaded' }] } })
  const container = document.createElement('div'); const root = createRoot(container)
  try {
    await act(async () => root.render(<MemoryRouter initialEntries={[`/recordings?cohort_id=2&return_to=${encodeURIComponent(returnTo)}`]}><Routes><Route path="/recordings" element={<Recordings />} /></Routes></MemoryRouter>))
    expect(container.textContent).not.toContain('Back to activity')
  } finally { act(() => root.unmount()) }
})

it('new recordings returns to the exact notification inbox and links its course week', async () => {
  state.v2 = true
  state.getRecordings.mockResolvedValue({ data: { items: [{ id: 9, cohort_id: 2, title: 'Replay', source: 'uploaded', learning_path: '/materials?cohort_id=2&week=2', learning_label: 'Open Week 2 in Learn' }] } })
  const container = document.createElement('div'); const root = createRoot(container)
  try {
    const router = createMemoryRouter([{ path: '/recordings', element: <Recordings /> }], { initialEntries: [{ pathname: '/recordings', search: '?cohort_id=2&recording=9', state: { returnTo: '/announcements?tab=inbox&inbox_page=3', returnLabel: 'Notifications' } }] })
    await act(async () => root.render(<RouterProvider router={router} />))
    expect(container.querySelector('a[href="/announcements?tab=inbox&inbox_page=3"]')?.textContent).toContain('Back to Notifications')
    expect(container.querySelector('a[href="/materials?cohort_id=2&week=2"]')?.textContent).toBe('Open Week 2 in Learn')
  } finally { state.v2 = false; act(() => root.unmount()) }
})

it.each(['/announcements?tab=inbox&inbox_page=3', '/materials?cohort_id=2'])('selection upgrades only a legacy inbox origin: %s', async (from) => {
  state.v2 = true
  state.getRecordings.mockResolvedValue({ data: { items: [{ id: 8, cohort_id: 2, title: 'First replay', source: 'uploaded' }, { id: 9, cohort_id: 2, title: 'Second replay', source: 'uploaded' }] } })
  const container = document.createElement('div'); const root = createRoot(container)
  const router = createMemoryRouter([{ path: '/recordings', element: <Recordings /> }], { initialEntries: [{ pathname: '/recordings', search: '?cohort_id=2&recording=8', state: { from } }] })
  try {
    await act(async () => root.render(<RouterProvider router={router} />))
    const second = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Second replay'))!
    expect(second).toBeTruthy()
    await act(async () => second.click())
    expect(container.querySelector('[data-testid="player"]')?.textContent).toBe('Second replay')
    expect(container.querySelector(`a[href="${from}"]`)?.textContent ?? null).toBe(from.startsWith('/announcements') ? 'Back to Notifications' : null)
  } finally { state.v2 = false; act(() => root.unmount()) }
})

it('uses the existing recordings dashboard request for the pause date', async () => {
  state.paused = true
  vi.mocked(api.getDashboard).mockClear()
  state.getRecordings.mockResolvedValue({ data: { items: [] } })
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => root.render(<MemoryRouter><Recordings /></MemoryRouter>))
    expect(container.textContent).toContain('Paused since Nov 19, 2026')
    expect(api.getDashboard).toHaveBeenCalledExactlyOnceWith(2)
  } finally {
    state.paused = false
    act(() => root.unmount())
  }
})

it('shows cohort scope control and omits student watch counts for staff', async () => {
  state.isStaff = true
  state.v2 = true
  state.getRecordings.mockResolvedValue({ data: { items: [{ id: 9, cohort_id: 2, title: 'Live Session 1', source: 'uploaded' }] } })
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => root.render(<MemoryRouter initialEntries={['/recordings?cohort_id=2']}><Recordings /></MemoryRouter>))
    expect(container.querySelector('a[href="/admin"]')?.textContent).toContain('Back to Today')
    expect(container.querySelector('[data-scope-control] select')).toBeTruthy()
    expect(container.textContent).not.toContain('watched')
  } finally {
    state.isStaff = false
    state.v2 = false
    act(() => root.unmount())
  }
})
