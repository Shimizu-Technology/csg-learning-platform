// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CohortFile } from '../../lib/cohortFiles'
import { DriveInspectorDrawer } from './DriveInspectorDrawer'

vi.mock('../../lib/api', () => ({
  api: {
    updateCohortFile: vi.fn(),
    getCohortFileComments: vi.fn(async () => ({ data: { comments: [], can_comment: false }, error: null })),
  },
}))

const sampleFile: CohortFile = {
  id: 42,
  cohort_id: 7,
  student_id: null,
  source_file_id: null,
  source_curriculum_file_id: null,
  source_cohort_file_id: null,
  folder: 'Slides',
  visibility: 'students',
  title: 'Week 2 Notes',
  description: 'Review before Friday.',
  filename: 'week-2-notes.pdf',
  content_type: 'application/pdf',
  file_size: 4096,
  ready: true,
  ready_at: '2026-11-24T00:00:00Z',
  created_at: '2026-11-24T00:00:00Z',
  uploaded_by_name: 'Ina Instructor',
  uploaded_by_role: 'staff',
  can_manage: true,
  kind: 'file',
  external_url: null,
  link_provider: null,
  version_number: 1,
  previewable: true,
  preview_mode: 'pdf',
  auto_copy_to_students: false,
  doc_version: 0,
  doc_updated_at: null,
  doc_updated_by_name: null,
  can_edit_doc: false,
  review_status: 'none',
  reviewed_by_name: null,
  reviewed_at: null,
  comment_count: 0,
}

function mockDesktopMatch(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation(() => ({
    matches,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
}

describe('DriveInspectorDrawer', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.querySelectorAll('[data-state="closing"]').forEach((node) => node.remove())
    vi.restoreAllMocks()
  })

  it('renders as an accessible modal drawer on <1024px and closes on Escape', () => {
    mockDesktopMatch(false)
    const onClose = vi.fn()
    act(() => {
      root.render(
        <DriveInspectorDrawer
          cohortId={7}
          file={sampleFile}
          folderOptions={['Slides', 'Handouts']}
          onClose={onClose}
          onOpenPreview={vi.fn()}
        />,
      )
    })
    const dialog = document.querySelector('[role="dialog"][aria-modal="true"]')
    expect(dialog).not.toBeNull()
    expect(dialog?.textContent).toContain('File details')
    expect(dialog?.textContent).toContain('Week 2 Notes')
    expect(container.querySelector('aside')).toBeNull()

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('renders as an inline sticky side-panel aside on >=1024px', () => {
    mockDesktopMatch(true)
    const onClose = vi.fn()
    act(() => {
      root.render(
        <DriveInspectorDrawer
          cohortId={7}
          file={sampleFile}
          folderOptions={['Slides', 'Handouts']}
          onClose={onClose}
          onOpenPreview={vi.fn()}
        />,
      )
    })
    const aside = container.querySelector('aside[aria-label="Details for Week 2 Notes"]')
    expect(aside).not.toBeNull()
    expect(aside?.className).toContain('lg:sticky')
    expect(document.querySelector('[role="dialog"][aria-modal="true"]')).toBeNull()

    act(() => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Close file details"]')!.click()
    })
    expect(onClose).toHaveBeenCalledOnce()
  })
})
