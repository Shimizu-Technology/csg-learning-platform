// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ cohort: null as Record<string, unknown> | null, auth: { user: { id: 4, is_staff: false }, schoolFeatures: {} as Record<string, boolean> } }))
vi.mock('../contexts/CohortContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../contexts/CohortContext')>()
  // `state.cohort` set: a fixed context. Null: the real provider.
  return { ...actual, useCohortContext: () => state.cohort ?? actual.useCohortContext() }
})
vi.mock('../contexts/AuthContext', () => ({ useAuthContext: () => state.auth }))

import { CohortProvider } from '../contexts/CohortContext'
import { api } from './api'
import { StudentExperienceProvider, studentExperienceOn, useStudentExperience } from './studentExperience'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let container: HTMLDivElement
let root: Root
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); localStorage.clear() })
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); state.cohort = null; state.auth.schoolFeatures = {} })

function Probe() {
  const { ready, v2, failed } = useStudentExperience()
  return <p>{ready ? (v2 ? 'v2' : failed ? 'v1 failed' : 'v1') : 'waiting'}</p>
}
const cohort = (id: number, features: Record<string, boolean>) => ({ id, name: `Cohort ${id}`, status: 'active', features, capabilities: { features } })
const render = (node = <Probe />) => act(() => root.render(node))

describe('only an explicit on shows the new experience (P1)', () => {
  it('waits for the cohort list, then follows the explicit switch', () => {
    state.cohort = { ready: false, selectedCohort: null, selectedCohortId: 3, error: null }
    render()
    expect(container.textContent).toBe('waiting')
    state.cohort = { ready: true, selectedCohort: cohort(3, { student_experience_v2: false }), selectedCohortId: 3, error: null }
    render()
    expect(container.textContent).toBe('v1')
    state.cohort = { ready: true, selectedCohort: cohort(3, { student_experience_v2: true }), selectedCohortId: 3, error: null }
    render()
    expect(container.textContent).toBe('v2')
  })

  it('keeps today’s view for a cached payload without the key', () => {
    state.cohort = { ready: true, selectedCohort: cohort(3, { recordings: true }), selectedCohortId: 3, error: null }
    render()
    expect(container.textContent).toBe('v1')
  })

  it('keeps today’s view when the cohort key is missing, whatever the school setting', () => {
    for (const school of [false, true]) {
      state.auth.schoolFeatures = { student_experience_v2: school }
      state.cohort = { ready: true, selectedCohort: cohort(3, {}), selectedCohortId: 3, error: null }
      render()
      expect(container.textContent).toBe('v1')
    }
    state.cohort = { ready: true, selectedCohort: null, selectedCohortId: null, error: null }
    render()
    expect(container.textContent).toBe('v1')
  })

  it('an offline cold start shows today’s view and says the lookup failed', () => {
    state.cohort = { ready: true, selectedCohort: null, selectedCohortId: 3, error: 'Could not load your cohorts.' }
    render()
    expect(container.textContent).toBe('v1 failed')
  })

  it('a staff preview shows the previewed cohort, not the viewer', () => {
    state.cohort = { ready: false, selectedCohort: null, selectedCohortId: null, error: null }
    render(<StudentExperienceProvider v2><Probe /></StudentExperienceProvider>)
    expect(container.textContent).toBe('v2')
    expect(studentExperienceOn(undefined)).toBe(false)
    expect(studentExperienceOn({})).toBe(false)
    expect(studentExperienceOn({ student_experience_v2: false })).toBe(false)
    expect(studentExperienceOn({ student_experience_v2: true })).toBe(true)
  })
})

describe('a kept decision belongs to one user and cohort (P2)', () => {
  it('keeps a cohort’s view through its own failed refresh only', () => {
    state.cohort = { ready: true, selectedCohort: cohort(2, { student_experience_v2: true }), selectedCohortId: 2, error: null }
    render()
    expect(container.textContent).toBe('v2')
    state.cohort = { ready: true, selectedCohort: null, selectedCohortId: 2, error: 'Could not load your cohorts.' }
    render()
    expect(container.textContent).toBe('v2')
    state.cohort = { ready: true, selectedCohort: null, selectedCohortId: 3, error: 'Could not load your cohorts.' }
    render()
    expect(container.textContent).toBe('v1 failed')
    state.auth = { ...state.auth, user: { id: 9, is_staff: false } }
    state.cohort = { ready: true, selectedCohort: null, selectedCohortId: 2, error: 'Could not load your cohorts.' }
    render()
    expect(container.textContent).toBe('v1 failed')
    state.auth = { ...state.auth, user: { id: 4, is_staff: false } }
  })

  it('with the real cohort provider, a failed refresh doesn’t carry On to another cohort', async () => {
    state.cohort = null
    const accessible = vi.spyOn(api, 'getAccessibleCohorts').mockResolvedValueOnce({
      data: { cohorts: [cohort(2, { student_experience_v2: true }), cohort(3, { student_experience_v2: false })] }, error: null,
    } as never)
    const router = createMemoryRouter([{ path: '/materials', element: <CohortProvider><Probe /></CohortProvider> }], { initialEntries: ['/materials?cohort_id=2'] })
    await act(async () => root.render(<RouterProvider router={router} />))
    expect(container.textContent).toBe('v2')
    accessible.mockResolvedValue({ data: null, error: 'Network error', errorKind: 'network' } as never)
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    await act(async () => { await router.navigate('/materials?cohort_id=3') })
    expect(container.textContent).toBe('v1 failed')
  })
})
