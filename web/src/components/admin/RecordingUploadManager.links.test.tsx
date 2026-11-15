// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { RecordingUploadManager } from './RecordingUploadManager'
vi.mock('../../lib/api', () => ({ api: { getCohortRecordings: async () => ({ data: { recordings: [{ id: 7, title: 'QA replay', source: 'external', status: 'published', created_at: '2026-11-01', uploaded_by: null }] } }) } }))
vi.mock('../../contexts/UploadContext', () => ({ MAX_CONCURRENT_VIDEO_UPLOADS: 2, useUpload: () => ({ uploads: [], startVideoUpload: vi.fn(), cancelUpload: vi.fn() }) }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => vi.fn() }))
it('links progress to this recording without inventing an unknown uploader', async () => {
 const container = document.createElement('div'); const root = createRoot(container)
 try {
  await act(async () => root.render(<RecordingUploadManager cohortId={4} />))
  expect(container.querySelector('a[href="/admin/cohorts/4/watch-progress?recording_id=7"]')?.textContent).toBe('Watch progress')
  expect(container.textContent).not.toContain('by Unknown')
 } finally { act(() => root.unmount()) }
})
