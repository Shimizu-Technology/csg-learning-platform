// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createMemoryRouter, RouterProvider, MemoryRouter, Route, Routes } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ getLesson: vi.fn(), cohort: 2 }))
vi.mock('../../lib/api', () => ({ api: { getLesson: state.getLesson, getHelpRequests: vi.fn().mockResolvedValue({ data: { help_requests: [] } }) } }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: { id: 9 } }) }))
vi.mock('../../contexts/CohortContext', () => ({ useCohortContext: () => ({ selectedCohortId: state.cohort }) }))
vi.mock('../../lib/useMediaQuery', () => ({ useMediaQuery: () => false }))
vi.mock('../../components/shared/ContentBlockRenderer', () => ({ ContentBlockRenderer: () => <p>Exercise feedback</p> }))
vi.mock('../../components/shared/RubricPanel', () => ({ RubricPanel: () => null }))
vi.mock('../../components/student/ContextualHelp', () => ({ ContextualHelp: () => null }))
vi.mock('../../components/shared/LearningObjectivesPanel', () => ({ LearningObjectivesPanel: () => null }))
import { LessonView } from './LessonView'
it('fetches in the URL-resolved cohort and focuses the exact feedback block', async () => {
  state.getLesson.mockResolvedValue({ data: { lesson: { id: 42, cohort_id: 2, title: 'Lesson', module_id: 1, lesson_type: 'exercise', content_blocks: [{ id: 8, position: 0, block_type: 'exercise' }], objectives: [] } } })
  Element.prototype.scrollIntoView = vi.fn()
  const container = document.createElement('div'); document.body.appendChild(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(<MemoryRouter initialEntries={['/lessons/42?cohort_id=2#block-8']}><Routes><Route path="/lessons/:id" element={<LessonView />} /></Routes></MemoryRouter>))
    await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)) })
    expect(state.getLesson).toHaveBeenCalledWith(42, 2)
    expect(document.activeElement?.id).toBe('block-8')
    expect(container.querySelector('#block-8')?.className).toContain('ring-2')
  } finally { act(() => root.unmount()); container.remove() }
})

// The server answers slowly (as on a phone): the copy's lesson arrives, the
// address bar moves to its id, and the page keeps that lesson rather than
// loading it again, so the scroll to the linked block isn't lost.
it.each([
  ['#block-8', '#block-108', 'block-108'],
  ['#redo', '#redo', 'block-109'],
])("keeps scrolling to %s after an old lesson link moves to the cohort's copy", async (hash, movedHash, focused) => {
  state.cohort = 2
  const copy = { id: 142, cohort_id: 2, title: 'Lesson', module_id: 1, lesson_type: 'exercise', objectives: [], moved_from: { lesson_id: 42, block_ids: { 8: 108, 9: 109 } },
    content_blocks: [{ id: 108, position: 0, block_type: 'exercise' }, { id: 109, position: 1, block_type: 'exercise', submissions: [{ id: 5, grade: 'R' }] }] }
  state.getLesson.mockReset()
  state.getLesson.mockImplementation((id: number) => new Promise(resolve => setTimeout(() => resolve({ data: { lesson: id === 142 ? { ...copy, moved_from: undefined } : copy } }), 40)))
  const scroll = vi.fn()
  Element.prototype.scrollIntoView = scroll
  const container = document.createElement('div'); document.body.appendChild(container)
  const root = createRoot(container)
  const router = createMemoryRouter([{ path: '/lessons/:id', element: <LessonView /> }], { initialEntries: [`/lessons/42?cohort_id=2${hash}`] })
  try {
    await act(async () => root.render(<RouterProvider router={router} />))
    for (let wait = 0; wait < 4; wait += 1) await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
    await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)) })

    expect(router.state.location.pathname + router.state.location.hash).toBe(`/lessons/142${movedHash}`)
    expect(state.getLesson.mock.calls.map(([id]) => id)).toEqual([42])
    expect(container.textContent).not.toContain('Loading lesson')
    expect(scroll).toHaveBeenCalled()
    expect(scroll.mock.contexts.at(-1)).toBe(container.querySelector(`#${focused}`))
    expect(document.activeElement?.id).toBe(focused)
  } finally { act(() => root.unmount()); container.remove() }
})

