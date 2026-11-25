// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, RouterProvider, createMemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCohortFiles: vi.fn(), updateCohortFile: vi.fn(), copyCohortFileToStudents: vi.fn(), deleteCohortFile: vi.fn(),
  downloadCohortFile: vi.fn(), createCohortFile: vi.fn(), completeCohortFile: vi.fn(), confirm: vi.fn(), success: vi.fn(), error: vi.fn(),
  createCohortLink: vi.fn(), renameCohortFolder: vi.fn(), getCohortFilePreview: vi.fn(), getCohortFileVersions: vi.fn(),
  createCohortDoc: vi.fn(), getCohortDoc: vi.fn(), getCohortDocRevisions: vi.fn(), getCohortFileComments: vi.fn(), setCohortFileReview: vi.fn(),
}))
vi.mock('../../lib/api', () => ({ api: mocks }))
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => mocks.confirm }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: { id: 1, is_staff: true, is_admin: true }, enrollments: [] }) }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ success: mocks.success, error: mocks.error }) }))
import { CohortFilesPanel, StudentFilesTab } from './CohortFilesPanel'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const file = (overrides: Record<string, unknown>) => ({
  id: 1, cohort_id: 4, student_id: null, source_file_id: null, folder: 'Slides', visibility: 'students', title: 'Week 1 Ruby Slides',
  description: null, filename: 'week-1-ruby-slides.pdf', content_type: 'application/pdf', file_size: 2_400_000, ready: true,
  ready_at: '2026-11-24T00:00:00Z', created_at: '2026-11-24T00:00:00Z', uploaded_by_name: 'Ina Instructor', uploaded_by_role: 'staff',
  can_manage: true, kind: 'file', external_url: null, link_provider: null, version_number: 1, previewable: true, preview_mode: 'pdf', ...overrides,
})
const staged = file({ id: 2, title: 'Instructor Week 1 Notes', filename: 'week-1-instructor-notes.pdf', visibility: 'staff_only' })
const template = file({ id: 3, folder: 'Career & Job Search', title: 'Job Search Plan Template', filename: 'job-search-plan-template.docx' })
const response = () => ({
  data: {
    class_files: [file({}), staged, template],
    student_folders: [
      { student_id: 3, enrollment_id: 30, student_name: 'Student One', student_email: 'one@example.invalid', enrollment_status: 'active', file_count: 2, files: [
        file({ id: 10, student_id: 3, folder: 'Job Search & Career', title: 'Job Search Plan', filename: 'student-one-job-search-plan.docx' }),
        file({ id: 11, student_id: 3, folder: 'Resumes & Portfolio', title: 'Resume Draft v1', filename: 'resume-draft-v1.pdf', uploaded_by_role: 'student' }),
      ] },
      { student_id: 5, enrollment_id: 50, student_name: 'Paused Student', student_email: 'paused@example.invalid', enrollment_status: 'paused', file_count: 0, files: [] },
    ],
    folders: ['Career & Job Search', 'Slides'], storage_configured: true, can_upload_personal: false,
  },
  error: null,
})

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.clearAllMocks()
  mocks.getCohortFiles.mockResolvedValue(response())
  mocks.confirm.mockResolvedValue(true)
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })

async function mount(node = <CohortFilesPanel cohortId={4} />, path = '/admin/cohorts/4?tab=files') {
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>))
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}
const button = (text: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.includes(text))!

it('lists class files with folder filters, a staff-only badge, and counts on the view switch', async () => {
  await mount()
  expect(button('Class files').textContent).toContain('3')
  expect(button('Student folders').textContent).toContain('2')
  const list = container.querySelector('ul[aria-label="Class files"]')!
  expect(list.querySelectorAll('li')).toHaveLength(3)
  expect(list.textContent).toContain('Staff only')
  expect(list.textContent).toContain('2.3 MB')
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Filter by folder"] button:nth-child(2)')!.click())
  expect(container.querySelector('ul[aria-label="Class files"]')!.textContent).toContain('Job Search Plan Template')
  expect(container.querySelectorAll('ul[aria-label="Class files"] li')).toHaveLength(1)
})

