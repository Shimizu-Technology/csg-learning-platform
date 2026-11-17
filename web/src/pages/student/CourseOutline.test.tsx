// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { CourseOutline as Outline, CourseOutlineLesson } from '../../types/api'

const state = vi.hoisted(() => ({ auth: { user: { id: 4, is_staff: false } }, cohort: { selectedCohortId: 3 } }))
const mocks = vi.hoisted(() => ({ getCourseOutline: vi.fn() }))
vi.mock('../../lib/api', () => ({ api: mocks }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => state.auth }))
vi.mock('../../contexts/CohortContext', () => ({ useCohortContext: () => state.cohort }))

import { CourseOutline } from './CourseOutline'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let container: HTMLDivElement
let root: Root
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks() })

const lesson = (id: number, title: string, overrides: Partial<CourseOutlineLesson> = {}): CourseOutlineLesson => ({
  id, title, kind: 'exercise', number: id - 10, status: 'open', required: true, available: true, opens_on: null, todo: false, redo_block_id: null, ...overrides,
})

function program(): Outline {
  const next = lesson(14, 'Loops and Iteration', { todo: true })
  return {
    mode: 'program', cohort: { id: 3, name: 'Cohort 3', cohort_type: 'bootcamp', course_delivery: 'program' }, course_title: 'Web Development Bootcamp',
    enrollment_status: 'active', paused_since: null, read_only: false, counts: { completed_lessons: 3, total_lessons: 6 }, course_week: { current: 2, total: 16 },
    lesson_count: 6, next_lesson: { ...next, module_id: 5, group_key: 'm5-2' }, current_group_key: 'm5-2', filters: { todo: 2, redo: 1 },
    modules: [{
      id: 5, name: 'JavaScript Foundations', number: 1, available: true, counts: { completed_lessons: 3, total_lessons: 5 }, groups: [
        { key: 'm5-1', label: 'Week 1', week: 1, opens_on: '2026-11-02', available: true, current: false, this_week: false, counts: { completed_lessons: 2, total_lessons: 3 }, lessons: [
          lesson(11, 'Intro to Functions', { kind: 'reading', status: 'done' }),
          lesson(12, 'Functions Recap', { status: 'redo', todo: true, redo_block_id: 91 }),
          lesson(13, 'Working with the DOM', { kind: 'video', status: 'done' }),
        ] },
        { key: 'm5-2', label: 'Week 2', week: 2, opens_on: '2026-11-09', available: true, current: true, this_week: true, counts: { completed_lessons: 1, total_lessons: 2 }, lessons: [
          lesson(16, 'Live class: Conditionals walkthrough', { kind: 'recording', status: 'done' }),
          next,
        ] },
      ],
    }, {
      id: 6, name: 'The DOM', number: 2, available: false, counts: { completed_lessons: 0, total_lessons: 1 }, groups: [
        { key: 'm6-1', label: 'Week 3', week: 3, opens_on: '2026-11-23', available: false, current: false, this_week: false, counts: { completed_lessons: 0, total_lessons: 1 }, lessons: [
          lesson(15, 'Array Methods', { kind: 'checkpoint', status: 'upcoming', available: false, opens_on: '2026-11-23' }),
        ] },
      ],
    }],
  }
}

function Where() { const location = useLocation(); return <p data-testid="where">{location.pathname}{location.search}{location.hash}</p> }

async function render(outline: Outline, path = '/materials?cohort_id=3') {
  mocks.getCourseOutline.mockResolvedValue({ data: { outline } })
  await act(async () => {
    root.render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/materials" element={<CourseOutline />} /><Route path="/lessons/:id" element={<Where />} /></Routes></MemoryRouter>)
  })
}
const rows = () => Array.from(container.querySelectorAll('li[data-lesson-kind]'))
const titles = () => rows().map((row) => row.querySelector('[data-lesson-title]')?.textContent)
const button = (name: string) => Array.from(container.querySelectorAll('button')).find((item) => item.textContent?.trim().startsWith(name))!