it.each(['/admin/activity?activity_actor=1&activity_before=80&activity_pages=0', '/admin/cohorts/4?tab=activity&activity_category=learning&activity_before=80'])('returns from the actual destination to %s with scroll restoration', async (returnTo) => {
  state.getLesson.mockResolvedValue({ data: { lesson: { id: 42, cohort_id: 2, title: 'Lesson', module_id: 1, content_blocks: [], objectives: [] } } })
  const path = '/lessons/42'
  const container = document.createElement('div'); const root = createRoot(container)
  const router = createMemoryRouter([{ path: '/lessons/:id', element: <LessonView /> }, { path: '/admin/*', element: <p>Activity feed</p> }], { initialEntries: [`${path}?cohort_id=2&return_to=${encodeURIComponent(returnTo)}`] })
  try {
    await act(async () => root.render(<RouterProvider router={router} />))
    const back = Array.from(container.querySelectorAll('a')).find(link => link.textContent?.includes('Back to Activity'))!
    expect(back.getAttribute('href')).toBe(returnTo)
    await act(async () => back.click())
    expect(router.state.location.pathname + router.state.location.search).toBe(returnTo)
    expect(router.state.location.state).toEqual({ restoreList: true })
  } finally { act(() => root.unmount()) }
})

it.each(['//evil.example/admin/activity', '/\\evil.example/admin/activity', '/dashboard'])('does not render an Activity return for %s', async (returnTo) => {
  state.getLesson.mockResolvedValue({ data: { lesson: { id: 42, cohort_id: 2, title: 'Lesson', module_id: 1, content_blocks: [], objectives: [] } } })
  const container = document.createElement('div'); const root = createRoot(container)
  try {
    await act(async () => root.render(<MemoryRouter initialEntries={[`/lessons/42?cohort_id=2&return_to=${encodeURIComponent(returnTo)}`]}><Routes><Route path="/lessons/:id" element={<LessonView />} /></Routes></MemoryRouter>))
    expect(container.textContent).not.toContain('Back to Activity')
  } finally { act(() => root.unmount()) }
})

it('preserves the destination cohort Continue target when a cohort switch rejects the current lesson', async () => {
  const container = document.createElement('div'); const root = createRoot(container)
  state.cohort = 2
  state.getLesson.mockImplementation((_id, cohort) => Promise.resolve(cohort === 2 ? { data: { lesson: { id: 42, cohort_id: 2, title: 'Old cohort lesson', module_id: 1, content_blocks: [], objectives: [] } } } : { status: 403, error: 'Not available' }))
  localStorage.setItem('csg-last-lesson:9:3', '777')
  const tree = () => <MemoryRouter initialEntries={['/lessons/42']}><Routes><Route path="/lessons/:id" element={<LessonView />} /></Routes></MemoryRouter>
  try {
    await act(async () => root.render(tree()))
    expect(localStorage.getItem('csg-last-lesson:9:2')).toBe('42')
    state.cohort = 3
    await act(async () => root.render(tree()))
    expect(state.getLesson).toHaveBeenCalledWith(42, 3)
    expect(localStorage.getItem('csg-last-lesson:9:3')).toBe('777')
  } finally {
    act(() => root.unmount())
    state.cohort = 2
    localStorage.removeItem('csg-last-lesson:9:2')
    localStorage.removeItem('csg-last-lesson:9:3')
  }
})

it("moves an old lesson link to the cohort's copy, keeping the block it pointed at", async () => {
  state.cohort = 2
  state.getLesson.mockResolvedValue({ data: { lesson: { id: 142, cohort_id: 2, title: 'Lesson', module_id: 1, lesson_type: 'exercise', content_blocks: [{ id: 108, position: 0, block_type: 'exercise' }], objectives: [], moved_from: { lesson_id: 42, block_ids: { 8: 108 } } } } })
  Element.prototype.scrollIntoView = vi.fn()
  const container = document.createElement('div'); document.body.appendChild(container)
  const root = createRoot(container)
  const router = createMemoryRouter([{ path: '/lessons/:id', element: <LessonView /> }], { initialEntries: ['/lessons/42?cohort_id=2#block-8'] })
  try {
    await act(async () => root.render(<RouterProvider router={router} />))
    await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)) })
    expect(router.state.location.pathname + router.state.location.search + router.state.location.hash).toBe('/lessons/142?cohort_id=2#block-108')
    expect(container.querySelector('#block-108')?.className).toContain('ring-2')
  } finally { act(() => root.unmount()); container.remove() }
})