it('shares a staged file with students in one click', async () => {
  mocks.updateCohortFile.mockResolvedValue({ data: { file: { ...staged, visibility: 'students' } }, error: null })
  await mount()
  await act(async () => button('Share with students').click())
  expect(mocks.updateCohortFile).toHaveBeenCalledWith(4, 2, { visibility: 'students' })
  expect(mocks.success).toHaveBeenCalledWith('Shared Instructor Week 1 Notes with students')
  expect(container.querySelector('ul[aria-label="Class files"]')!.textContent).not.toContain('Staff only')
})

it('copies a class file to every student after confirming and reports the count', async () => {
  mocks.copyCohortFileToStudents.mockResolvedValue({ data: { copied_count: 1, skipped_count: 0, files: [] }, error: null })
  await mount()
  const menu = container.querySelector<HTMLButtonElement>('button[aria-label="More actions for Job Search Plan Template"]')!
  await act(async () => menu.click())
  await act(async () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent === 'Copy to all students')!.click())
  expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Copy Job Search Plan Template to every student?' }))
  expect(mocks.copyCohortFileToStudents).toHaveBeenCalledWith(4, 3)
  expect(mocks.success).toHaveBeenCalledWith('Copied to 1 student')
  expect(mocks.getCohortFiles).toHaveBeenCalledTimes(2)
})

it('opens a student folder with who uploaded each file, and goes back to the list', async () => {
  await mount()
  await act(async () => button('Student folders').click())
  const folders = container.querySelector('ul[aria-label="Student folders"]')!
  expect(folders.textContent).toContain('Paused')
  expect(folders.textContent).toContain('0 files')
  await act(async () => button('Student One').click())
  const files = container.querySelector('ul[aria-label="Files in Student One\'s folder"]')!
  expect(files.textContent).toContain('Added by student')
  expect(files.textContent).toContain('Shared by staff')
  expect(container.querySelector('button[aria-label="Upload to Student\'s folder"]')).toBeTruthy()
  expect(container.querySelector('button[aria-label="Add a link to Student\'s folder"]')).toBeTruthy()
  await act(async () => button('All student folders').click())
  expect(container.querySelector('ul[aria-label="Files in Student One\'s folder"]')).toBeNull()
})

it('deletes a file from a student folder after confirming', async () => {
  mocks.deleteCohortFile.mockResolvedValue({ data: null, error: null })
  await mount(<StudentFilesTab cohortId={4} studentId={3} />)
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Delete Resume Draft v1"]')!.click())
  expect(mocks.deleteCohortFile).toHaveBeenCalledWith(4, 11)
  expect(container.textContent).not.toContain('Resume Draft v1')
  expect(container.textContent).toContain('Job Search Plan')
})

it('explains when storage is not set up and disables uploads', async () => {
  mocks.getCohortFiles.mockResolvedValue({ data: { ...response().data, storage_configured: false }, error: null })
  await mount()
  expect(container.textContent).toContain("File storage isn't set up")
  expect(button('Upload file').disabled).toBe(true)
  expect(container.querySelector<HTMLButtonElement>('button[aria-label="Download Week 1 Ruby Slides"]')!.disabled).toBe(true)
})

it('lists links with their provider and opens them in a new tab', async () => {
  const link = file({ id: 20, kind: 'link', title: 'Capstone brief', filename: null, content_type: null, file_size: null, previewable: false, preview_mode: null,
    external_url: 'https://docs.google.com/document/d/abc/edit', link_provider: 'google_doc' })
  mocks.getCohortFiles.mockResolvedValue({ data: { ...response().data, class_files: [file({}), link] }, error: null })
  await mount()
  const row = [...container.querySelectorAll('ul[aria-label="Class files"] li')].find((item) => item.textContent?.includes('Capstone brief'))!
  expect(row.textContent).toContain('Google Doc')
  expect(row.textContent).toContain('docs.google.com')
  const open = row.querySelector<HTMLAnchorElement>('a[aria-label^="Open link Capstone brief"]')!
  expect(open.href).toBe('https://docs.google.com/document/d/abc/edit')
  expect(open.target).toBe('_blank')
  expect(open.rel).toContain('noopener')
  expect(row.querySelector('button[aria-label="Download Capstone brief"]')).toBeNull()
  expect(row.querySelector('button[aria-label^="Upload new version"]')).toBeNull()
})