it('puts Continue first, opens only the current week and shows real kinds and server statuses', async () => {
  await render(program())
  expect(mocks.getCourseOutline).toHaveBeenCalledWith(3, undefined)
  const bar = container.querySelector('[data-testid="continue-bar"]')!
  expect(bar.textContent).toContain('Loops and Iteration')
  expect(bar.querySelector('a')!.getAttribute('href')).toBe('/lessons/14?cohort_id=3')
  // The current week is open; the earlier week and the locked week are collapsed (U-5.6).
  expect(titles()).toEqual(['Live class: Conditionals walkthrough', 'Loops and Iteration'])
  expect(button('Week 2').getAttribute('aria-expanded')).toBe('true')
  expect(button('Week 1').getAttribute('aria-expanded')).toBe('false')
  expect(button('Week 1').textContent).toContain('2 of 3')
  expect(button('Week 1').textContent).toContain('1 redo')
  expect(button('Week 2').textContent).toContain('This week')
  expect(button('Week 3').textContent).toContain('Opens Mon, Nov 23')
  expect(rows().map((row) => row.getAttribute('data-lesson-kind'))).toEqual(['recording', 'exercise'])
  expect(container.textContent).toContain('Recording · Done')
  expect(container.querySelector('a[aria-current="step"]')!.textContent).toContain('Next up')
  expect(container.textContent).toContain('3 of 6 lessons')
  expect(container.textContent).toContain('Week 2 of 16')
  // Learners count lessons, never blocks; one filter control replaces five chips.
  expect(container.textContent).not.toMatch(/\bblocks?\b/)
  expect(container.textContent).not.toContain('Expand all')
  expect(Array.from(container.querySelectorAll('[role="group"][aria-label="Show"] button')).map((item) => item.textContent)).toEqual(['All', 'To do2', 'Needs redo1'])
})

it('opens a week from its row, keeps it in the URL and links a redo to its block', async () => {
  await render(program())
  await act(async () => button('Week 1').click())
  expect(titles()).toContain('Functions Recap')
  const redo = Array.from(container.querySelectorAll('a')).find((item) => item.textContent?.includes('Functions Recap'))!
  expect(redo.getAttribute('href')).toBe('/lessons/12?cohort_id=3#block-91')
  expect(redo.textContent).toContain('Exercise · Redo requested')
  await act(async () => redo.click())
  expect(container.querySelector('[data-testid="where"]')!.textContent).toBe('/lessons/12?cohort_id=3#block-91')
})

it('filters with the server’s buckets and searches every week', async () => {
  await render(program())
  await act(async () => button('Needs redo').click())
  expect(titles()).toEqual(['Functions Recap'])
  await act(async () => button('To do').click())
  expect(titles()).toEqual(['Functions Recap', 'Loops and Iteration'])
  await act(async () => button('All').click())
  const search = container.querySelector<HTMLInputElement>('input[type="search"]')!
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(search, 'array')
    search.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(titles()).toEqual(['Array Methods'])
  expect(container.textContent).toContain('Check · Opens Mon, Nov 23')
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(search, 'nothing like this')
    search.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(container.textContent).toContain('No lessons match “nothing like this”')
})

it('opens the module a link names', async () => {
  await render(program(), '/materials?cohort_id=3&module=6')
  expect(button('Week 3').getAttribute('aria-expanded')).toBe('true')
  expect(titles()).toContain('Array Methods')
})

it('numbers self-paced lessons without dates or weekdays', async () => {
  const outline = program()
  outline.mode = 'self_paced'
  outline.course_week = null
  outline.modules.forEach((mod) => mod.groups.forEach((group, index) => { group.label = mod.groups.length > 1 ? `Part ${index + 1} · lessons ${group.lessons[0].number}–${group.lessons.at(-1)!.number}` : null; group.week = null; group.opens_on = null; group.this_week = false }))
  await render(outline)
  expect(container.querySelector('[data-testid="continue-bar"]')!.textContent).toContain('Continue · lesson 4 of 6')
  expect(container.textContent).toContain('Self-paced · 3 of 6 lessons')
  expect(container.textContent).toContain('1. JavaScript Foundations')
  expect(container.textContent).not.toMatch(/Monday|Tuesday|Week \d/)
  expect(rows()[1].textContent?.startsWith('4')).toBe(true)
})

