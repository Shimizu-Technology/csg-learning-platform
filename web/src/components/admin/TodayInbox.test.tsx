// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { TodayInbox } from './TodayInbox'
import type { InstructorTodayData } from '../../types/api'
vi.mock('./MessageStudentsDialog', () => ({ useMessageStudent: () => ({ open: vi.fn(), opening: null }) }))
vi.mock('../shared/RecordLink', () => ({ RecordLink: ({ children }: { children: React.ReactNode }) => <a href="/record">{children}</a> }))
const today: InstructorTodayData = { items: [
  { id: 1, kind: 'help', urgent: false, student_record: true, user_id: 3, full_name: 'Alex Example', cohort_id: 4, cohort_name: 'Loops', text: 'How does this loop stop?', since: '2026-11-17T01:00:00Z', action_label: 'Reply', web_path: '/admin/help-requests/1', native_path: '/staff/support/1' },
  { id: 2, kind: 'review', urgent: false, student_record: true, user_id: 3, full_name: 'Alex Example', cohort_id: 4, cohort_name: 'Loops', text: 'Work waiting for review', since: '2026-11-16T01:00:00Z', action_label: 'Grade', web_path: '/admin/submissions/2', native_path: '/staff/submission/2' },
], counts: { help: 1, review: 1 }, attention_remaining: 0, upcoming: [] }
it('keeps server order and source text; actions return to the explicit scope and filter', () => {
  const container = document.createElement('div'); const root = createRoot(container)
  act(() => root.render(<MemoryRouter initialEntries={['/admin?cohort_id=4']}><TodayInbox today={today} /></MemoryRouter>))
  expect([...container.querySelectorAll('article')].map(e => e.dataset.todayItem)).toEqual(['help', 'review'])
  expect(container.textContent).toContain('How does this loop stop?')
  expect(container.querySelector('article > a')?.getAttribute('href')).toBe('/admin/help-requests/1?return_to=%2Fadmin%3Fcohort_id%3D4')
  act(() => root.unmount())
})
it('chips filter the inbox and retain the cohort when clearing the kind', () => {
  const container = document.createElement('div'); const root = createRoot(container)
  act(() => root.render(<MemoryRouter initialEntries={['/admin?cohort_id=4&kind=review']}><TodayInbox today={today} /></MemoryRouter>))
  expect(container.querySelectorAll('article')).toHaveLength(1)
  expect(container.querySelector('article')?.dataset.todayItem).toBe('review')
  expect(container.querySelector('h2 a')?.getAttribute('href')).toBe('/admin?cohort_id=4')
  act(() => root.unmount())
})
it('keeps pending attention visible when the selected filter is empty', () => {
  const container = document.createElement('div'); const root = createRoot(container)
  act(() => root.render(<MemoryRouter initialEntries={['/admin?kind=quiet']}><TodayInbox today={{ ...today, attention_remaining: 2 }} /></MemoryRouter>))
  expect(container.textContent).not.toContain("You're caught up")
  expect(container.textContent).toContain('2 more learners need attention')
  act(() => root.unmount())
})
it('renders a followup with urgency and its existing action', () => {
  const container = document.createElement('div'); const root = createRoot(container)
  act(() => root.render(<MemoryRouter><TodayInbox today={{ ...today, items: [{ ...today.items[0], kind: 'follow_up', urgent: true, text: 'Intervention follow-up due' }] }} /></MemoryRouter>))
  expect(container.textContent).toContain('Urgent · Intervention follow-up due')
  expect(container.textContent).not.toContain("You're caught up")
  act(() => root.unmount())
})
