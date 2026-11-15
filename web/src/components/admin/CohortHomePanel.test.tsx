// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import type { CohortHome } from '../../types/api'
import { CohortHomePanel } from './CohortHomePanel'

afterEach(() => vi.restoreAllMocks())

const home: CohortHome = {
  cohort: { id: 3, name: 'Cohort 3', status: 'active', curriculum_name: 'Synthetic curriculum', start_date: null, end_date: null, workspace_id: 9 },
  // Weekly office hours repeat with the same session id; each occurrence has its own start.
  upcoming_events: [
    { id: 'office-hours-7', title: 'Office hours', starts_at: '2026-11-18T09:00:00Z', ends_at: '2026-11-18T10:00:00Z', event_kind: 'office_hours' },
    { id: 'office-hours-7', title: 'Office hours', starts_at: '2026-11-25T09:00:00Z', ends_at: '2026-11-25T10:00:00Z', event_kind: 'office_hours' },
    { id: 12, title: 'Live class', starts_at: '2026-11-19T09:00:00Z', event_kind: 'live_class' },
  ],
  recent_announcements: [],
}

it('renders repeating office hours without a duplicate React key', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  const node = document.createElement('div')
  const root = createRoot(node)
  await act(async () => root.render(<MemoryRouter><CohortHomePanel home={home} /></MemoryRouter>))
  expect(node.querySelectorAll('p[title="Office hours"]')).toHaveLength(2)
  expect(errors.mock.calls.flat().join(' ')).not.toMatch(/same key|unique "key"/i)
  expect(node.textContent).toContain('Updates')
  await act(async () => root.unmount())
})
