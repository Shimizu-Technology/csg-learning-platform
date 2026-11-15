// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// L-0.6 on learner pages: filters, search, the open week and the open
// recording come from the URL, unknown values fall back, and Back restores them.

// Stable identities, as the real provider gives: the page reloads when its viewer changes.
const auth = vi.hoisted(() => ({ user: { id: 7, full_name: 'Synthetic Learner', is_staff: false }, enrollments: [{ cohort: { id: 4, course_delivery: 'program' } }] }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => auth }))
vi.mock('../../contexts/CohortContext', () => ({ useCohortContext: () => ({ selectedCohortId: 4 }) }))
vi.mock('../../lib/useMediaQuery', () => ({ useMediaQuery: () => true }))
vi.mock('../../components/shared/VideoPlayer', () => ({ VideoPlayer: ({ title }: { title: string }) => <div data-testid="player">{title}</div> }))
vi.mock('../../components/student/ContextualHelp', () => ({ ContextualHelp: () => null }))
vi.mock('../../lib/api', () => ({ api: { getDashboard: vi.fn(), getRecordings: vi.fn() } }))

import { api } from '../../lib/api'
import { Materials } from './Materials'
import { Recordings } from './Recordings'

const lesson = (id: number, title: string, completed: boolean) => ({ id, title, lesson_type: 'exercise', available: true, completed, review_status: null, release_day: 0, required: true, position: id })
const dashboard = {
  enrolled: true,
  cohort: { id: 4, name: 'Synthetic cohort', cohort_type: 'bootcamp' },
  capabilities: { can_submit: true, read_only: false },
  action_items: [],
  modules: [
    { id: 1, name: 'Week 1', module_type: 'live_class', lessons: [lesson(11, 'Variables', true), lesson(12, 'Loops', false)] },
    { id: 2, name: 'Week 2', module_type: 'live_class', lessons: [lesson(21, 'Functions', false), lesson(22, 'Loop review', true)] },
  ],
}

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.mocked(api.getDashboard).mockResolvedValue({ data: { dashboard } as never, error: null })
  window.localStorage.clear()
  window.sessionStorage.clear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.clearAllMocks()
})
const settle = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)))
async function render(element: React.ReactNode, path: string, entry: string) {
  const router = createMemoryRouter([{ path, element }, { path: '/lessons/:id', element: <p>Lesson page</p> }, { path: '*', element: <p>Elsewhere</p> }], { initialEntries: [entry] })
  await act(async () => root.render(<RouterProvider router={router} />))
  await settle()
  return router
}
const lessonTitles = () => [...container.querySelectorAll('a[href^="/lessons/"]')].map((link) => link.textContent?.match(/Variables|Loops|Functions|Loop review/)?.[0])
const chip = (label: string) => [...container.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].find((item) => item.textContent?.startsWith(label))!
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('Learn', () => {
  it('reads the filter and search from the URL and falls back for unknown values', async () => {
    await render(<Materials />, '/materials', '/materials?filter=completed&q=loop')
    expect(chip('Done').getAttribute('aria-pressed')).toBe('true')
    expect(lessonTitles()).toEqual(['Loops', 'Loop review'])
    // The module's progress counts all its lessons, not the filtered ones, and never blocks (U-5.6).
    expect(container.textContent).toContain('1 of 2 lessons')
    expect(container.textContent).not.toMatch(/blocks/)
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Search lessons or modules"]')!.value).toBe('loop')
    await act(async () => root.unmount())
    root = createRoot(container)
    await render(<Materials />, '/materials', '/materials?filter=%3Cscript%3E&q=')
    expect(chip('To do').getAttribute('aria-pressed')).toBe('true')
    expect(lessonTitles()).toEqual(['Loops', 'Functions'])
  })

  it('searches finished lessons while To do is selected, then restores the filter on clearing', async () => {
    await render(<Materials />, '/materials', '/materials?filter=ready&q=Variables')
    expect(lessonTitles()).toEqual(['Variables'])
    expect(chip('To do').getAttribute('aria-pressed')).toBe('true')
    await type(container.querySelector<HTMLInputElement>('input[aria-label="Search lessons or modules"]')!, '')
    expect(lessonTitles()).toEqual(['Loops', 'Functions'])
  })

  it('restores the filter and search after opening a lesson and pressing Back', async () => {
    const router = await render(<Materials />, '/materials', '/materials')
    await act(async () => chip('All').click())
    expect(router.state.location.search).toBe('?filter=all')
    await type(container.querySelector<HTMLInputElement>('input[aria-label="Search lessons or modules"]')!, 'Fun')
    // Typing replaced the entry rather than adding one per keystroke.
    expect(router.state.location.search).toBe('?filter=all&q=Fun')
    const link = container.querySelector<HTMLAnchorElement>('a[href^="/lessons/21"]')!
    await act(async () => link.click())
    expect(container.textContent).toContain('Lesson page')
    expect(router.state.location.state).toEqual({ returnTo: '/materials?filter=all&q=Fun', returnLabel: 'Learn' })
    await act(async () => router.navigate(-1))
    await settle()
    expect(chip('All').getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Search lessons or modules"]')!.value).toBe('Fun')
    expect(lessonTitles()).toEqual(['Functions'])
    // Back once more undoes the filter choice (it pushed), not each keystroke.
    await act(async () => router.navigate(-1))
    await settle()
    expect(chip('To do').getAttribute('aria-pressed')).toBe('true')
  })

  it('opens the week named in the URL even when this viewer collapsed it', async () => {
    window.localStorage.setItem('csg-materials-collapsed:4', JSON.stringify([1, 2]))
    const router = await render(<Materials />, '/materials', '/materials?filter=all&module=2')
    expect(lessonTitles()).toEqual(['Functions', 'Loop review'])
    const week1 = [...container.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')].find((item) => item.textContent?.includes('Week 1'))!
    await act(async () => week1.click())
    expect(new URLSearchParams(router.state.location.search).get('module')).toBe('1')
    await act(async () => root.unmount())
    root = createRoot(container)
    await render(<Materials />, '/materials', '/materials?filter=all&module=abc')
    expect(lessonTitles()).toEqual(['Variables', 'Loops'])
  })
})

describe('Recordings', () => {
  const items = [
    { id: 8, cohort_id: 4, title: 'First recording', source: 'uploaded' },
    { id: 9, cohort_id: 4, title: 'Second recording', source: 'uploaded' },
    { id: 'legacy-4-1', legacy_item_key: 'legacy-4-1', cohort_id: 4, title: 'External recording', source: 'external', url: 'https://example.com/video' },
  ]
  beforeEach(() => vi.mocked(api.getRecordings).mockResolvedValue({ data: { items } } as never))
  const player = () => container.querySelector('[data-testid="player"]')?.textContent
  const playlistButton = (title: string) => [...container.querySelectorAll<HTMLButtonElement>('button[type="button"]')].find((item) => item.textContent?.includes(title))!

  it('keeps the open recording in the URL without reloading the list, and Back reopens it', async () => {
    const router = await render(<Recordings />, '/recordings', '/recordings')
    expect(player()).toBe('First recording')
    const index = router.state.historyAction
    await act(async () => playlistButton('Second recording').click())
    expect(player()).toBe('Second recording')
    expect(router.state.location.search).toBe('?recording=9')
    expect(router.state.historyAction).toBe(index === 'POP' ? 'REPLACE' : index)
    expect(api.getRecordings).toHaveBeenCalledTimes(1)
    await act(async () => router.navigate('/elsewhere'))
    await act(async () => router.navigate(-1))
    await settle()
    expect(player()).toBe('Second recording')
  })

  it('pushes the source tab, and an empty or unknown tab shows All', async () => {
    const router = await render(<Recordings />, '/recordings', '/recordings?source=youtube')
    const tab = (label: string) => [...container.querySelectorAll<HTMLButtonElement>('[aria-label="Recording source"] button')].find((item) => item.textContent === label)!
    expect(tab('All').getAttribute('aria-pressed')).toBe('true')
    await act(async () => tab('External').click())
    expect(router.state.location.search).toBe('?source=external')
    expect(tab('External').getAttribute('aria-pressed')).toBe('true')
    await act(async () => router.navigate(-1))
    expect(tab('All').getAttribute('aria-pressed')).toBe('true')
  })

  it('Back to plain /recordings reopens the default recording, not the one picked after it', async () => {
    vi.mocked(api.getRecordings).mockClear()
    const router = await render(<Recordings />, '/recordings', '/recordings')
    const tab = (label: string) => [...container.querySelectorAll<HTMLButtonElement>('[aria-label="Recording source"] button')].find((item) => item.textContent === label)!
    await act(async () => tab('Uploaded').click())
    await act(async () => playlistButton('Second recording').click())
    expect(router.state.location.search).toBe('?source=uploaded&recording=9')
    expect(player()).toBe('Second recording')
    await act(async () => router.navigate(-1))
    await settle()
    expect(router.state.location.search).toBe('')
    expect(player()).toBe('First recording')
    expect(api.getRecordings).toHaveBeenCalledTimes(1)
  })

  it('ignores a malformed recording value', async () => {
    await render(<Recordings />, '/recordings', `/recordings?recording=${encodeURIComponent('<img src=x>')}`)
    expect(player()).toBe('First recording')
  })
})