it('adds a class link even when file storage is not set up', async () => {
  const saved = file({ id: 21, kind: 'link', title: 'Figma board', filename: null, external_url: 'https://www.figma.com/design/x', link_provider: 'figma', previewable: false, preview_mode: null })
  mocks.getCohortFiles.mockResolvedValue({ data: { ...response().data, storage_configured: false }, error: null })
  mocks.createCohortLink.mockResolvedValue({ data: { file: saved }, error: null })
  await mount()
  await act(async () => button('Add link').click())
  const input = container.querySelector<HTMLInputElement>('input[type="url"]')!
  await act(async () => { setValue(input, 'http://example.com') })
  await act(async () => { input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
  expect(container.textContent).toContain('Links must start with https://')
  await act(async () => { setValue(input, 'https://www.figma.com/design/x') })
  expect(container.textContent).toContain('Figma')
  await act(async () => button('Save link').click())
  expect(mocks.createCohortLink).toHaveBeenCalledWith(4, expect.objectContaining({ external_url: 'https://www.figma.com/design/x', folder: 'Slides', visibility: 'students' }))
  expect(container.querySelector('ul[aria-label="Class files"]')!.textContent).toContain('Figma board')
})

it('renames the selected class folder', async () => {
  mocks.renameCohortFolder.mockResolvedValue({ data: { updated_count: 2, folder: 'Week 1 Slides' }, error: null })
  await mount()
  expect(container.querySelector('button[aria-label^="Rename folder"]')).toBeNull()
  await act(async () => [...container.querySelectorAll<HTMLButtonElement>('[aria-label="Filter by folder"] button')].find((item) => item.textContent === 'Slides')!.click())
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Rename folder Slides"]')!.click())
  const input = container.querySelector<HTMLInputElement>('form input')!
  await act(async () => { setValue(input, 'Week 1 Slides') })
  await act(async () => button('Save').click())
  expect(mocks.renameCohortFolder).toHaveBeenCalledWith(4, { from_folder: 'Slides', to_folder: 'Week 1 Slides' })
  const chips = [...container.querySelectorAll('[aria-label="Filter by folder"] button')].map((item) => item.textContent)
  expect(chips).toEqual(['All', 'Career & Job Search', 'Week 1 Slides'])
  expect(container.querySelector('[aria-label="Filter by folder"] button[aria-pressed="true"]')!.textContent).toBe('Week 1 Slides')
})

it('shows the version badge, version history and a preview for previewable files', async () => {
  mocks.getCohortFiles.mockResolvedValue({ data: { ...response().data, class_files: [file({ version_number: 2, preview_mode: 'markdown', filename: 'notes.md', title: 'Notes' })] }, error: null })
  mocks.getCohortFileVersions.mockResolvedValue({ data: { versions: [
    { id: 8, cohort_file_id: 1, version_number: 2, filename: 'notes.md', content_type: 'text/markdown', file_size: 20, note: 'Typo fix', ready_at: null, uploaded_by_name: null, current: true, preview_mode: 'markdown', previewable: true },
    { id: 7, cohort_file_id: 1, version_number: 1, filename: 'notes.md', content_type: 'text/markdown', file_size: 18, note: null, ready_at: null, uploaded_by_name: null, current: false, preview_mode: 'markdown', previewable: true },
  ] }, error: null })
  mocks.getCohortFilePreview.mockImplementation(async (_cohort: number, _file: number, versionId?: number | null) => ({ data: {
    preview_mode: 'markdown', filename: 'notes.md', content_type: 'text/markdown', file_size: 20, version_number: versionId ? 1 : 2, version_id: versionId ?? null,
    url: null, expires_in: null, text: versionId ? '# Old notes' : '# Week 1\n\n<script>alert(1)</script>\n\n| a | b |\n|---|---|\n| 1 | 2 |', truncated: false,
  }, error: null }))
  await mount()
  const row = container.querySelector('ul[aria-label="Class files"] li')!
  expect(row.textContent).toContain('v2')
  expect(row.querySelector('button[aria-label="Versions of Notes"]')).toBeTruthy()
  expect(row.querySelector('button[aria-label="Upload new version of Notes"]')).toBeTruthy()
  await act(async () => row.querySelector<HTMLButtonElement>('button[aria-label="Preview Notes"]')!.click())
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  const dialog = document.querySelector('[role="dialog"]')!
  expect(dialog.querySelector('h1')!.textContent).toBe('Week 1')
  expect(dialog.querySelector('script')).toBeNull()
  expect(dialog.querySelector('table')).toBeTruthy()
  const select = dialog.querySelector<HTMLSelectElement>('select')!
  expect([...select.options].map((option) => option.textContent)).toEqual(['v2 (current) · Typo fix', 'v1'])
  await act(async () => { select.value = '7'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  expect(mocks.getCohortFilePreview).toHaveBeenLastCalledWith(4, 1, 7)
  expect(document.querySelector('[role="dialog"] h1')!.textContent).toBe('Old notes')
})

function setValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

it('switching student folders drops a half-filled link or upload for the previous student', async () => {
  await mount()
  await act(async () => button('Student folders').click())
  await act(async () => button('Student One').click())
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Add a link to Student\'s folder"]')!.click())
  await act(async () => { setValue(container.querySelector<HTMLInputElement>('input[type="url"]')!, 'https://docs.google.com/document/d/one') })
  await act(async () => button('Paused Student').click())
  expect(container.querySelector('section[aria-label="Paused Student\'s folder"]')).toBeTruthy()
  expect(container.querySelector('input[type="url"]')).toBeNull()
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Upload to Paused\'s folder"]')!.click())
  expect(container.textContent).toContain("Upload to Paused's folder")
  await act(async () => button('Student One').click())
  expect(container.querySelector('input[type="url"]')).toBeNull()
  expect(container.querySelector('input[type="file"]')).toBeNull()
})