it('frames the alumni library as a library', async () => {
  const outline = program()
  outline.mode = 'library'
  outline.counts = null
  outline.next_lesson = null
  outline.current_group_key = null
  outline.course_week = null
  outline.modules.forEach((mod) => { mod.counts = null; mod.groups = [{ ...mod.groups[0], label: null, counts: null, current: false, this_week: false, lessons: mod.groups.flatMap((group) => group.lessons) }] })
  await render(outline)
  expect(container.querySelector('h1')!.textContent).toBe('CSG Alumni library')
  expect(container.querySelector('[data-testid="continue-bar"]')).toBeNull()
  expect(container.querySelector('[role="group"][aria-label="Show"]')).toBeNull()
  expect(container.textContent).not.toMatch(/\d+ of \d+/)
  expect(container.querySelector('input[type="search"]')!.getAttribute('placeholder')).toBe('Search the library')
  expect(titles()).toContain('Intro to Functions')
  // A historical redo is past feedback here, not work: no redo, progress or next badges (U-5.10).
  expect(titles()).toContain('Functions Recap')
  expect(container.textContent).not.toMatch(/\bredos?\b/i)
  expect(container.textContent).not.toContain('Next up')
  expect(container.querySelector('a[aria-current="step"]')).toBeNull()
})

it('tells a paused learner their past lessons stay open, without a next step', async () => {
  const outline = program()
  Object.assign(outline, { read_only: true, enrollment_status: 'paused', paused_since: '2026-11-14', next_lesson: null, current_group_key: null, filters: { todo: 0, redo: 1 } })
  await render(outline)
  expect(container.textContent).toContain('Your enrollment is paused since Nov 14')
  expect(container.querySelector('[data-testid="continue-bar"]')).toBeNull()
  expect(Array.from(container.querySelectorAll('[role="group"][aria-label="Show"] button')).map((item) => item.textContent)).toEqual(['All', 'Needs redo1'])
})

it('a recording week link opens its named week instead of the current week', async () => {
  await render(program(), '/materials?cohort_id=3&week=1')
  expect(button('Week 1').getAttribute('aria-expanded')).toBe('true')
  expect(button('Week 2').getAttribute('aria-expanded')).toBe('false')
})

it('module mentions are links to their place in this course outline', async () => {
  await render(program())
  const link = container.querySelector('h2 a[href="/materials?cohort_id=3&module=5"]')
  expect(link?.textContent).toContain('JavaScript')
})

it.each([1, 2])('a week hint is consumed so Week %s stays collapsed', async (week) => {
  await render(program(), `/materials?cohort_id=3&week=${week}&open=m5-${week}`)
  expect(button(`Week ${week}`).getAttribute('aria-expanded')).toBe('true')
  await act(async () => button(`Week ${week}`).click())
  expect(button(`Week ${week}`).getAttribute('aria-expanded')).toBe('false')
})

it('collapsing a hinted week preserves the other expanded week', async () => {
  await render(program(), '/materials?cohort_id=3&week=1&open=m5-1')
  await act(async () => button('Week 2').click())
  expect(button('Week 1').getAttribute('aria-expanded')).toBe('true')
  expect(button('Week 2').getAttribute('aria-expanded')).toBe('true')
  await act(async () => button('Week 1').click())
  expect(button('Week 1').getAttribute('aria-expanded')).toBe('false')
  expect(button('Week 2').getAttribute('aria-expanded')).toBe('true')
})

it('a module-relative week hint opens every matching group and each can stay collapsed', async () => {
  const outline = program()
  Object.assign(outline.modules[1].groups[0], { label: 'Week 1', week: 1 })
  await render(outline, '/materials?cohort_id=3&week=1')
  const weeks = Array.from(container.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')).filter(item => item.textContent?.trim().startsWith('Week 1'))
  expect(weeks).toHaveLength(2)
  expect(weeks.map(item => item.getAttribute('aria-expanded'))).toEqual(['true', 'true'])
  await act(async () => weeks[0].click())
  expect(weeks.map(item => item.getAttribute('aria-expanded'))).toEqual(['false', 'true'])
})
it('an unmatched week hint retains the current-group fallback', async () => {
  await render(program(), '/materials?cohort_id=3&week=99')
  expect(button('Week 2').getAttribute('aria-expanded')).toBe('true')
})
