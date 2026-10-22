// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ getRecordings: vi.fn() }))
vi.mock('../../lib/api', () => ({ api: { getRecordings: state.getRecordings, getDashboard: vi.fn(async () => ({ data: { dashboard: { capabilities: { can_submit: true, read_only: false, support_mode: 'guided_help', support_expires_at: null, access_expires_at: null, support_instructor_id: 1 } } }, error: null })) } }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: { id: 9 }, enrollments: [] }) }))
vi.mock('../../contexts/CohortContext', () => ({ useCohortContext: () => ({ selectedCohortId: 2 }) }))
vi.mock('../../lib/useMediaQuery', () => ({ useMediaQuery: () => true }))
vi.mock('../../components/shared/VideoPlayer', () => ({ VideoPlayer: ({ title }: { title: string }) => <div data-testid="player">{title}</div> }))
vi.mock('../../components/student/ContextualHelp', () => ({ ContextualHelp: () => null }))
import { Recordings } from './Recordings'
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
