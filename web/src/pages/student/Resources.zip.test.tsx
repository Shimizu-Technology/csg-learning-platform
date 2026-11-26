// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ getResources: vi.fn(), getCohortFiles: vi.fn(), exportCohortFilesZip: vi.fn(), error: vi.fn() }))
vi.mock('../../contexts/CohortContext', () => ({ useCohortContext: () => ({ selectedCohortId: 1 }) }))
vi.mock('../../lib/api', () => ({ api: state }))
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => vi.fn() }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ success: vi.fn(), error: state.error }) }))
vi.mock('../../components/shared/LazyMarkdownEditor', () => ({ LazyMarkdownEditor: () => null }))
import { Resources } from './Resources'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const link = {
  id: 32, cohort_id: 1, student_id: 3, source_file_id: null, source_curriculum_file_id: null, source_cohort_file_id: null, auto_copy_to_students: false,
  folder: 'Resumes & Portfolio', visibility: 'students', title: 'Portfolio Wireframe', description: null, filename: null, content_type: null, file_size: null,
  ready: true, ready_at: null, created_at: '2026-11-24T00:00:00Z', uploaded_by_name: 'Student One', uploaded_by_role: 'student', can_manage: true, kind: 'link',
  external_url: 'https://www.figma.com/design/demo-portfolio-wireframe', link_provider: 'figma', version_number: 1, previewable: false, preview_mode: null,
  review_status: 'none', reviewed_by_name: null, reviewed_at: null, comment_count: 0, doc_version: null, doc_updated_at: null, doc_updated_by_name: null, can_edit_doc: false,
}
let container: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.clearAllMocks()
  state.getResources.mockResolvedValue({ data: { resources: [] }, error: null })
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove(); document.body.innerHTML = '' })

async function mount(myFiles: unknown[]) {
  state.getCohortFiles.mockResolvedValue({ data: { class_files: [], my_files: myFiles, folders: [], storage_configured: false, can_upload_personal: true }, error: null })
  await act(async () => root.render(<MemoryRouter initialEntries={['/resources?cohort_id=1']}><Resources /></MemoryRouter>))
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}
const zipButton = () => container.querySelector<HTMLButtonElement>('button[aria-label="Download all my files as a ZIP"]')

it('offers Download all as ZIP only once My files has something in it', async () => {
  await mount([])
  expect(zipButton()).toBeNull()
})

it('downloads my folder as a ZIP and reports a failure', async () => {
  URL.createObjectURL = vi.fn(() => 'blob:my-files')
  URL.revokeObjectURL = vi.fn()
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
  state.exportCohortFilesZip.mockResolvedValueOnce({ data: { blob: new Blob(['zip']), filename: 'cohort-my-files.zip' }, error: null })
  await mount([link])
  expect(zipButton()!.textContent).toContain('Download all as ZIP')
  await act(async () => zipButton()!.click())
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  expect(state.exportCohortFilesZip).toHaveBeenCalledWith(1, { scope: 'my_files', studentId: undefined, folder: undefined })
  expect(click).toHaveBeenCalledTimes(1)

  state.exportCohortFilesZip.mockResolvedValueOnce({ data: null, error: 'Too many requests' })
  await act(async () => zipButton()!.click())
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  expect(state.error).toHaveBeenCalledWith('Too many requests')
  click.mockRestore()
})
