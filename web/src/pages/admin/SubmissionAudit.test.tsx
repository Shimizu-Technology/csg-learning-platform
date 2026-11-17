// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SubmissionAudit } from './SubmissionAudit'
import * as routes from '../../lib/routes'

const mocks = vi.hoisted(() => ({ getSubmissionAudit: vi.fn(), reviewSubmissionAudit: vi.fn() }))
vi.mock('../../lib/api', () => ({ api: mocks }))
const block = { id: 1, title: 'Your work', body: 'Submit your work', lesson_id: 2, lesson_title: 'Lesson', module_id: 3, module_name: 'Module', curriculum_id: 4, curriculum_name: 'Curriculum', completed_learners: 1, suggested_type: 'text_submission', content_digest: 'digest', cohort_submissions: [], completion_impact: { completed_learners: 0, cohorts: [] } }
let container: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.resetAllMocks()
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  mocks.getSubmissionAudit.mockResolvedValue({ data: { blocks: [block] } })
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks() })
async function mount() { await act(async () => root.render(<MemoryRouter><SubmissionAudit /></MemoryRouter>)) }
async function click(text: string) {
  const button = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === text)!
  expect(button).toBeTruthy()
  await act(async () => button.click())
}
it('routes instructional blocks to an unsaved companion exercise rather than a submission type', async () => {
  mocks.getSubmissionAudit.mockResolvedValue({ data: { blocks: [{ ...block, suggested_type: null }] } })
  await mount()
  expect(container.textContent).not.toContain('Needs a submission')
  const link = Array.from(container.querySelectorAll('a')).find((item) => item.textContent === 'Add a companion exercise')!
  expect(link.getAttribute('href')).toContain('block=1')
  expect(link.getAttribute('href')).toContain('add_companion=1')
  expect(link.getAttribute('href')).not.toContain('suggest_submission')
})
it('shows which cohorts already have sync and which have no submission', async () => {
  mocks.getSubmissionAudit.mockResolvedValue({ data: { blocks: [{ ...block, cohort_submissions: [{ id: 8, name: 'Sync class', submission_type: 'prework_github_sync' }, { id: 9, name: 'Manual class', submission_type: 'manual_complete' }] }] } })
  await mount()
  expect(container.textContent).toContain('Sync class: GitHub sync')
  expect(container.textContent).toContain('Manual class: No submission')
})
it('preserves encoded audit parameters on registry-based links', async () => {
  vi.spyOn(routes, 'lessonEditorPath').mockImplementation((id) => `/registry/lessons/${id}/edit`)
  vi.spyOn(routes, 'cohortPath').mockImplementation((id) => `/registry/cohorts/${id}`)
  mocks.getSubmissionAudit.mockResolvedValue({ data: { blocks: [{ ...block, cohort_submissions: [{ id: 8, name: 'Sync class', submission_type: 'prework_github_sync' }] }] } })
  await mount()
  const link = Array.from(container.querySelectorAll('a')).find((item) => item.textContent === 'Needs a submission')!
  const url = new URL(link.href)
  expect(url.pathname).toBe('/registry/lessons/2/edit')
  expect(url.searchParams.get('block')).toBe('1')
  expect(url.searchParams.get('return_to')).toBe('/admin/content/submission-audit')
  expect(url.searchParams.get('suggest_submission')).toBe('text_submission')
  expect(Array.from(container.querySelectorAll('a')).find((item) => item.textContent === 'Sync class')!.getAttribute('href')).toBe('/registry/cohorts/8')
})
it('warns that a companion reopens lessons rather than promising unchanged completion', async () => {
  mocks.getSubmissionAudit.mockResolvedValue({ data: { blocks: [{ ...block, suggested_type: null, completion_impact: { completed_learners: 2, cohorts: [] } }] } })
  await mount()
  expect(container.textContent).toContain('2 learners finished this lesson. Adding an exercise reopens it for them until they submit.')
  expect(container.textContent).not.toContain('Learner progress stays saved')
})
it('drops a delayed reload captured before a successful practice review', async () => {
  await mount()
  mocks.reviewSubmissionAudit.mockResolvedValueOnce({ error: 'Try again' }).mockResolvedValue({ data: { reviewed_by_id: 1, reviewed_at: '2026-11-17' } })
  await click('Practice only — mark as reviewed')
  let finish!: (result: unknown) => void
  mocks.getSubmissionAudit.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  await click('Reload audit')
  await click('Practice only — mark as reviewed')
  expect(container.querySelectorAll('article')).toHaveLength(0)
  await act(async () => finish({ data: { blocks: [block] } }))
  expect(container.querySelectorAll('article')).toHaveLength(0)
  expect(container.textContent).toContain('No blocks need review')
  expect(container.textContent).toContain('unless its content or submission settings change')
})