it('clears the previous version while another loads, and offers Retry when history fails', async () => {
  mocks.getCohortFiles.mockResolvedValue({ data: { ...response().data, class_files: [file({ version_number: 2, preview_mode: 'text', filename: 'notes.txt', title: 'Notes' })] }, error: null })
  mocks.getCohortFileVersions.mockResolvedValueOnce({ data: null, error: 'Server error' }).mockResolvedValue({ data: { versions: [
    { id: 8, cohort_file_id: 1, version_number: 2, filename: 'notes.txt', content_type: 'text/plain', file_size: 20, note: null, ready_at: null, uploaded_by_name: null, current: true, preview_mode: 'text', previewable: true },
    { id: 7, cohort_file_id: 1, version_number: 1, filename: 'notes.txt', content_type: 'text/plain', file_size: 18, note: null, ready_at: null, uploaded_by_name: null, current: false, preview_mode: 'text', previewable: true },
  ] }, error: null })
  let resolveOld: (value: unknown) => void = () => {}
  mocks.getCohortFilePreview.mockImplementation((_cohort: number, _file: number, versionId?: number | null) => versionId
    ? new Promise((resolve) => { resolveOld = resolve })
    : Promise.resolve({ data: { preview_mode: 'text', filename: 'notes.txt', content_type: 'text/plain', file_size: 20, version_number: 2, version_id: null, url: null, expires_in: null, text: 'Current notes', truncated: false }, error: null }))
  await mount()
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Preview Notes"]')!.click())
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  const dialog = () => document.querySelector('[role="dialog"]')!
  expect(dialog().textContent).toContain('Current notes')
  expect(dialog().textContent).toContain('Server error')
  await act(async () => [...dialog().querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.includes('Retry'))!.click())
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  const select = dialog().querySelector<HTMLSelectElement>('select')!
  await act(async () => { select.value = '7'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  expect(dialog().textContent).not.toContain('Current notes')
  expect(dialog().textContent).toContain('Opening Notes')
  expect([...dialog().querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.includes('Download'))!.disabled).toBe(true)
  await act(async () => { resolveOld({ data: { preview_mode: 'text', filename: 'notes.txt', content_type: 'text/plain', file_size: 18, version_number: 1, version_id: 7, url: null, expires_in: null, text: 'First notes', truncated: false }, error: null }) })
  expect(dialog().textContent).toContain('First notes')
  expect([...dialog().querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.includes('Download'))!.disabled).toBe(false)
})

const reviewFields = { review_status: 'none', reviewed_by_name: null, reviewed_at: null, comment_count: 0, doc_updated_at: null, doc_updated_by_name: null, can_edit_doc: false }
const docItem = (overrides: Record<string, unknown>) => file({
  ...reviewFields, kind: 'doc', filename: null, content_type: null, file_size: null, previewable: false, preview_mode: null,
  doc_updated_at: '2026-11-24T00:00:00.000001Z', doc_updated_by_name: 'Ina Instructor', can_edit_doc: true, ...overrides,
})
const reviewResponse = () => ({
  data: {
    class_files: [docItem({ id: 40, title: 'Job Search Plan Template', folder: 'Career & Job Search' })],
    student_folders: [
      { student_id: 3, enrollment_id: 30, student_name: 'Student One', student_email: 'one@example.invalid', enrollment_status: 'active', file_count: 2, needs_review_count: 1, files: [
        docItem({ id: 41, student_id: 3, title: 'My Job Search Plan', review_status: 'needs_review', comment_count: 2 }),
        file({ ...reviewFields, id: 42, student_id: 3, title: 'Resume Draft', filename: 'resume.pdf', uploaded_by_role: 'student', review_status: 'reviewed' }),
      ] },
      { student_id: 5, enrollment_id: 50, student_name: 'Quiet Student', student_email: 'quiet@example.invalid', enrollment_status: 'active', file_count: 0, needs_review_count: 0, files: [] },
    ],
    folders: ['Career & Job Search'], storage_configured: false, can_upload_personal: false,
  },
  error: null,
})

it('filters student folders to the ones waiting for review and marks them', async () => {
  mocks.getCohortFiles.mockResolvedValue(reviewResponse())
  await mount()
  await act(async () => button('Student folders').click())
  const list = () => container.querySelector('[aria-label="Student folders"]')!
  expect(list().textContent).toContain('Quiet Student')
  expect(list().textContent).toContain('Needs review')
  const chip = button('Needs review (1)')
  expect(chip.getAttribute('aria-pressed')).toBe('false')
  await act(async () => chip.click())
  expect(list().textContent).toContain('Student One')
  expect(list().textContent).not.toContain('Quiet Student')
  await act(async () => button('Student One').click())
  const folder = container.querySelector('[aria-label="Files in Student One\'s folder"]')!
  expect(folder.textContent).toContain('Learn Doc')
  expect(folder.textContent).toContain('Needs review')
  expect(folder.textContent).toContain('Reviewed')
  expect(container.querySelector('[aria-label="2 comments on My Job Search Plan"]')).toBeTruthy()
})

it('opens the linked student item from a review notification', async () => {
  mocks.getCohortFiles.mockResolvedValue(reviewResponse())
  mocks.getCohortDoc.mockResolvedValue({ data: { file: reviewResponse().data.student_folders[0].files[0], doc_content: '# Plan', doc_updated_at: '2026-11-24T00:00:00.000001Z', doc_updated_by_name: 'Student One', can_edit_doc: true, revision_count: 0 }, error: null })
  mocks.getCohortDocRevisions.mockResolvedValue({ data: { revisions: [] }, error: null })
  mocks.getCohortFileComments.mockResolvedValue({ data: { comments: [], can_comment: true }, error: null })
  await mount(<CohortFilesPanel cohortId={4} />, '/admin/cohorts/4?tab=files&student=3&file=41')
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  expect(mocks.getCohortDoc).toHaveBeenCalledWith(4, 41)
  const dialog = document.querySelector('[role="dialog"]')!
  expect(dialog.textContent).toContain('My Job Search Plan')
  expect(dialog.querySelector('[aria-label="Review and comments"]')!.textContent).toContain('Mark reviewed')
})

it('creates a class doc without file storage and opens it in the editor', async () => {
  mocks.getCohortFiles.mockResolvedValue(reviewResponse())
  const created = docItem({ id: 43, title: 'Capstone checklist', doc_updated_at: '2026-11-24T01:00:00.000001Z' })
  mocks.createCohortDoc.mockResolvedValue({ data: { file: created }, error: null })
  mocks.getCohortDoc.mockResolvedValue({ data: { file: created, doc_content: '', doc_updated_at: '2026-11-24T01:00:00.000001Z', doc_updated_by_name: 'Ina Instructor', can_edit_doc: true, revision_count: 0 }, error: null })
  mocks.getCohortDocRevisions.mockResolvedValue({ data: { revisions: [] }, error: null })
  await mount()
  expect(button('Upload files').disabled).toBe(true)
  await act(async () => button('New doc').click())
  const title = container.querySelector<HTMLInputElement>('input[placeholder="Job search plan"]')!
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => { setter.call(title, 'Capstone checklist'); title.dispatchEvent(new Event('input', { bubbles: true })) })
  await act(async () => button('Create doc').click())
  expect(mocks.createCohortDoc).toHaveBeenCalledWith(4, expect.objectContaining({ title: 'Capstone checklist', doc_content: '', visibility: 'students' }))
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  expect(container.querySelector('[aria-label="Class files"]')!.textContent).toContain('Capstone checklist')
  expect(mocks.getCohortDoc).toHaveBeenCalledWith(4, 43)
})

it('a second notification link for the same student opens that file too', async () => {
  const data = reviewResponse()
  const second = file({ ...reviewFields, id: 44, student_id: 3, title: 'Interview prep', filename: 'prep.pdf', preview_mode: 'pdf' })
  data.data.student_folders[0].files.push(second)
  mocks.getCohortFiles.mockResolvedValue(data)
  mocks.getCohortDoc.mockResolvedValue({ data: { file: data.data.student_folders[0].files[0], doc_content: '# Plan', doc_version: 1, doc_updated_at: '2026-11-24T00:00:00.000001Z', doc_updated_by_name: 'Student One', can_edit_doc: true, revision_count: 0 }, error: null })
  mocks.getCohortDocRevisions.mockResolvedValue({ data: { revisions: [] }, error: null })
  mocks.getCohortFileComments.mockResolvedValue({ data: { comments: [], can_comment: true }, error: null })
  const router = createMemoryRouter([{ path: '*', element: <CohortFilesPanel cohortId={4} /> }], { initialEntries: ['/admin/cohorts/4?tab=files&student=3&file=41'] })
  await act(async () => root.render(<RouterProvider router={router} />))
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  expect(mocks.getCohortDoc).toHaveBeenCalledWith(4, 41)
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((item) => item.getAttribute('aria-label') === 'Close My Job Search Plan')!.click())
  await act(async () => { await router.navigate('/admin/cohorts/4?tab=files&student=3&file=44') })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  // Without storage the PDF has no preview, so it opens on its review and comments.
  expect(mocks.getCohortFileComments).toHaveBeenLastCalledWith(4, 44)
  expect(document.querySelector('[role="dialog"]')!.textContent).toContain('Interview prep')
})

