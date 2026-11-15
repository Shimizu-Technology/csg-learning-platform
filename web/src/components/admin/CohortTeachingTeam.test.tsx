// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCohortInstructorAssignments: vi.fn(), getUsers: vi.fn(), setCohortInstructorLessonEditing: vi.fn(),
  createCohortInstructorAssignment: vi.fn(), deleteCohortInstructorAssignment: vi.fn(), confirm: vi.fn(), success: vi.fn(), error: vi.fn(),
}))
vi.mock('../../lib/api', () => ({ api: mocks }))
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => mocks.confirm }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ success: mocks.success, error: mocks.error }) }))
import { CohortTeachingTeam } from './CohortTeachingTeam'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
const audreana = { id: 7, full_name: 'Audreana Tester', email: 'audreana@example.invalid', can_edit_lessons: false, edit_granted_by: null, edit_granted_at: null }
const granted = { ...audreana, can_edit_lessons: true, edit_granted_by: { id: 1, full_name: 'Leon Tester' }, edit_granted_at: '2026-11-14T02:00:00Z' }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getCohortInstructorAssignments.mockResolvedValue({ data: { instructors: [audreana] } })
  mocks.getUsers.mockResolvedValue({ data: { users: [] } })
  mocks.confirm.mockResolvedValue(true)
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })

const switchFor = () => container.querySelector<HTMLButtonElement>('button[role="switch"]')!
async function mount() {
  await act(async () => root.render(<MemoryRouter><CohortTeachingTeam cohortId={3} /></MemoryRouter>))
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}

it('gives lesson editing access per instructor after confirming, and shows who gave it', async () => {
  mocks.setCohortInstructorLessonEditing.mockResolvedValue({ data: { instructor: granted } })
  await mount()
  expect(switchFor().getAttribute('aria-checked')).toBe('false')
  expect(switchFor().getAttribute('aria-label')).toBe('Lesson editing for Audreana Tester')
  expect(container.textContent).toContain('Lessons read only')

  await act(async () => switchFor().click())
  expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Let Audreana Tester edit lessons?' }))
  expect(mocks.setCohortInstructorLessonEditing).toHaveBeenCalledWith(3, 7, true)
  expect(switchFor().getAttribute('aria-checked')).toBe('true')
  expect(container.textContent).toContain('Leon gave this access on Nov 14')
})

it('removes access without a confirmation and leaves it unchanged when the admin cancels a grant', async () => {
  mocks.getCohortInstructorAssignments.mockResolvedValue({ data: { instructors: [granted] } })
  mocks.setCohortInstructorLessonEditing.mockResolvedValue({ data: { instructor: audreana } })
  await mount()
  await act(async () => switchFor().click())
  expect(mocks.confirm).not.toHaveBeenCalled()
  expect(mocks.setCohortInstructorLessonEditing).toHaveBeenCalledWith(3, 7, false)
  expect(switchFor().getAttribute('aria-checked')).toBe('false')

  mocks.confirm.mockResolvedValue(false)
  await act(async () => switchFor().click())
  expect(mocks.setCohortInstructorLessonEditing).toHaveBeenCalledTimes(1)
})
