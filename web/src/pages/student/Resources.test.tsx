// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  selectedId: 1, getResources: vi.fn(), download: vi.fn(), getCohortFiles: vi.fn(), downloadCohortFile: vi.fn(),
  deleteCohortFile: vi.fn(), confirm: vi.fn(), success: vi.fn(), error: vi.fn(),
}))

vi.mock('../../contexts/CohortContext', () => ({
  useCohortContext: () => ({ selectedCohortId: state.selectedId }),
}))
vi.mock('../../lib/api', () => ({ api: {
  getResources: state.getResources, downloadCurriculumResource: state.download, getCohortFiles: state.getCohortFiles,
  downloadCohortFile: state.downloadCohortFile, deleteCohortFile: state.deleteCohortFile,
} }))
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => state.confirm }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ success: state.success, error: state.error }) }))

import { Resources } from './Resources'

describe('Resources course switching', () => {
  let container: HTMLDivElement
  let root: Root
  const pending = new Map<number, (value: unknown) => void>()

  beforeEach(() => {
    state.selectedId = 1
    state.getResources.mockReset()
    state.download.mockReset()
    state.getCohortFiles.mockReset()
    state.getCohortFiles.mockResolvedValue({ data: null, error: 'Not enrolled', status: 403 })
    state.getResources.mockImplementation((cohortId: number) => new Promise((resolve) => pending.set(cohortId, resolve)))
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    pending.clear()
    vi.restoreAllMocks()
  })

  it('keeps the newly selected course when its request finishes before the previous request', async () => {
    await act(async () => root.render(<MemoryRouter><Resources /></MemoryRouter>))
    state.selectedId = 2
    await act(async () => root.render(<MemoryRouter><Resources /></MemoryRouter>))

    await act(async () => pending.get(2)?.({ data: { resources: [{ id: 2, title: 'New course guide', url: 'https://example.test/new', category: 'general', description: null }] }, error: null }))
    await act(async () => pending.get(1)?.({ data: { resources: [{ id: 1, title: 'Old course guide', url: 'https://example.test/old', category: 'general', description: null }] }, error: null }))

    expect(container.textContent).toContain('New course guide')
    expect(container.textContent).not.toContain('Old course guide')
  })

  it('requests fresh course-specific download authorization on every click and shows denied access', async () => {
    await act(async () => root.render(<MemoryRouter><Resources /></MemoryRouter>))
    await act(async () => pending.get(1)?.({ data: { resources: [{ id: 'file-8', download_id: 8, curriculum_id: 3, filename: 'python.zip', title: 'Python resources', url: '', category: 'download', description: null }] }, error: null }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    state.download.mockResolvedValueOnce({ data: { url: 'https://storage.test/download', expires_in: 300 }, error: null })
    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click())
    expect(state.download).toHaveBeenCalledWith(3, 8)
    expect(click).toHaveBeenCalledOnce()
    state.download.mockResolvedValueOnce({ data: null, error: 'Course access has expired', status: 403 })
    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click())
    expect(state.download).toHaveBeenCalledTimes(2)
    expect(click).toHaveBeenCalledOnce()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Course access has expired')
  })
  it('separates cohort links and reusable course files without losing either resource', async () => {
    await act(async () => root.render(<MemoryRouter><Resources /></MemoryRouter>))
    await act(async () => pending.get(1)?.({ data: { resources: [
      { id: 'link-1', title: 'Class meeting', url: 'https://example.test/class', category: 'meeting', description: null },
      { id: 'file-8', download_id: 8, curriculum_id: 3, filename: 'python.zip', title: 'Python files', url: '', category: 'download', description: null },
    ] }, error: null }))
    const links = container.querySelector('section[aria-label="Cohort links"]')!
    const files = container.querySelector('section[aria-label="Course files"]')!
    expect(links.textContent).toContain('Class meeting')
    expect(links.textContent).not.toContain('Python files')
    expect(files.textContent).toContain('Python files')
    expect(files.textContent).toContain('shared across cohorts using this curriculum')
    expect(links.querySelector('a')?.href).toBe('https://example.test/class')
  })

  const classFile = (overrides: Record<string, unknown>) => ({
    id: 1, cohort_id: 1, student_id: null, source_file_id: null, folder: 'Slides', visibility: 'students', title: 'Week 1 Ruby Slides',
    description: null, filename: 'week-1-ruby-slides.pdf', content_type: 'application/pdf', file_size: 2048, ready: true,
    ready_at: '2026-11-24T00:00:00Z', created_at: '2026-11-24T00:00:00Z', uploaded_by_name: 'Ina Instructor', uploaded_by_role: 'staff',
    can_manage: false, kind: 'file', external_url: null, link_provider: null, version_number: 1, previewable: true, preview_mode: 'pdf', ...overrides,
  })

  it('shows a private folder with upload instead of the empty dead end, and class files grouped by folder', async () => {
    state.getCohortFiles.mockResolvedValue({ data: {
      class_files: [classFile({}), classFile({ id: 2, folder: 'Career & Job Search', title: 'Job Search Plan Template', filename: 'job-search-plan-template.docx' })],
      my_files: [], folders: ['Career & Job Search', 'Slides'], storage_configured: true, can_upload_personal: true,
    }, error: null })
    await act(async () => root.render(<MemoryRouter><Resources /></MemoryRouter>))
    await act(async () => pending.get(1)?.({ data: { resources: [] }, error: null }))
    expect(container.textContent).not.toContain('No resources yet')
    const mine = container.querySelector('section[aria-label="My files"]')!
    expect(mine.textContent).toContain('only you and your instructors can see files here')
    expect(mine.textContent).toContain('Choose file')
    const shared = container.querySelector('section[aria-label="Class files"]')!
    expect([...shared.querySelectorAll('h3')].map((heading) => heading.textContent)).toEqual(['Career & Job Search', 'Job Search Plan Template', 'Slides', 'Week 1 Ruby Slides'])
    expect(state.getCohortFiles).toHaveBeenCalledWith(1)
  })

  it('lets a learner delete only their own uploads and explains paused uploads', async () => {
    state.confirm.mockResolvedValue(true)
    state.deleteCohortFile.mockResolvedValue({ data: null, error: null })
    state.getCohortFiles.mockResolvedValue({ data: {
      class_files: [],
      my_files: [
        classFile({ id: 5, student_id: 3, folder: 'Resumes & Portfolio', title: 'Resume Draft v1', filename: 'resume-draft-v1.pdf', uploaded_by_role: 'student', can_manage: true }),
        classFile({ id: 6, student_id: 3, folder: 'Job Search & Career', title: 'Job Search Plan', filename: 'student-one-job-search-plan.docx' }),
      ],
      folders: [], storage_configured: true, can_upload_personal: false,
    }, error: null })
    await act(async () => root.render(<MemoryRouter><Resources /></MemoryRouter>))
    await act(async () => pending.get(1)?.({ data: { resources: [] }, error: null }))
    const mine = container.querySelector('section[aria-label="My files"]')!
    expect(mine.textContent).toContain('Uploads are paused')
    expect(mine.textContent).toContain('Added by you')
    expect(mine.textContent).toContain('Shared by your instructor')
    // Even a file still marked manageable gets no version upload while uploads are paused.
    expect(mine.querySelector('button[aria-label^="Upload new version"]')).toBeNull()
    const deletes = [...mine.querySelectorAll<HTMLButtonElement>('button[aria-label^="Delete"]')]
    expect(deletes.map((button) => button.getAttribute('aria-label'))).toEqual(['Delete Resume Draft v1'])
    await act(async () => deletes[0].click())
    expect(state.deleteCohortFile).toHaveBeenCalledWith(1, 5)
    expect(mine.textContent).not.toContain('Resume Draft v1')
  })

  it('searches across my files, class files and links', async () => {
    state.getCohortFiles.mockResolvedValue({ data: {
      class_files: [classFile({})], my_files: [classFile({ id: 9, student_id: 3, title: 'Resume Draft v1', filename: 'resume.pdf', folder: 'Resumes & Portfolio' })],
      folders: [], storage_configured: true, can_upload_personal: true,
    }, error: null })
    await act(async () => root.render(<MemoryRouter><Resources /></MemoryRouter>))
    await act(async () => pending.get(1)?.({ data: { resources: [
      { id: 'link-1', title: 'Class meeting', url: 'https://example.test/class', category: 'meeting', description: null },
      { id: 'link-2', title: 'Resume tips', url: 'https://example.test/tips', category: 'general', description: null },
      { id: 'link-3', title: 'Docs', url: 'https://example.test/docs', category: 'general', description: null },
    ] }, error: null }))
    const search = container.querySelector<HTMLInputElement>('input[aria-label="Search resources"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'resume')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(container.querySelector('section[aria-label="My files"]')!.textContent).toContain('Resume Draft v1')
    expect(container.querySelector('section[aria-label="Class files"]')!.textContent).toContain('No class files match this search.')
    expect(container.querySelector('section[aria-label="Cohort links"]')!.textContent).toContain('Resume tips')
    expect(container.querySelector('section[aria-label="Cohort links"]')!.textContent).not.toContain('Class meeting')
  })

  it('shows a retry banner when files fail to load, and stays quiet for 403', async () => {
    state.getCohortFiles.mockResolvedValueOnce({ data: null, error: 'Request timed out', status: 504 })
    await act(async () => root.render(<MemoryRouter><Resources /></MemoryRouter>))
    await act(async () => pending.get(1)?.({ data: { resources: [] }, error: null }))
    const banner = container.querySelector('[role="alert"]')!
    expect(banner.textContent).toContain('Your files and class files could not load. Request timed out')
    expect(container.textContent).not.toContain('No resources yet')
    state.getCohortFiles.mockResolvedValueOnce({ data: {
      class_files: [classFile({})], my_files: [], folders: [], storage_configured: false, can_upload_personal: true,
    }, error: null })
    await act(async () => [...banner.querySelectorAll('button')].find((button) => button.textContent?.includes('Retry'))!.click())
    expect(container.querySelector('[role="alert"]')).toBeNull()
    const download = container.querySelector<HTMLButtonElement>('button[aria-label="Download Week 1 Ruby Slides"]')!
    expect(download.disabled).toBe(true)
    expect(container.textContent).toContain('Downloads are unavailable until file storage is set up.')
  })

})
