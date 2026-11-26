// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ setCohortFileReview: vi.fn(), getCohortFileComments: vi.fn(), createCohortFileComment: vi.fn(), deleteCohortFileComment: vi.fn(), confirm: vi.fn() }))
vi.mock('../../lib/api', () => ({ api: mocks }))
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => mocks.confirm }))
import { CohortFileReviewPanel } from './CohortFileReview'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type ReviewFile = Parameters<typeof CohortFileReviewPanel>[0]['file']
const file = (overrides: Partial<ReviewFile> = {}) => ({
  id: 11, cohort_id: 4, student_id: 3, source_file_id: null, kind: 'file', folder: 'Resumes', visibility: 'students', title: 'Resume Draft', description: null,
  filename: 'resume.pdf', content_type: 'application/pdf', file_size: 10, external_url: null, link_provider: null, version_number: 1, previewable: true, preview_mode: 'pdf',
  ready: true, ready_at: null, created_at: '2026-11-24T00:00:00Z', uploaded_by_name: 'Student One', uploaded_by_role: 'student', can_manage: true,
  review_status: 'none', reviewed_by_name: null, reviewed_at: null, comment_count: 1, doc_updated_at: null, doc_updated_by_name: null, can_edit_doc: false, ...overrides,
}) as ReviewFile
const comment = (id: number, body: string, role: 'student' | 'staff', canDelete: boolean) => ({
  id, cohort_file_id: 11, body, created_at: '2026-11-24T00:00:00Z', author_id: role === 'staff' ? 1 : 3, author_name: role === 'staff' ? 'Ina Instructor' : 'Student One', author_role: role, can_delete: canDelete,
})

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.clearAllMocks()
  mocks.confirm.mockResolvedValue(true)
  mocks.getCohortFileComments.mockResolvedValue({ data: { comments: [comment(1, 'Can you check my summary?', 'student', true)], can_comment: true }, error: null })
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })

const button = (text: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.trim() === text || item.getAttribute('aria-label') === text)!
async function mount(props: Partial<Parameters<typeof CohortFileReviewPanel>[0]>) {
  const onFileChange = vi.fn()
  await act(async () => root.render(<CohortFileReviewPanel cohortId={4} file={file()} access={{ staff: false, canChange: true }} onFileChange={onFileChange} {...props} />))
  return onFileChange
}

it('lets a student send their item for review and take it back, but never mark it reviewed', async () => {
  mocks.setCohortFileReview.mockResolvedValue({ data: { file: file({ review_status: 'needs_review' }) }, error: null })
  const onFileChange = await mount({})
  expect(container.textContent).toContain('Not sent for review')
  expect(button('Mark reviewed')).toBeUndefined()
  const ready = button('Ready for review')
  expect(ready.getAttribute('aria-pressed')).toBe('false')
  await act(async () => ready.click())
  expect(mocks.setCohortFileReview).toHaveBeenCalledWith(4, 11, 'needs_review')
  expect(onFileChange).toHaveBeenCalledWith(expect.objectContaining({ review_status: 'needs_review' }))
  await act(async () => root.render(<CohortFileReviewPanel cohortId={4} file={file({ review_status: 'needs_review' })} access={{ staff: false, canChange: true }} onFileChange={onFileChange} />))
  expect(button('Ready for review').getAttribute('aria-pressed')).toBe('true')
  await act(async () => button('Ready for review').click())
  expect(mocks.setCohortFileReview).toHaveBeenLastCalledWith(4, 11, 'none')
})

it('gives staff Mark reviewed and Needs review, and shows who reviewed it', async () => {
  mocks.setCohortFileReview.mockResolvedValue({ data: { file: file({ review_status: 'reviewed', reviewed_by_name: 'Ina Instructor', reviewed_at: '2026-11-24T02:00:00Z' }) }, error: null })
  await mount({ file: file({ review_status: 'needs_review' }), access: { staff: true, canChange: true } })
  expect(button('Needs review').disabled).toBe(true)
  await act(async () => button('Mark reviewed').click())
  expect(mocks.setCohortFileReview).toHaveBeenCalledWith(4, 11, 'reviewed')
  await act(async () => root.render(<CohortFileReviewPanel cohortId={4} file={file({ review_status: 'reviewed', reviewed_by_name: 'Ina Instructor', reviewed_at: '2026-11-24T02:00:00Z' })} access={{ staff: true, canChange: true }} onFileChange={vi.fn()} />))
  expect(container.textContent).toContain('Reviewed by Ina Instructor')
  expect(button('Mark reviewed').disabled).toBe(true)
})

it('posts and deletes comments and reports the new count', async () => {
  mocks.createCohortFileComment.mockResolvedValue({ data: { comment: comment(2, 'Tighten the second bullet.', 'staff', true) }, error: null })
  mocks.deleteCohortFileComment.mockResolvedValue({ data: null, error: null })
  const onFileChange = await mount({ access: { staff: true, canChange: true } })
  expect(container.querySelector('ol[aria-label="Comments"]')!.textContent).toContain('Can you check my summary?')
  const box = container.querySelector<HTMLTextAreaElement>('textarea')!
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  act(() => { setter.call(box, '  Tighten the second bullet.  '); box.dispatchEvent(new Event('input', { bubbles: true })) })
  await act(async () => button('Post comment').click())
  expect(mocks.createCohortFileComment).toHaveBeenCalledWith(4, 11, 'Tighten the second bullet.')
  expect(container.textContent).toContain('Ina Instructor · Instructor')
  expect(onFileChange).toHaveBeenLastCalledWith(expect.objectContaining({ comment_count: 2 }))
  await act(async () => button('Delete comment from Student One').click())
  expect(mocks.deleteCohortFileComment).toHaveBeenCalledWith(4, 11, 1)
  expect(container.textContent).not.toContain('Can you check my summary?')
})

it('is read only for a paused student: no review toggle and no comment box', async () => {
  mocks.getCohortFileComments.mockResolvedValue({ data: { comments: [comment(1, 'Before pause', 'staff', false)], can_comment: false }, error: null })
  await mount({ access: { staff: false, canChange: false } })
  expect(button('Ready for review')).toBeUndefined()
  expect(container.querySelector('textarea')).toBeNull()
  expect(container.textContent).toContain('Before pause')
  expect(container.textContent).toContain('read only while your course is paused')
})
