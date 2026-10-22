// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ModuleView } from './ModuleView'

const mocks = vi.hoisted(() => ({ getModule: vi.fn(), getDashboard: vi.fn() }))
vi.mock('../../lib/api', () => ({ api: mocks }))
vi.mock('../../contexts/CohortContext', () => ({ useCohortContext: () => ({ selectedCohortId: 9 }) }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: { is_staff: false } }) }))

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mocks.getDashboard.mockResolvedValue({ error: 'Unavailable' })
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks() })

async function renderLessons(lessons: object[]) {
  mocks.getModule.mockResolvedValue({ data: { module: { id: 1, name: 'Foundations', lessons } } })
  await act(async () => { root.render(<MemoryRouter initialEntries={['/modules/1?cohort_id=9']}><Routes><Route path="/modules/:id" element={<ModuleView />} /></Routes></MemoryRouter>) })
}

it('shows locked summaries and opening dates without a link, including wholly locked days', async () => {
  await renderLessons([
    { id: 10, title: 'Available lesson', lesson_type: 'reading', release_day: 0, available: true, content_blocks_count: 2 },
    { id: 11, title: 'Future lesson', lesson_type: 'exercise', release_day: 7, available: false, unlock_date: '2030-07-15', content_blocks_count: 1 },
  ])
  expect(container.textContent).toContain('Future lesson')
  expect(container.textContent).toContain('Opens Jul 15, 2030 (ChST)')
  expect(container.textContent).toContain('Week 2')
  expect(container.querySelector('a[href="/lessons/11?cohort_id=9"]')).toBeNull()
  expect(container.querySelector('a[href="/lessons/10?cohort_id=9"]')).not.toBeNull()
  expect(container.textContent).toContain('2 blocks')
  expect(container.textContent).not.toContain('Tuesday')
  expect(mocks.getModule).toHaveBeenCalledWith(1, 9)
})

it('renders a lesson-only module without inventing sibling lessons or empty days', async () => {
  await renderLessons([{ id: 20, title: 'Assigned lesson', lesson_type: 'reading', release_day: 2, available: true, content_blocks_count: 1 }])
  expect(container.querySelectorAll('a[href^="/lessons/"]')).toHaveLength(1)
  expect(container.textContent).toContain('Wednesday')
  expect(container.textContent).not.toContain('Monday')
  expect(container.textContent).not.toContain('Tuesday')
})

it('keeps an undated locked assignment visible without making it navigable', async () => {
  await renderLessons([{ id: 21, title: 'Locked assignment', lesson_type: 'reading', release_day: 0, available: false, unlock_date: null }])
  expect(container.textContent).toContain('Locked assignment')
  expect(container.querySelector('a[href^="/lessons/"]')).toBeNull()
})

it('keeps widened M-F student schedules free of empty Tuesday and Thursday groups', async () => {
  await renderLessons([0, 2, 4].map((release_day, index) => ({ id: 100 + index, title: `MWF lesson ${index}`, lesson_type: 'exercise', release_day, available: true, content_blocks_count: 1 })))
  expect(Array.from(container.querySelectorAll('h3')).map(heading => heading.textContent)).toEqual(['Monday', 'Wednesday', 'Friday'])
  expect(container.textContent).not.toContain('Show empty days')
})
