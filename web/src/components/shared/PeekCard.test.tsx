// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { api } from '../../lib/api'
import { PeekController, peekController } from '../../lib/peekController'
import { clearRecordSummaryCache, type RecordSummary } from '../../lib/recordSummary'
import { RecordLink } from './RecordLink'

const auth = vi.hoisted(() => ({ user: { id: 1, is_staff: true, is_admin: false } as { id: number; is_staff: boolean; is_admin: boolean } | null }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: auth.user, enrollments: [] }) }))

const blair: RecordSummary = {
  type: 'student', id: 18, title: 'Blair Cruz', subtitle: 'Cohort 3', handle: 'blair_c', avatar_url: null, cohort_id: 4, cohort_name: 'Cohort 3',
  last_active_at: null,
  facts: [
    { key: 'progress', label: 'steps done', value: '99 / 243', kind: 'text', attention: false },
    { key: 'waiting_review', label: 'waiting for review', value: 0, kind: 'count', attention: false },
    { key: 'open_help', label: 'open help', value: 1, kind: 'count', attention: true },
    { key: 'status', label: 'status', value: 'Needs help', kind: 'text', attention: true },
  ],
}
const dana: RecordSummary = { ...blair, id: 19, title: 'Dana Kim', handle: null }
const lesson: RecordSummary = { type: 'lesson', id: 7, title: 'Make decisions', subtitle: 'Week 1 · Python', module_id: 2, cohort_id: 4, facts: [] }
const cohort: RecordSummary = { type: 'cohort', id: 4, title: 'Cohort 3', subtitle: 'Python · Active · Week 11 of 16', facts: [{ key: 'students', label: 'active students', value: 6, kind: 'count', attention: false }] }

let container: HTMLDivElement
let root: Root
let desktop = true
let summarySpy: MockInstance<typeof api.getRecordSummary>

function stubMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: query.includes('hover: hover') ? desktop : false, media: query, addEventListener: () => {}, removeEventListener: () => {} }),
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  desktop = true
  stubMatchMedia()
  clearRecordSummaryCache()
  peekController.close()
  auth.user = { id: 1, is_staff: true, is_admin: false }
  summarySpy = vi.spyOn(api, 'getRecordSummary').mockImplementation(async (type, id) => {
    const summary = type === 'lesson' ? lesson : type === 'cohort' ? cohort : id === 19 ? dana : blair
    return { data: { summary }, error: null, status: 200 }
  })
  // jsdom doesn't track keyboard modality; treat every focus as keyboard focus.
  const matches = Element.prototype.matches
  vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
    return selector === ':focus-visible' ? true : matches.call(this, selector)
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function render(element: React.ReactNode) {
  act(() => root.render(<MemoryRouter initialEntries={['/admin']}>{element}<button type="button">After</button></MemoryRouter>))
}

function pointer(target: Element, type: 'pointerover' | 'pointerout', pointerType = 'mouse', relatedTarget: Element | null = null) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, relatedTarget })
  Object.defineProperty(event, 'pointerType', { value: pointerType })
  act(() => { target.dispatchEvent(event) })
}

async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

const card = () => document.querySelector<HTMLElement>('[role="dialog"]')
const links = () => Array.from(container.querySelectorAll<HTMLAnchorElement>('a[data-peek]'))

describe('PeekController timing', () => {
  it('opens after 300ms, closes 150ms after leaving, and stays open in the card', () => {
    const controller = new PeekController()
    controller.enter('a', 'pointer')
    vi.advanceTimersByTime(299)
    expect(controller.getSnapshot().openKey).toBeNull()
    vi.advanceTimersByTime(1)
    expect(controller.getSnapshot().openKey).toBe('a')

    controller.leave('a', 'pointer')
    controller.enterCard()
    vi.advanceTimersByTime(500)
    expect(controller.getSnapshot().openKey).toBe('a')

    controller.leaveCard()
    vi.advanceTimersByTime(149)
    expect(controller.getSnapshot().openKey).toBe('a')
    vi.advanceTimersByTime(1)
    expect(controller.getSnapshot().openKey).toBeNull()
  })

  it('switches straight to the next trigger while one is open, and leaving before 300ms opens nothing', () => {
    const controller = new PeekController()
    controller.enter('a', 'pointer')
    controller.leave('a', 'pointer')
    vi.advanceTimersByTime(1000)
    expect(controller.getSnapshot().openKey).toBeNull()

    controller.enter('a', 'pointer')
    vi.advanceTimersByTime(300)
    controller.leave('a', 'pointer')
    controller.enter('b', 'pointer')
    expect(controller.getSnapshot().openKey).toBe('b')
    vi.advanceTimersByTime(1000)
    expect(controller.getSnapshot().openKey).toBe('b')
  })

  it('Escape-style close keeps focus from reopening until focus leaves', () => {
    const controller = new PeekController()
    controller.enter('a', 'focus')
    vi.advanceTimersByTime(300)
    controller.close({ suppressFocus: true })
    controller.enter('a', 'focus')
    vi.advanceTimersByTime(300)
    expect(controller.getSnapshot().openKey).toBeNull()
    controller.leave('a', 'focus')
    controller.enter('a', 'focus')
    vi.advanceTimersByTime(300)
    expect(controller.getSnapshot().openKey).toBe('a')
  })
})

