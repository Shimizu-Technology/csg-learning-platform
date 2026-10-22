// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { CohortProvider, useCohortContext } from '../../contexts/CohortContext'
import { ActivityTimeline } from './ActivityTimeline'
import { LessonView } from '../../pages/student/LessonView'
import { Recordings } from '../../pages/student/Recordings'

const state = vi.hoisted(() => ({ getLesson: vi.fn(), getRecordings: vi.fn(), getActivityEvents: vi.fn(), getAccessibleCohorts: vi.fn() }))
vi.mock('../../lib/api', () => ({ api: { ...state, getHelpRequests: vi.fn().mockResolvedValue({ data: { help_requests: [] } }) } }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: { id: 9 }, enrollments: [] }) }))
vi.mock('../../lib/useMediaQuery', () => ({ useMediaQuery: () => true }))
vi.mock('./ContentBlockRenderer', () => ({ ContentBlockRenderer: () => <p>Exact exercise feedback</p> }))
vi.mock('./RubricPanel', () => ({ RubricPanel: () => null }))
vi.mock('./LearningObjectivesPanel', () => ({ LearningObjectivesPanel: () => null }))
vi.mock('../student/ContextualHelp', () => ({ ContextualHelp: () => null }))
vi.mock('./VideoPlayer', () => ({ VideoPlayer: ({ title }: { title: string }) => <div data-testid="player">{title}</div> }))

function Selection() {
  const { selectedCohortId } = useCohortContext()
  return <><output data-testid="selection">{selectedCohortId}</output><Link to="/overview">Overview</Link></>
}
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  localStorage.setItem('csg-selected-cohort:9', '3')
  state.getAccessibleCohorts.mockResolvedValue({ data: { cohorts: [{ id: 2, name: 'Linked cohort', status: 'active' }, { id: 3, name: 'Previous cohort', status: 'active' }] } })
  state.getLesson.mockResolvedValue({ data: { lesson: { id: 42, cohort_id: 2, title: 'Activity lesson', module_id: 1, lesson_type: 'exercise', content_blocks: [{ id: 8, position: 0, block_type: 'exercise' }], objectives: [] } } })
  state.getRecordings.mockResolvedValue({ data: { items: [{ id: 8, cohort_id: 2, title: 'First recording', source: 'uploaded' }, { id: 9, cohort_id: 2, title: 'Exact activity recording', source: 'uploaded' }] } })
  Element.prototype.scrollIntoView = vi.fn()
})
it.each(['lesson', 'recording'])('opens an activity %s with another selected cohort, mounts its exact target and persists the switch', async (kind) => {
  state.getActivityEvents.mockResolvedValue({ data: { activity_events: [{ id: 1, event_type: kind === 'lesson' ? 'video_started' : 'recording_started', actor: { id: 9 }, subject_user_id: 9, cohort_id: 2, record_label: 'Linked activity', created_at: '2026-10-22', destination: { kind, cohort_id: 2, student_id: 9, lesson_id: 42, content_block_id: 8, recording_id: 9, destination_path: kind === 'lesson' ? '/lessons/42?cohort_id=2#block-8' : '/recordings?cohort_id=2&recording=9' } }], next_before_id: null } })
  const container = document.createElement('div'); document.body.appendChild(container)
  const root = createRoot(container)
  const click = async (label: string) => {
    const link = Array.from(container.querySelectorAll('a')).find(item => item.textContent === label)
    expect(link).toBeTruthy()
    await act(async () => link!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })))
  }
  try {
    await act(async () => root.render(<MemoryRouter initialEntries={['/activity']}><CohortProvider><Selection /><Routes><Route path="/activity" element={<ActivityTimeline />} /><Route path="/lessons/:id" element={<LessonView />} /><Route path="/recordings" element={<Recordings />} /><Route path="/overview" element={<p>Course overview</p>} /></Routes></CohortProvider></MemoryRouter>))
    expect(container.querySelector('[data-testid="selection"]')?.textContent).toBe('3')
    await click(kind === 'lesson' ? 'Open learning step' : 'Open recording')
    await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)) })
    expect(container.textContent).toContain('Switched to Linked cohort')
    expect(container.querySelector('[data-testid="selection"]')?.textContent).toBe('2')
    expect(localStorage.getItem('csg-selected-cohort:9')).toBe('2')
    if (kind === 'lesson') {
      expect(state.getLesson).toHaveBeenCalledWith(42, 2)
      expect(state.getLesson.mock.calls.every(([, cohort]) => cohort === 2)).toBe(true)
      expect(container.querySelector('#block-8')?.textContent).toContain('Exact exercise feedback')
      expect(document.activeElement?.id).toBe('block-8')
      expect(container.querySelector('#block-8')?.className).toContain('ring-2')
    } else {
      expect(state.getRecordings).toHaveBeenCalledWith(2)
      expect(state.getRecordings.mock.calls.every(([cohort]) => cohort === 2)).toBe(true)
      expect(container.querySelector('[data-testid="player"]')?.textContent).toBe('Exact activity recording')
    }
    await click('Overview')
    expect(container.querySelector('[data-testid="selection"]')?.textContent).toBe('2')
    expect(container.textContent).toContain('Course overview')
  } finally { act(() => root.unmount()); container.remove() }
})
