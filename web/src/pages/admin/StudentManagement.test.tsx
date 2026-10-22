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
})
