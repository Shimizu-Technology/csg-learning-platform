// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { LessonView } from './LessonView'

const viewport = vi.hoisted(() => ({ width: 1023.5 }))
vi.mock('../../lib/useMediaQuery', () => ({
  useMediaQuery: (query: string) => {
    if (query === 'not all and (min-width: 1024px)') return viewport.width < 1024
    if (query === '(max-width: 1023px)') return viewport.width <= 1023
    return false
  },
}))
vi.mock('../../lib/api', () => ({
  api: {
    getLesson: async () => ({
      data: {
        lesson: {
          id: 1,
          cohort_id: 1,
          title: 'Lesson',
          module_id: 1,
          content_blocks: [],
          objectives: [{ id: 1, title: 'Objective', active: true }],
        },
      },
    }),
    getHelpRequests: async () => ({ data: { help_requests: [] } }),
  },
}))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: { id: 3 } }) }))
vi.mock('../../contexts/CohortContext', () => ({ useCohortContext: () => ({ selectedCohortId: 1 }) }))
vi.mock('../../components/shared/ContentBlockRenderer', () => ({ ContentBlockRenderer: () => null }))
vi.mock('../../components/shared/RubricPanel', () => ({ RubricPanel: () => null }))
vi.mock('../../components/student/ContextualHelp', () => ({ ContextualHelp: () => null }))
vi.mock('../../components/shared/LearningObjectivesPanel', () => ({
  LearningObjectivesPanel: () => <p>Objective details</p>,
}))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

it.each([1023.25, 1023.5, 1023.98, 1024])('chooses the matching lesson objective surface at %s', async (width) => {
  viewport.width = width
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () =>
      root.render(
        <MemoryRouter initialEntries={['/lessons/1?cohort_id=1']}>
          <Routes>
            <Route path="/lessons/:id" element={<LessonView />} />
          </Routes>
        </MemoryRouter>,
      ),
    )
    expect(Boolean(host.querySelector('details summary'))).toBe(width < 1024)
    expect(host.textContent).toContain('Objective details')
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
