// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api } from '../../lib/api'
import { CohortModuleGrading } from './CohortModuleGrading'

vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: { is_admin: false, is_staff: true } }) }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }))
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => vi.fn().mockResolvedValue(true) }))

const student = (id: number, name: string) => ({ user_id: id, full_name: name, email: `${id}@example.com`, github_username: `user-${id}`, total_exercises: 1, submitted: 0, ungraded: 0, graded: 0, redo: 0 })
const matrix = (overrides = {}) => ({
  cohort_id: 4, cohort_name: 'Prework', module_id: 2, module_name: 'Prework', requires_github: true, repository_name: 'prework',
  github_sync_enabled: true, supports_github_sync: true, open_github_sync_count: 1, github_auto_sync: false,
  students: [student(20, 'Alex Rivera'), student(21, 'Blair Cruz')],
  exercises: [{ id: 8, title: 'Exercise 111', filename: '111.rb', release_day: 0, lesson_title: 'Day 1', requires_submission: true, submission_type: 'prework_github_sync', github_sync: true, submission_window: { submissions_closed: false } }],
  progresses: [], submissions: [],
  ...overrides,
})

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  vi.spyOn(api, 'getFeedbackSnippets').mockResolvedValue({ data: { feedback_snippets: [] }, error: null })
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks() })

async function render(data = matrix()) {
  vi.spyOn(api, 'getCohortModuleSubmissions').mockResolvedValue({ data, error: null } as never)
  const router = createMemoryRouter([{ path: '/admin/cohorts/:cohortId/modules/:moduleId/grading', element: <CohortModuleGrading /> }], { initialEntries: ['/admin/cohorts/4/modules/2/grading'] })
  await act(async () => root.render(<RouterProvider router={router} />))
  await act(async () => { await Promise.resolve() })
}
const button = (text: string) => [...container.querySelectorAll('button')].find((item) => item.textContent?.trim().startsWith(text))!

it('names each student a sync could not finish, and why', async () => {
  await render()
  vi.spyOn(api, 'syncCohortModuleGithub').mockResolvedValue({ data: { synced: 3, students_processed: 2, errors: ['User 21: Student has no GitHub username'], failed_students: [{ user_id: 21, full_name: 'Blair Cruz', errors: ['Verify a repository binding before syncing this module'] }] }, error: null } as never)
  await act(async () => button('Sync all from GitHub').click())
  await act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)))
  const status = [...container.querySelectorAll('[role="status"]')].find((node) => node.textContent?.startsWith('Synced'))!
  expect(status.textContent).toContain('Synced 3 new submissions. Could not sync 1 student:')
  expect(status.querySelector('li')?.textContent).toBe('Blair Cruz: Verify a repository binding before syncing this module')
  // Each named student opens their record in this cohort.
  expect(status.querySelector('li a')?.getAttribute('href')).toContain('/admin/cohorts/4/students/21')
  expect(status.className).toContain('bg-danger-soft')
})

it('still names students from an older server that only sends flat errors (staggered deploy)', async () => {
  await render()
  vi.spyOn(api, 'syncCohortModuleGithub').mockResolvedValue({ data: { synced: 0, students_processed: 2, errors: ['User 21: No repository name configured for this module', 'User 21: Skipped closed Week 2 GitHub-sync submissions'] }, error: null } as never)
  await act(async () => button('Sync all from GitHub').click())
  await act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)))
  const status = [...container.querySelectorAll('[role="status"]')].find((node) => node.textContent?.startsWith('Synced'))!
  expect(status.textContent).toContain('Could not sync 1 student:')
  expect([...status.querySelectorAll('li')].map((item) => item.textContent)).toEqual(['Blair Cruz: No repository name configured for this module; Skipped closed Week 2 GitHub-sync submissions'])
})

it('reports a clean sync calmly', async () => {
  await render()
  vi.spyOn(api, 'syncCohortModuleGithub').mockResolvedValue({ data: { synced: 1, errors: [], failed_students: [] }, error: null } as never)
  await act(async () => button('Sync all from GitHub').click())
  await act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)))
  const status = [...container.querySelectorAll('[role="status"]')].find((node) => node.textContent?.startsWith('Synced'))!
  expect(status.textContent).toBe('Synced 1 new submission')
  expect(status.className).not.toContain('bg-danger-soft')
})

it('says GitHub also syncs every hour only where it really does', async () => {
  await render()
  expect(container.textContent).not.toContain('sync automatically every hour')
  act(() => root.unmount())
  root = createRoot(container)
  await render(matrix({ github_auto_sync: true }))
  expect(container.textContent).toContain('Verified GitHub repositories also sync automatically every hour.')
})

it('uses the Grading workbench chip names: Waiting, Redo, All', async () => {
  await render()
  const chips = [...container.querySelectorAll('[role="group"][aria-label="Submission queue"] button')].map((item) => item.textContent?.replace(/\d+$/, '').trim())
  expect(chips).toEqual(['Waiting', 'Redo', 'All'])
})