it('offers Copy to all students only for items shared with students, and renames a doc from its version', async () => {
  const data = reviewResponse()
  data.data.class_files.push(docItem({ id: 45, title: 'Staged guide', visibility: 'staff_only', doc_version: 3 }))
  mocks.getCohortFiles.mockResolvedValue(data)
  mocks.updateCohortFile.mockResolvedValue({ data: null, error: 'conflict', status: 409 })
  await mount()
  const row = (title: string) => [...container.querySelectorAll('[aria-label="Class files"] > li')].find((item) => item.textContent?.includes(title))!
  const menuItems = async (title: string) => {
    await act(async () => row(title).querySelector<HTMLButtonElement>(`[aria-label="More actions for ${title}"]`)!.click())
    const items = [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)
    await act(async () => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    return items
  }
  expect(await menuItems('Job Search Plan Template')).toContain('Copy to all students')
  const staged = await menuItems('Staged guide')
  expect(staged).not.toContain('Copy to all students')

  await act(async () => row('Staged guide').querySelector<HTMLButtonElement>('[aria-label="More actions for Staged guide"]')!.click())
  await act(async () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent === 'Edit')!.click())
  const titleInput = [...container.querySelectorAll<HTMLInputElement>('input')].find((input) => input.value === 'Staged guide')!
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => { setter.call(titleInput, 'Shared guide'); titleInput.dispatchEvent(new Event('input', { bubbles: true })) })
  await act(async () => button('Save').click())
  expect(mocks.updateCohortFile).toHaveBeenCalledWith(4, 45, expect.objectContaining({ title: 'Shared guide', base_doc_version: 3 }))
  expect(container.textContent).toContain('This doc changed since you opened it')
})
