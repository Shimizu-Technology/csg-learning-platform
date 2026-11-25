// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  selectedId: 1, getResources: vi.fn(), getCohortFiles: vi.fn(), success: vi.fn(),
  uploaders: [] as Array<{ cohortId: number; onUploaded: (file: Record<string, unknown>) => void }>,
}))
vi.mock('../../contexts/CohortContext', () => ({ useCohortContext: () => ({ selectedCohortId: state.selectedId }) }))
vi.mock('../../lib/api', () => ({ api: { getResources: state.getResources, getCohortFiles: state.getCohortFiles } }))
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => vi.fn() }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ success: state.success, error: vi.fn() }) }))
vi.mock('../../components/shared/CohortFileParts', async (original) => ({
  ...(await original<typeof import('../../components/shared/CohortFileParts')>()),
  CohortFileUploader: (props: { cohortId: number; onUploaded: (file: Record<string, unknown>) => void }) => { state.uploaders.push(props); return null },
}))
import { Resources } from './Resources'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const file = (overrides: Record<string, unknown>) => ({
  id: 1, cohort_id: 1, student_id: 3, source_file_id: null, folder: 'General', visibility: 'students', title: 'File', description: null,
  filename: 'file.pdf', content_type: 'application/pdf', file_size: 10, ready: true, ready_at: null, created_at: '2026-11-24T00:00:00Z',
  uploaded_by_name: 'Student', uploaded_by_role: 'student', can_manage: true, ...overrides,
})
let container: HTMLDivElement
let root: Root
beforeEach(() => {
  state.selectedId = 1
  state.uploaders = []
  vi.clearAllMocks()
  state.getResources.mockResolvedValue({ data: { resources: [] }, error: null })
  state.getCohortFiles.mockImplementation(async (cohortId: number) => ({ data: {
    class_files: [], my_files: [file({ id: cohortId * 10, cohort_id: cohortId, title: `Cohort ${cohortId} notes` })],
    folders: [], storage_configured: true, can_upload_personal: true,
  }, error: null }))
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })

it('drops an upload that finishes after switching cohorts instead of adding it to the new cohort', async () => {
  await act(async () => root.render(<MemoryRouter><Resources /></MemoryRouter>))
  const firstUploader = state.uploaders.at(-1)!
  expect(firstUploader.cohortId).toBe(1)
  state.selectedId = 2
  await act(async () => root.render(<MemoryRouter><Resources /></MemoryRouter>))
  expect(container.textContent).toContain('Cohort 2 notes')
  expect(state.uploaders.at(-1)!.cohortId).toBe(2)

  await act(async () => firstUploader.onUploaded(file({ id: 99, cohort_id: 1, title: 'Late resume' })))
  expect(state.success).toHaveBeenCalledWith('Uploaded Late resume')
  expect(container.textContent).not.toContain('Late resume')

  await act(async () => state.uploaders.at(-1)!.onUploaded(file({ id: 98, cohort_id: 2, title: 'Fresh resume' })))
  expect(container.textContent).toContain('Fresh resume')
})
