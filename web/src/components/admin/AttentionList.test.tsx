// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { expect, it } from 'vitest'
import { AttentionList } from './AttentionList'
import type { SupportQueueStudent } from '../../types/api'

it('renders the server reasons in order and opens the exact enrollment action', () => {
  const action = { label: 'Review work', web_path: '/admin/submissions/42?enrollment_id=9&cohort_id=4&student_id=18', native_path: '/staff/submission/42?enrollment_id=9', enrollment_id: 9 }
  const student = { enrollment_id: 9, user_id: 18, full_name: 'Learner', cohort_name: 'Python', email: 'learner@example.com', progress_percentage: 2, completed_blocks: 1, total_blocks: 50, released_unfinished_blocks: 3, next_action: action, reasons: [{ code: 'review', label: '1 latest attempt awaiting review', source_type: 'Submission', source_ids: [42], since: '', action }, { code: 'inactivity', label: 'Consider a check-in', source_type: 'Enrollment', source_ids: [9], since: '', action }] } as SupportQueueStudent
  const container = document.createElement('div'); const root = createRoot(container)
  act(() => root.render(<MemoryRouter><AttentionList students={[student]} limit={5} viewAll="/admin/support?cohort_id=4" /></MemoryRouter>))
  expect([...container.querySelectorAll('li')].map((item) => item.textContent)).toEqual(['1 latest attempt awaiting review', 'Consider a check-in'])
  const destination = [...container.querySelectorAll('a')].find((item) => item.textContent?.includes('Review work'))!.getAttribute('href')!
  expect(destination).toContain('/admin/submissions/42?')
  expect(Object.fromEntries(new URLSearchParams(destination.split('?')[1]))).toEqual({ enrollment_id: '9', cohort_id: '4', student_id: '18', return_to: '/' })
  expect(container.textContent).toContain('View all 1')
  expect(container.textContent).toContain('Assigned learning: 1/50')
  act(() => root.unmount())
})
