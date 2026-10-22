// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
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
