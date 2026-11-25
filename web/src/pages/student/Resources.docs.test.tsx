// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  getResources: vi.fn(), getCohortFiles: vi.fn(), getCohortDoc: vi.fn(), getCohortDocRevisions: vi.fn(), getCohortFileComments: vi.fn(), createCohortDoc: vi.fn(),
}))
vi.mock('../../contexts/CohortContext', () => ({ useCohortContext: () => ({ selectedCohortId: 1 }) }))
vi.mock('../../lib/api', () => ({ api: state }))
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => vi.fn() }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))
vi.mock('../../components/shared/LazyMarkdownEditor', () => ({ LazyMarkdownEditor: () => null }))
import { Resources } from './Resources'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const doc = {
  id: 31, cohort_id: 1, student_id: 3, source_file_id: 40, folder: 'Career', visibility: 'students', title: 'My Job Search Plan', description: null,
  filename: null, content_type: null, file_size: null, ready: true, ready_at: null, created_at: '2026-11-24T00:00:00Z', uploaded_by_name: 'Ina Instructor',
  uploaded_by_role: 'staff', can_manage: false, kind: 'doc', external_url: null, link_provider: null, version_number: 1, previewable: false, preview_mode: null,
  review_status: 'reviewed', reviewed_by_name: 'Ina Instructor', reviewed_at: '2026-11-24T02:00:00Z', comment_count: 1,
  doc_updated_at: '2026-11-24T01:00:00.000001Z', doc_updated_by_name: 'Student One', can_edit_doc: true,
}
let container: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.clearAllMocks()
  state.getResources.mockResolvedValue({ data: { resources: [] }, error: null })
  state.getCohortFiles.mockResolvedValue({ data: { class_files: [], my_files: [doc], folders: ['Career'], storage_configured: false, can_upload_personal: true }, error: null })
  state.getCohortDoc.mockResolvedValue({ data: { file: doc, doc_content: '- [ ] Apply to 3 roles', doc_updated_at: doc.doc_updated_at, doc_updated_by_name: 'Student One', can_edit_doc: true, revision_count: 2 }, error: null })
  state.getCohortDocRevisions.mockResolvedValue({ data: { revisions: [] }, error: null })
  state.getCohortFileComments.mockResolvedValue({ data: { comments: [], can_comment: true }, error: null })
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove(); document.body.innerHTML = '' })

it('offers New doc without file storage and shows the review state of my docs', async () => {
  await act(async () => root.render(<MemoryRouter initialEntries={['/resources?cohort_id=1']}><Resources /></MemoryRouter>))
  const mine = container.querySelector('[aria-label="Files in my folder"]')!
  expect(mine.textContent).toContain('Learn Doc')
  expect(mine.textContent).toContain('Reviewed')
  expect(mine.querySelector('[aria-label="1 comment on My Job Search Plan"]')).toBeTruthy()
  expect([...container.querySelectorAll('button')].some((button) => button.textContent?.includes('New doc'))).toBe(true)
  expect(state.getCohortDoc).not.toHaveBeenCalled()
})

it('opens the doc named in a notification link, with Ask for another review beside it', async () => {
  await act(async () => root.render(<MemoryRouter initialEntries={['/resources?cohort_id=1&file=31']}><Resources /></MemoryRouter>))
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  expect(state.getCohortDoc).toHaveBeenCalledWith(1, 31)
  const dialog = document.querySelector('[role="dialog"]')!
  expect(dialog.textContent).toContain('My Job Search Plan')
  expect(dialog.querySelector('[aria-label="Review and comments"]')!.textContent).toContain('Ask for another review')
})
