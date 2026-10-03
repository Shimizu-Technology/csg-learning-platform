// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CohortSwitcher } from '../components/shared/CohortSwitcher'
import { api } from '../lib/api'
import { CohortProvider, useCohortContext } from './CohortContext'

vi.mock('./AuthContext', () => ({ useAuthContext: () => ({ user: { id: 7, is_staff: true, is_admin: true } }) }))

const cohorts = [
  { id: 1, name: 'Cohort One', status: 'active', cohort_type: 'bootcamp', curriculum_name: 'Web', workspace_id: 11, enrollment_status: null },
  { id: 2, name: 'Cohort Two', status: 'active', cohort_type: 'workshop', curriculum_name: 'AI', workspace_id: 22, enrollment_status: null },
]

function TestSurface() {
  const { selectedCohort, selectedCohortId, setSelectedCohort } = useCohortContext()
  const location = useLocation()
  return <>
    <CohortSwitcher />
    <button onClick={() => setSelectedCohort(1)}>Set cohort one scope</button>
    <button onClick={() => setSelectedCohort(1, { searchParams: new URLSearchParams('cohort_id=1&page=1&source=notification') })}>Set cohort and query</button>
    <button onClick={() => setSelectedCohort(null)}>Clear cohort scope</button>
    <output>{location.pathname}{location.search} · {selectedCohort?.name || 'All cohorts'} · {selectedCohortId ?? 'none'}</output>
  </>
}

describe('cohort selection', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    localStorage.clear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('uses an authorized deep link and switches from a stale detail route to the new cohort home', async () => {
    vi.spyOn(api, 'getAccessibleCohorts').mockResolvedValue({ data: { cohorts }, error: null, status: 200 })
    const router = createMemoryRouter([{ path: '*', element: <CohortProvider><TestSurface /></CohortProvider> }], { initialEntries: ['/admin/cohorts/2/students/99'] })
    await act(async () => { root.render(<RouterProvider router={router} />) })
    expect(container.textContent).toContain('Cohort Two')

    const select = container.querySelector('select')!
    await act(async () => { select.value = '1'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(container.textContent).toContain('/admin/cohorts/1 · Cohort One')
    expect(localStorage.getItem('csg-selected-cohort:7')).toBe('1')
  })

  it('does not use a stale cached access list to restore a cohort', async () => {
    vi.spyOn(api, 'getAccessibleCohorts').mockResolvedValue({ data: { cohorts }, error: 'Network unavailable', status: 503, fromCache: true })
    localStorage.setItem('csg-selected-cohort:7', '2')
    const router = createMemoryRouter([{ path: '*', element: <CohortProvider><TestSurface /></CohortProvider> }], { initialEntries: ['/admin'] })
    await act(async () => { root.render(<RouterProvider router={router} />) })
    expect(container.textContent).toContain('All cohorts')
    expect(container.querySelectorAll('option').length).toBe(1)
  })

  it('updates the global cohort preference without forcing navigation', async () => {
    vi.spyOn(api, 'getAccessibleCohorts').mockResolvedValue({ data: { cohorts }, error: null, status: 200 })
    const router = createMemoryRouter([{ path: '*', element: <CohortProvider><TestSurface /></CohortProvider> }], { initialEntries: ['/messages'] })
    await act(async () => { root.render(<RouterProvider router={router} />) })

    const button = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === 'Set cohort one scope')!
    await act(async () => { button.click() })

    expect(container.textContent).toContain('/messages · Cohort One · 1')
    expect(localStorage.getItem('csg-selected-cohort:7')).toBe('1')
  })

  it('keeps an explicit cohort query aligned with the global selection', async () => {
    vi.spyOn(api, 'getAccessibleCohorts').mockResolvedValue({ data: { cohorts }, error: null, status: 200 })
    const router = createMemoryRouter([{ path: '*', element: <CohortProvider><TestSurface /></CohortProvider> }], { initialEntries: ['/messages?cohort_id=2&source=notification'] })
    await act(async () => { root.render(<RouterProvider router={router} />) })

    const setButton = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === 'Set cohort one scope')!
    await act(async () => { setButton.click() })
    expect(container.textContent).toContain('/messages?cohort_id=1&source=notification · Cohort One · 1')

    const clearButton = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === 'Clear cohort scope')!
    await act(async () => { clearButton.click() })
    expect(container.textContent).toContain('/messages?source=notification · All cohorts · none')
  })

  it('applies a supplied query atomically with the global selection', async () => {
    vi.spyOn(api, 'getAccessibleCohorts').mockResolvedValue({ data: { cohorts }, error: null, status: 200 })
    const router = createMemoryRouter([{ path: '*', element: <CohortProvider><TestSurface /></CohortProvider> }], { initialEntries: ['/announcements?cohort_id=2&page=7&source=notification'] })
    await act(async () => { root.render(<RouterProvider router={router} />) })

    const button = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === 'Set cohort and query')!
    await act(async () => { button.click() })

    expect(container.textContent).toContain('/announcements?cohort_id=1&page=1&source=notification · Cohort One · 1')
  })

  it('preserves an inaccessible explicit cohort for the API to reject', async () => {
    vi.spyOn(api, 'getAccessibleCohorts').mockResolvedValue({ data: { cohorts }, error: null, status: 200 })
    localStorage.setItem('csg-selected-cohort:7', '1')
    const router = createMemoryRouter([{ path: '*', element: <CohortProvider><TestSurface /></CohortProvider> }], { initialEntries: ['/lessons/42?cohort_id=99'] })
    await act(async () => { root.render(<RouterProvider router={router} />) })
    expect(container.textContent).toContain('All cohorts · 99')
    expect(localStorage.getItem('csg-selected-cohort:7')).toBe('1')
  })
})
