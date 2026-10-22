// @vitest-environment jsdom
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { student } = vi.hoisted(() => ({ student: (id: number, name: string, extra: Record<string, unknown> = {}) => ({
  user_id: id, full_name: name, email: `${name.split(' ')[0].toLowerCase()}@example.com`, github_username: null, progress_percentage: 10,
  completed_blocks: 1, total_blocks: 10, last_sign_in_at: '2026-10-19T00:00:00Z', last_seen_at: null, last_activity_at: '2026-10-19T00:00:00Z',
  blocks_this_week: 2, submissions_this_week: 1, enrollment_status: 'active', ...extra,
}) }))

vi.mock('../../lib/api', () => ({
  api: {
    getUsers: vi.fn().mockResolvedValue({ data: { users: [] }, error: null }),
    getDashboard: vi.fn().mockResolvedValue({
      data: { dashboard: { cohorts: [{ cohort: { id: 2, name: 'Pilot', start_date: '2026-10-10', status: 'active', enrolled_count: 2, active_count: 2 }, ungraded_count: 0, students: [student(5, 'Maria Santos'), student(6, 'Bartholomew Fitzgerald', { last_sign_in_at: null, last_activity_at: null })] }] } },
      error: null,
    }),
  },
}))
vi.mock('../../lib/realtime', () => ({ subscribeToStaffPresence: () => Promise.resolve(() => undefined) }))

import { api } from '../../lib/api'
import { StudentManagement } from './StudentManagement'

const probe = { search: '' }
function LocationProbe() {
  const { search } = useLocation()
  useEffect(() => {
    probe.search = search
  }, [search])
  return null
}

async function mount(url: string) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root: Root = createRoot(container)
  await act(async () => root.render(
    <MemoryRouter initialEntries={[url]}>
      <Routes><Route path="/admin/students" element={<><StudentManagement /><LocationProbe /></>} /></Routes>
    </MemoryRouter>,
  ))
  await act(async () => { await Promise.resolve() })
  return { container, cleanup: () => { act(() => root.unmount()); container.remove() } }
}

describe('student list keeps its search and filter in the URL', () => {
  beforeEach(() => { probe.search = '' })
  afterEach(() => vi.clearAllMocks())

  it('restores search and filter from the URL and keeps unrelated params', async () => {
    const { container, cleanup } = await mount('/admin/students?q=bart&filter=never-signed-in&cohort_id=2')
    const input = container.querySelector<HTMLInputElement>('input[placeholder^="Search students"]')!
    expect(input.value).toBe('bart')
    expect(container.textContent).toContain('Bartholomew Fitzgerald')
    expect(container.textContent).not.toContain('Maria Santos')
    const neverChip = Array.from(container.querySelectorAll('button[aria-pressed]')).find((b) => b.getAttribute('aria-pressed') === 'true')!
    expect(neverChip.textContent).toMatch(/Never signed in/i)

    // Clearing the search and the filter removes those params but keeps cohort_id.
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    act(() => { setter.call(input, ''); input.dispatchEvent(new Event('input', { bubbles: true })) })
    act(() => (neverChip as HTMLButtonElement).click())
    expect(probe.search).toBe('?cohort_id=2')
    cleanup()
  })

  it('falls back to all students for an unknown filter', async () => {
    const { container, cleanup } = await mount('/admin/students?filter=nonsense')
    expect(container.textContent).toContain('Maria Santos')
    expect(container.textContent).toContain('Bartholomew Fitzgerald')
    cleanup()
  })
  it('includes omitted enrollments with status, exact workspace links, active-first order and cohort filtering', async () => {
    vi.mocked(api.getUsers).mockResolvedValueOnce({ data: { users: [
      { id: 10, full_name: 'Paused Learner', email: 'paused@example.com', enrollments: [{ id: 10, cohort_id: 3, cohort_name: 'Older cohort', status: 'paused' }] },
      { id: 11, full_name: 'Completed Learner', email: 'completed@example.com', enrollments: [{ id: 11, cohort_id: 3, cohort_name: 'Older cohort', status: 'completed' }] },
      { id: 12, full_name: 'Expired Learner', email: 'expired@example.com', enrollments: [{ id: 12, cohort_id: 3, cohort_name: 'Older cohort', status: 'active', access_expires_at: '2020-01-01T00:00:00Z' }] },
      { id: 13, full_name: 'Past Learner', email: 'past@example.com', enrollments: [{ id: 13, cohort_id: 4, cohort_name: 'Past cohort', status: 'active', cohort_status: 'completed' }] },
      { id: 14, full_name: 'Z Active Learner', email: 'active@example.com', enrollments: [{ id: 14, cohort_id: 3, cohort_name: 'Older cohort', status: 'active' }] },
    ] }, error: null } as any)
    const { container, cleanup } = await mount('/admin/students?cohort_id=3')
    for (const [id, label] of [[10, 'Paused'], [11, 'Completed'], [12, 'Access ended'], [14, 'Active']]) {
      expect(container.querySelector(`a[href="/admin/cohorts/3/students/${id}/overview"]`)?.textContent).toContain(label)
    }
    expect(container.textContent).not.toContain('Past Learner')
    const rows = [...container.querySelectorAll('a[href*="/admin/cohorts/3/students/"]')]
    expect(rows[0].textContent).toContain('Z Active Learner')
    expect(container.querySelector('option[value="4"]')?.textContent).toBe('Past cohort')
    const select = container.querySelector('select')!
    await act(async () => { select.value = '4'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(container.querySelector('a[href="/admin/cohorts/4/students/13/overview"]')?.textContent).toContain('Access ended')
    expect(container.textContent).not.toContain('Paused Learner')
    cleanup()
  })

})
