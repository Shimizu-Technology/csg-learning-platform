// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCohortFiles: vi.fn(), updateCohortFile: vi.fn(), copyCohortFileToStudents: vi.fn(), deleteCohortFile: vi.fn(),
  downloadCohortFile: vi.fn(), createCohortFile: vi.fn(), completeCohortFile: vi.fn(), confirm: vi.fn(), success: vi.fn(), error: vi.fn(),
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
  can_manage: true, ...overrides,
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

async function mount(node = <CohortFilesPanel cohortId={4} />) {
  await act(async () => root.render(<MemoryRouter>{node}</MemoryRouter>))
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
  expect(files.textContent).toContain('Uploaded by student')
  expect(files.textContent).toContain('Shared by staff')
  expect(button("Upload to Student's folder")).toBeTruthy()
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
