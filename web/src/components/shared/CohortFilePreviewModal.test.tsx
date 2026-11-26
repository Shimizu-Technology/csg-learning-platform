// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getCohortFileVersions: vi.fn(), getCohortFilePreview: vi.fn() }))
vi.mock('../../lib/api', () => ({ api: mocks }))
import { CohortFilePreviewModal } from './CohortFilePreviewModal'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.clearAllMocks()
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  mocks.getCohortFilePreview.mockResolvedValue({ data: { preview_mode: 'text', filename: 'notes.txt', content_type: 'text/plain', file_size: 5, version_number: 2, version_id: null, url: null, expires_in: null, text: 'Notes', truncated: false }, error: null })
})
afterEach(() => { act(() => root.unmount()); container.remove() })

const version = (id: number, number: number, current: boolean) => ({ id, cohort_file_id: 1, version_number: number, filename: 'notes.txt', content_type: 'text/plain', file_size: 5, note: null, ready_at: null, uploaded_by_name: null, current, preview_mode: 'text', previewable: true })
const file = (versionNumber: number) => ({
  id: 1, cohort_id: 4, student_id: null, source_file_id: null, kind: 'file', folder: 'Slides', visibility: 'students', title: 'Notes', description: null,
  filename: 'notes.txt', content_type: 'text/plain', file_size: 5, external_url: null, link_provider: null, version_number: versionNumber,
  previewable: true, preview_mode: 'text', ready: true, ready_at: null, created_at: '2026-11-24T00:00:00Z', uploaded_by_name: null, uploaded_by_role: 'staff', can_manage: true,
}) as Parameters<typeof CohortFilePreviewModal>[0]['file']

it('shows a failed history refresh with Retry even while an earlier list is on screen', async () => {
  mocks.getCohortFileVersions.mockResolvedValueOnce({ data: { versions: [version(8, 2, true), version(7, 1, false)] }, error: null })
    .mockResolvedValueOnce({ data: null, error: 'Server error' })
    .mockResolvedValueOnce({ data: { versions: [version(9, 3, true), version(8, 2, false), version(7, 1, false)] }, error: null })
  await act(async () => root.render(<CohortFilePreviewModal cohortId={4} file={file(2)} open onClose={vi.fn()} />))
  const dialog = () => document.querySelector('[role="dialog"]')!
  expect(dialog().querySelectorAll('option')).toHaveLength(2)
  // A new version lands while the modal is open and the refresh fails.
  await act(async () => root.render(<CohortFilePreviewModal cohortId={4} file={file(3)} open onClose={vi.fn()} />))
  expect(dialog().querySelectorAll('option')).toHaveLength(2)
  expect(dialog().querySelector('[role="alert"]')!.textContent).toContain('Server error')
  await act(async () => [...dialog().querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.includes('Retry'))!.click())
  expect(dialog().querySelectorAll('option')).toHaveLength(3)
  expect(dialog().querySelector('[role="alert"]')).toBeNull()
})
