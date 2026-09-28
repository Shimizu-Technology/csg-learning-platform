// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '../../lib/api'
import type { CohortDetail } from '../../types/api'
import { CohortWorkspace } from './CohortWorkspace'

const cohort = {
  id: 4,
  name: 'CSG Alumni',
  cohort_type: 'alumni',
  curriculum_id: 2,
  curriculum_name: 'Alumni Library',
  start_date: '2026-09-26',
  end_date: null,
  github_organization_name: 'Code-School-of-Guam-Alumni',
  repository_name: null,
  requires_github: false,
  status: 'active',
  settings: {},
  enrolled_count: 2,
  active_count: 2,
  announcements: [],
  modules: [],
  students: [
    { enrollment_id: 1, user_id: 10, full_name: 'Joined Alum', email: 'joined@example.com', github_username: 'joined', status: 'active', enrolled_at: null, invited_at: '2026-09-26T00:00:00Z', joined_at: '2026-09-27T00:00:00Z', last_sign_in_at: '2026-09-27T00:00:00Z', invite_pending: false, invite_delivery_status: 'accepted', module_assignments: [] },
    { enrollment_id: 2, user_id: 11, full_name: 'Invited Alum', email: 'invited@example.com', github_username: 'invited', status: 'active', enrolled_at: null, invited_at: '2026-09-26T00:00:00Z', joined_at: null, last_sign_in_at: null, invite_pending: true, invite_delivery_status: 'sent', module_assignments: [] },
  ],
} satisfies CohortDetail

describe('cohort access roster', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    vi.spyOn(api, 'getCohort').mockResolvedValue({ data: { cohort }, error: null, status: 200 })
    vi.spyOn(api, 'getCohortGithubAccess').mockResolvedValue({ data: { organization: 'Code-School-of-Guam-Alumni', checked_at: '2026-09-27T00:00:00Z', statuses: { '10': 'member', '11': 'invited' } }, error: null, status: 200 })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  it('shows separate app and GitHub invitation states and filters pending invites', async () => {
    const router = createMemoryRouter([{ path: '/admin/cohorts/:id', element: <CohortWorkspace /> }], { initialEntries: ['/admin/cohorts/4?tab=students'] })
    await act(async () => { root.render(<RouterProvider router={router} />) })
    await act(async () => { await Promise.resolve() })

    expect(container.textContent).toContain('Signed in to app')
    expect(container.textContent).toContain('App invite sent')
    expect(container.textContent).toContain('Joined cohort')
    expect(container.textContent).toContain('Added, not yet opened')
    expect(container.textContent).toContain('Joined GitHub org')
    expect(container.textContent).toContain('GitHub invite pending')

    const select = container.querySelector('select')!
    await act(async () => { select.value = 'github_invited'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(container.textContent).toContain('Showing 1 of 2 enrolled')
    expect(container.textContent).toContain('Invited Alum')
    expect(container.textContent).not.toContain('Joined Alum')
  })

  it('filters cohort entry independently of app and GitHub status', async () => {
    const router = createMemoryRouter([{ path: '/admin/cohorts/:id', element: <CohortWorkspace /> }], { initialEntries: ['/admin/cohorts/4?tab=students'] })
    await act(async () => { root.render(<RouterProvider router={router} />) })
    const select = container.querySelector('select')!
    await act(async () => { select.value = 'cohort_not_opened'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(container.textContent).toContain('Showing 1 of 2 enrolled')
    expect(container.textContent).toContain('Invited Alum')
    expect(container.textContent).not.toContain('Joined Alum')
  })

  it('clears a GitHub filter and cached statuses when refresh fails', async () => {
    const router = createMemoryRouter([{ path: '/admin/cohorts/:id', element: <CohortWorkspace /> }], { initialEntries: ['/admin/cohorts/4?tab=students'] })
    await act(async () => { root.render(<RouterProvider router={router} />) })
    await act(async () => { await Promise.resolve() })

    const select = container.querySelector('select')!
    await act(async () => { select.value = 'github_invited'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(container.textContent).toContain('Showing 1 of 2 enrolled')

    vi.mocked(api.getCohortGithubAccess).mockResolvedValueOnce({ data: { organization: 'Code-School-of-Guam-Alumni', checked_at: '2026-09-27T00:00:00Z', statuses: { '10': 'member', '11': 'invited' } }, error: 'GitHub is unavailable', status: 502, fromCache: true })
    const refresh = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Refresh GitHub'))!
    await act(async () => { refresh.click() })

    expect(select.value).toBe('all')
    expect(container.textContent).toContain('Showing 2 of 2 enrolled')
    expect(container.textContent).toContain('Signed in to app')
    expect(container.textContent).toContain('App invite sent')
    expect(container.textContent).toContain('GitHub status unavailable')
    expect(Array.from(container.querySelectorAll('span')).some((span) => span.textContent === 'Joined GitHub org')).toBe(false)
    expect(container.textContent).not.toContain('GitHub checked')
  })

  it('does not present an initial cached GitHub response as current', async () => {
    vi.mocked(api.getCohortGithubAccess).mockResolvedValueOnce({ data: { organization: 'Code-School-of-Guam-Alumni', checked_at: '2026-09-27T00:00:00Z', statuses: { '10': 'member', '11': 'invited' } }, error: 'GitHub is unavailable', status: 502, fromCache: true })
    const router = createMemoryRouter([{ path: '/admin/cohorts/:id', element: <CohortWorkspace /> }], { initialEntries: ['/admin/cohorts/4?tab=students'] })
    await act(async () => { root.render(<RouterProvider router={router} />) })
    await act(async () => { await Promise.resolve() })

    expect(container.textContent).toContain('GitHub status unavailable')
    expect(container.textContent).not.toContain('GitHub checked')
    expect(container.querySelector<HTMLSelectElement>('select')!.querySelector<HTMLOptionElement>('option[value="github_member"]')!.disabled).toBe(true)
  })
})