describe('peek cards on record links', () => {
  it('opens a non-modal card 300ms after hover, with identity, four facts and two actions', async () => {
    render(<RecordLink record={{ type: 'student', id: 18, cohortId: 4 }}>Blair Cruz</RecordLink>)
    const link = links()[0]
    expect(link.getAttribute('aria-haspopup')).toBe('dialog')
    expect(link.getAttribute('aria-expanded')).toBe('false')
    expect(document.getElementById(link.getAttribute('aria-describedby')!)?.textContent).toContain('Down Arrow')

    pointer(link, 'pointerover')
    expect(summarySpy).toHaveBeenCalledWith('student', 18, 4, expect.any(AbortSignal))
    await advance(299)
    expect(card()).toBeNull()
    await advance(1)
    const dialog = card()!
    expect(dialog.getAttribute('aria-modal')).toBe('false')
    expect(link.getAttribute('aria-expanded')).toBe('true')
    expect(link.getAttribute('aria-controls')).toBe(dialog.id)
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)!.textContent).toBe('Blair Cruz')
    expect(dialog.textContent).toContain('@blair_c')
    expect(dialog.textContent).toContain('Cohort 3 · no activity yet')
    expect(Array.from(dialog.querySelectorAll('dd')).map((item) => item.textContent)).toEqual(['99 / 243', '0', '1', 'Needs help'])
    expect(Array.from(dialog.querySelectorAll('a, button')).map((item) => item.textContent)).toEqual(['Open profile', 'Message'])
    expect(dialog.querySelector('a')!.getAttribute('href')).toBe('/admin/cohorts/4/students/18/overview')
    expect(dialog.className).toContain('peek-card')
    expect(dialog.style.width || dialog.className).toContain('300px')
  })

  it('keeps the card open while the pointer is in it and closes 150ms after leaving', async () => {
    render(<RecordLink record={{ type: 'student', id: 18, cohortId: 4 }}>Blair Cruz</RecordLink>)
    const link = links()[0]
    pointer(link, 'pointerover')
    await advance(300)
    pointer(link, 'pointerout', 'mouse', card())
    pointer(card()!, 'pointerover', 'mouse', link)
    await advance(1000)
    expect(card()).not.toBeNull()

    pointer(card()!, 'pointerout')
    await advance(149)
    expect(card()).not.toBeNull()
    await advance(1)
    expect(card()).toBeNull()
    expect(link.getAttribute('aria-expanded')).toBe('false')
  })

  it('opens the next card immediately once one is open and reuses cached summaries', async () => {
    render(<><RecordLink record={{ type: 'student', id: 18, cohortId: 4 }}>Blair Cruz</RecordLink> <RecordLink record={{ type: 'student', id: 19, cohortId: 4 }}>Dana Kim</RecordLink></>)
    const [first, second] = links()
    pointer(first, 'pointerover')
    await advance(300)
    pointer(first, 'pointerout', 'mouse', second)
    pointer(second, 'pointerover', 'mouse', first)
    await advance(0)
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    expect(card()!.textContent).toContain('Dana Kim')

    pointer(second, 'pointerout', 'mouse', first)
    pointer(first, 'pointerover', 'mouse', second)
    await advance(0)
    expect(card()!.textContent).toContain('Blair Cruz')
    expect(summarySpy).toHaveBeenCalledTimes(2)
  })

  it('cancels the request when the pointer leaves before the card opens', async () => {
    let signal: AbortSignal | undefined
    summarySpy.mockImplementation((_type, _id, _cohort, received) => {
      signal = received
      return new Promise(() => {})
    })
    render(<RecordLink record={{ type: 'cohort', id: 4 }}>Cohort 3</RecordLink>)
    pointer(links()[0], 'pointerover')
    await advance(100)
    pointer(links()[0], 'pointerout')
    expect(signal?.aborted).toBe(true)
    await advance(1000)
    expect(card()).toBeNull()
  })

  it('opens on keyboard focus, moves in with Down Arrow, and Escape returns to the link', async () => {
    render(<RecordLink record={{ type: 'cohort', id: 4 }}>Cohort 3</RecordLink>)
    const link = links()[0]
    act(() => link.focus())
    await advance(300)
    expect(card()).not.toBeNull()

    act(() => { link.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })) })
    expect(card()!.contains(document.activeElement)).toBe(true)
    expect(document.activeElement!.textContent).toBe('Open cohort')

    act(() => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) })
    expect(card()).toBeNull()
    expect(document.activeElement).toBe(link)
    await advance(1000)
    expect(card()).toBeNull()
  })

  it('Escape on the link closes the card at once', async () => {
    render(<RecordLink record={{ type: 'student', id: 18, cohortId: 4 }}>Blair Cruz</RecordLink>)
    pointer(links()[0], 'pointerover')
    await advance(300)
    act(() => { links()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) })
    expect(card()).toBeNull()
  })

  it('never peeks on touch: no popup attributes, no request, the tap just navigates', async () => {
    desktop = false
    render(<RecordLink record={{ type: 'student', id: 18, cohortId: 4 }}>Blair Cruz</RecordLink>)
    const link = container.querySelector('a')!
    expect(link.hasAttribute('aria-haspopup')).toBe(false)
    pointer(link, 'pointerover', 'touch')
    act(() => link.focus())
    await advance(1000)
    expect(card()).toBeNull()
    expect(summarySpy).not.toHaveBeenCalled()
  })

  it('ignores touch and pen pointers on a hybrid desktop', async () => {
    render(<RecordLink record={{ type: 'student', id: 18, cohortId: 4 }}>Blair Cruz</RecordLink>)
    const link = links()[0]
    pointer(link, 'pointerover', 'touch')
    const down = new MouseEvent('pointerdown', { bubbles: true })
    Object.defineProperty(down, 'pointerType', { value: 'touch' })
    act(() => { link.dispatchEvent(down) })
    act(() => link.focus())
    await advance(1000)
    expect(card()).toBeNull()
  })

  it('learners peek only at lessons, never at other learners or cohorts', async () => {
    auth.user = { id: 30, is_staff: false, is_admin: false }
    render(<><RecordLink record={{ type: 'lesson', id: 7, cohortId: 4 }}>Make decisions</RecordLink><RecordLink record={{ type: 'cohort', id: 4 }}>Cohort 3</RecordLink></>)
    expect(links().map((link) => link.dataset.peek)).toEqual(['lesson'])
    pointer(links()[0], 'pointerover')
    await advance(300)
    expect(Array.from(card()!.querySelectorAll('a')).map((item) => item.textContent)).toEqual(['Open lesson'])
  })

  it('a record the viewer cannot open shows no card', async () => {
    summarySpy.mockResolvedValue({ data: null, error: 'Not found', status: 404 })
    render(<RecordLink record={{ type: 'student', id: 18, cohortId: 4 }}>Blair Cruz</RecordLink>)
    pointer(links()[0], 'pointerover')
    await advance(300)
    expect(card()).toBeNull()
    expect(links()[0].getAttribute('aria-expanded')).toBe('false')
  })

  it('links can opt out', () => {
    render(<RecordLink record={{ type: 'student', id: 18, cohortId: 4 }} peek={false}>Blair Cruz</RecordLink>)
    expect(container.querySelector('a')!.hasAttribute('data-peek')).toBe(false)
  })
})

describe('peek card motion', () => {
  const css = readFileSync(resolve(__dirname, '../../index.css'), 'utf8')

  it('enters in 150ms with opacity and a 4px move on the ease-out curve', () => {
    expect(css).toMatch(/@keyframes peek-enter \{\s*from \{\s*opacity: 0;\s*transform: translateY\(4px\);/)
    expect(css).toMatch(/\.peek-card \{\s*animation: peek-enter 150ms var\(--ease-out\);/)
  })

  it('only fades under reduced motion', () => {
    const reduced = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduced).toMatch(/\.peek-card\.peek-card \{\s*animation-name: overlay-enter !important;/)
    expect(css).toMatch(/@keyframes overlay-enter \{\s*from \{\s*opacity: 0;\s*\}/)
  })
})
