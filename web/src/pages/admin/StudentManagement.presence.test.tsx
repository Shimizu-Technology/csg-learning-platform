// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PresenceUpdateEvent } from '../../lib/realtime'

const presence = vi.hoisted(() => ({ listener: null as ((event: PresenceUpdateEvent) => void) | null }))

vi.mock('../../lib/api', () => ({
  api: {
    getUsers: vi.fn().mockResolvedValue({ data: { users: [] }, error: null }),
    getDashboard: vi.fn().mockResolvedValue({
      data: { dashboard: { cohorts: [{
        cohort: { id: 2, name: 'Pilot', start_date: '2026-10-10', status: 'active', enrolled_count: 1, active_count: 1 },
        ungraded_count: 0,
        students: [{
          user_id: 5, full_name: 'Maria Santos', email: 'maria@example.com', github_username: null, progress_percentage: 10,
          completed_blocks: 1, total_blocks: 10, last_sign_in_at: '2026-10-19T00:00:00Z', last_seen_at: '2026-10-19T00:00:00Z',
          last_activity_at: '2026-10-19T00:00:00Z', blocks_this_week: 2, submissions_this_week: 1, enrollment_status: 'active',
        }],
      }] } },
      error: null,
    }),
  },
}))
vi.mock('../../lib/realtime', () => ({
  subscribeToStaffPresence: (listener: (event: PresenceUpdateEvent) => void) => {
    presence.listener = listener
    return Promise.resolve(() => undefined)
  },
}))

import { StudentManagement } from './StudentManagement'

describe('student list presence', () => {
  afterEach(() => {
    presence.listener = null
    vi.clearAllMocks()
  })

  it('turns a student badge Online when a presence event arrives', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root: Root = createRoot(container)
    await act(async () => root.render(
      <MemoryRouter initialEntries={['/admin/students']}>
        <Routes><Route path="/admin/students" element={<StudentManagement />} /></Routes>
      </MemoryRouter>,
    ))
    await act(async () => { await Promise.resolve() })

    const row = () => Array.from(container.querySelectorAll('tr')).find((tr) => tr.textContent?.includes('Maria Santos'))!
    expect(row().textContent).toContain('Offline')
    expect(presence.listener).toBeTypeOf('function')

    act(() => presence.listener!({ event: 'presence.updated', user_id: 5, last_seen_at: new Date().toISOString() }))

    expect(row().textContent).toContain('Online')
    expect(row().textContent).not.toContain('Offline')

    act(() => root.unmount())
    container.remove()
  })
})
