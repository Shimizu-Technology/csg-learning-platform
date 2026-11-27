// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CohortFile } from '../../lib/cohortFiles'
import { CommandPalette } from './CommandPalette'
import { DriveInspectorDrawer } from './DriveInspectorDrawer'
import { Modal } from './Modal'

const createCohortFileCommentMock = vi.fn()

vi.mock('../../lib/api', () => ({
  api: {
    updateCohortFile: vi.fn(),
    getCohortFileComments: vi.fn(async () => ({ data: { comments: [], can_comment: true }, error: null })),
    createCohortFileComment: (...args: unknown[]) => createCohortFileCommentMock(...args),
    searchEverything: vi.fn(async () => ({ data: { groups: [], partial: false }, error: null })),
  },
}))

vi.mock('../../contexts/AuthContext', () => ({
  useAuthContext: () => ({
    user: { id: 1, is_staff: false, is_admin: false },
    schoolFeatures: {},
    enrollments: [],
  }),
}))

vi.mock('../../contexts/CohortContext', () => ({
  useCohortContext: () => ({
    selectedCohort: null,
    cohorts: [],
  }),
}))

vi.mock('../../contexts/ConfirmContext', () => ({
  useConfirm: () => vi.fn(async () => true),
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

function createResponsiveMatcher(initialMatches: boolean) {
  let matches = initialMatches
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  window.matchMedia = vi.fn().mockImplementation(() => ({
    get matches() {
      return matches
    },
    addEventListener: (_event: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener)
    },
    removeEventListener: (_event: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener)
    },
  }))
  return {
    setMatches(next: boolean) {
      matches = next
      listeners.forEach((listener) => listener({ matches: next } as MediaQueryListEvent))
    },
  }
}

function mockDesktopMatch(matches: boolean) {
  createResponsiveMatcher(matches)
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

  it('restores body scroll cleanly when resizing to desktop with a preview modal open', () => {
    document.body.style.overflow = ''
    const matcher = createResponsiveMatcher(false)

    function Harness() {
      const [previewOpen, setPreviewOpen] = useState(false)
      return (
        <>
          <DriveInspectorDrawer
            cohortId={7}
            file={sampleFile}
            folderOptions={['Slides']}
            onClose={vi.fn()}
            onOpenPreview={() => setPreviewOpen(true)}
          />
          <Modal open={previewOpen} onClose={() => setPreviewOpen(false)} title="Preview">
            <p>Preview content</p>
          </Modal>
        </>
      )
    }

    act(() => root.render(<Harness />))
    expect(document.body.style.overflow).toBe('hidden')

    // Open preview from inside the mobile drawer
    const previewButton = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('Preview'))!
    act(() => previewButton.click())
    expect(document.body.style.overflow).toBe('hidden')

    // Resize to desktop while preview is open: drawer unmounts, preview keeps scroll locked
    act(() => matcher.setMatches(true))
    expect(document.body.style.overflow).toBe('hidden')

    // Close preview: scroll lock must restore original overflow instead of staying 'hidden'
    const closePreview = document.querySelector<HTMLButtonElement>('[aria-label="Close Preview"]')!
    act(() => closePreview.click())
    expect(document.body.style.overflow).toBe('')
  })

  it('yields focus and Escape to CommandPalette when opened over the mobile drawer', async () => {
    vi.useFakeTimers()
    mockDesktopMatch(false)
    const onDrawerClose = vi.fn()

    function Harness() {
      const [paletteOpen, setPaletteOpen] = useState(false)
      return (
        <MemoryRouter>
          <button type="button" id="open-palette" onClick={() => setPaletteOpen(true)}>
            Open palette
          </button>
          <DriveInspectorDrawer
            cohortId={7}
            file={sampleFile}
            folderOptions={['Slides']}
            onClose={onDrawerClose}
            onOpenPreview={vi.fn()}
          />
          <CommandPalette open={paletteOpen} isStaff={false} onClose={() => setPaletteOpen(false)} />
        </MemoryRouter>
      )
    }

    act(() => root.render(<Harness />))
    act(() => vi.runOnlyPendingTimers())

    act(() => {
      document.getElementById('open-palette')!.click()
    })
    act(() => vi.runOnlyPendingTimers())

    const paletteInput = document.querySelector<HTMLInputElement>('input[aria-label="Search and go"]')!
    expect(paletteInput).not.toBeNull()
    expect(document.activeElement).toBe(paletteInput)

    // Escape closes the Command Palette only, not the drawer behind it.
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
    expect(document.querySelector('input[aria-label="Search and go"]')).toBeNull()
    expect(onDrawerClose).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('preserves unsent review comments and moves focus when crossing the desktop breakpoint', async () => {
    const matcher = createResponsiveMatcher(false)
    const studentFile: CohortFile = {
      ...sampleFile,
      folder: 'Student work',
      student_id: 99,
      uploaded_by_role: 'student',
    }
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0)
      return 1
    })

    await act(async () => {
      root.render(
        <DriveInspectorDrawer
          cohortId={7}
          file={studentFile}
          folderOptions={['Student work']}
          review={{ staff: true, canChange: true }}
          onClose={vi.fn()}
          onOpenPreview={vi.fn()}
          onFileChange={vi.fn()}
        />,
      )
    })

    const mobileTextarea = document.querySelector<HTMLTextAreaElement>('textarea')!
    expect(mobileTextarea).not.toBeNull()
    act(() => {
      mobileTextarea.focus()
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(mobileTextarea, 'Great start on the layout!')
      mobileTextarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(mobileTextarea.value).toBe('Great start on the layout!')

    // Resize to desktop: panel switches from Modal drawer to inline aside without losing draft or focus
    await act(async () => {
      matcher.setMatches(true)
    })

    const desktopTextarea = container.querySelector<HTMLTextAreaElement>('aside textarea')!
    expect(desktopTextarea).not.toBeNull()
    expect(desktopTextarea.value).toBe('Great start on the layout!')
    expect(document.activeElement).toBe(desktopTextarea)
    rafSpy.mockRestore()
  })

  it('keeps comment submission pending across breakpoint resize without duplicating requests', async () => {
    createCohortFileCommentMock.mockReset()
    let resolvePost!: (value: unknown) => void
    createCohortFileCommentMock.mockImplementation(
      () => new Promise((resolve) => { resolvePost = resolve }),
    )

    const matcher = createResponsiveMatcher(false)
    const onFileChange = vi.fn()
    const studentFile: CohortFile = {
      ...sampleFile,
      folder: 'Student work',
      student_id: 99,
      uploaded_by_role: 'student',
    }

    await act(async () => {
      root.render(
        <DriveInspectorDrawer
          cohortId={7}
          file={studentFile}
          folderOptions={['Student work']}
          review={{ staff: true, canChange: true }}
          onClose={vi.fn()}
          onOpenPreview={vi.fn()}
          onFileChange={onFileChange}
        />,
      )
    })

    const mobileTextarea = document.querySelector<HTMLTextAreaElement>('textarea')!
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(mobileTextarea, 'Looks clean!')
      mobileTextarea.dispatchEvent(new Event('input', { bubbles: true }))
    })

    // Start submitting in the mobile drawer
    const mobileSubmit = document.querySelector<HTMLButtonElement>('button[type="submit"]')!
    act(() => { mobileSubmit.click() })
    expect(createCohortFileCommentMock).toHaveBeenCalledTimes(1)
    expect(mobileSubmit.disabled).toBe(true)

    // Resize across breakpoint while submission is still pending
    await act(async () => {
      matcher.setMatches(true)
    })

    const desktopTextarea = container.querySelector<HTMLTextAreaElement>('aside textarea')!
    const desktopSubmit = container.querySelector<HTMLButtonElement>('aside button[type="submit"]')!
    expect(desktopTextarea.disabled).toBe(true)
    expect(desktopSubmit.disabled).toBe(true)
    expect(desktopSubmit.textContent).toContain('Posting')

    // Attempting to submit again on desktop must NOT fire a duplicate request
    act(() => { desktopSubmit.click() })
    expect(createCohortFileCommentMock).toHaveBeenCalledTimes(1)

    // Resolve the deferred comment post
    await act(async () => {
      resolvePost({
        data: {
          comment: {
            id: 501,
            body: 'Looks clean!',
            author_name: 'Ina Instructor',
            author_role: 'staff',
            created_at: '2026-11-28T00:00:00Z',
            can_delete: true,
          },
        },
        error: null,
      })
    })

    expect(container.querySelector('aside')?.textContent).toContain('Looks clean!')
    expect(container.querySelector<HTMLTextAreaElement>('aside textarea')!.value).toBe('')
    expect(container.querySelector<HTMLTextAreaElement>('aside textarea')!.disabled).toBe(false)
    expect(onFileChange).toHaveBeenCalledWith(expect.objectContaining({ comment_count: 1 }))
  })
})
