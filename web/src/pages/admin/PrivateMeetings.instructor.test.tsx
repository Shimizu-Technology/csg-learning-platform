// @vitest-environment jsdom

import { act } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ meetings: vi.fn(), cohorts: vi.fn(), users: vi.fn(), conversation: vi.fn() }))

vi.mock('../../lib/api', () => ({
  api: { getStaffPrivateMeetings: state.meetings, getCohorts: state.cohorts, getUsers: state.users, createDirectConversation: state.conversation },
}))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: { id: 7, is_admin: false, is_staff: true, full_name: 'Tess Instructor' } }) }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => vi.fn() }))

import { StaffPrivateMeetings } from './PrivateMeetings'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let container: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.clearAllMocks()
  state.meetings.mockResolvedValue({ data: {
    cohorts: [],
    other_cohorts: [
      { id: 2, name: 'Cohort 3', host: { id: 9, full_name: 'Kai Reyes' } },
      { id: 4, name: 'Cohort 4', host: null },
    ],
    admin_contacts: [{ id: 1, full_name: 'Audit Admin' }],
  }, error: null })
  state.conversation.mockResolvedValue({ data: { direct_conversation: { id: 55 } } })
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })

async function render(cohortId?: number) {
  await act(async () => root.render(<MemoryRouter initialEntries={['/admin/meetings']}><Routes>
    <Route path="/admin/meetings" element={<StaffPrivateMeetings cohortId={cohortId} />} />
    <Route path="/messages/dm/:id" element={<p>Conversation open</p>} />
  </Routes></MemoryRouter>))
}
const button = (text: string) => [...container.querySelectorAll('button')].find((element) => element.textContent === text)

it('shows an instructor who hosts nothing who does host and who to ask, not a dead end', async () => {
  await render()
  expect(container.textContent).not.toContain('An admin can assign you')
  expect(container.textContent).toContain('You don’t host any meetings yet')
  expect(container.textContent).toContain('Hosted by Kai Reyes')
  expect(container.textContent).toContain('No host yet')
  expect(button('Message Kai Reyes')).toBeTruthy()
  expect(button('Message Audit Admin')).toBeTruthy()
  // Choosing hosts is admin-only, so the instructor page doesn't load the admin's cohort and staff lists.
  expect(state.cohorts).not.toHaveBeenCalled()
  expect(state.users).not.toHaveBeenCalled()

  await act(async () => button('Message Audit Admin')!.click())
  expect(state.conversation).toHaveBeenCalledWith({ cohort_id: 4, user_ids: [1] })
  expect(container.textContent).toContain('Conversation open')
})

it('on a cohort’s Schedule tab names that cohort’s host only', async () => {
  await render(2)
  expect(container.textContent).toContain('You don’t host meetings in this cohort')
  expect(container.textContent).toContain('Hosted by Kai Reyes')
  expect(container.textContent).not.toContain('Cohort 4')
})

it('says who to ask when none of the instructor’s cohorts has meetings', async () => {
  state.meetings.mockResolvedValue({ data: { cohorts: [], other_cohorts: [], admin_contacts: [{ id: 1, full_name: 'Audit Admin' }, { id: 2, full_name: 'Bea Admin' }] }, error: null })
  await render()
  expect(container.textContent).toContain('Ask Audit Admin or Bea Admin')
})
