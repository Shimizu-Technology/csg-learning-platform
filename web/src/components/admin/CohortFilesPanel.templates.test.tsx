// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCohortFiles: vi.fn(), updateCohortFile: vi.fn(), copyCohortFileToStudents: vi.fn(), deleteCohortFile: vi.fn(),
  importCohortCurriculumFiles: vi.fn(), copyCohortFilesFromCohort: vi.fn(), getAccessibleCohorts: vi.fn(), exportCohortFilesZip: vi.fn(),
  confirm: vi.fn(), success: vi.fn(), error: vi.fn(),
}))
vi.mock('../../lib/api', () => ({ api: mocks }))
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => mocks.confirm }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: { id: 1, is_staff: true, is_admin: true }, enrollments: [] }) }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ success: mocks.success, error: mocks.error }) }))
import { CohortFilesPanel } from './CohortFilesPanel'
import { importSummary } from './CohortFileImportControls'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const file = (overrides: Record<string, unknown>) => ({
  id: 1, cohort_id: 4, student_id: null, source_file_id: null, source_curriculum_file_id: null, source_cohort_file_id: null, auto_copy_to_students: false,
  folder: 'Career & Job Search', visibility: 'students', title: 'Job Search Plan', description: null, filename: null, content_type: null, file_size: null,
  ready: true, ready_at: '2026-11-24T00:00:00Z', created_at: '2026-11-24T00:00:00Z', uploaded_by_name: 'Ina Instructor', uploaded_by_role: 'staff',
  can_manage: true, kind: 'doc', external_url: null, link_provider: null, version_number: 1, previewable: false, preview_mode: null,
  review_status: 'none', reviewed_by_name: null, reviewed_at: null, comment_count: 0, doc_version: 1, doc_updated_at: '2026-11-24T00:00:00.000000Z',
  doc_updated_by_name: null, can_edit_doc: true, ...overrides,
})
const plan = file({ auto_copy_to_students: true, source_curriculum_file_id: 9 })
const schedule = file({ id: 2, kind: 'link', folder: 'General', title: 'Cohort Schedule', external_url: 'https://docs.google.com/spreadsheets/d/x/edit', link_provider: 'google_sheet', doc_version: null })
const response = () => ({
  data: {
    class_files: [plan, schedule],
    student_folders: [
      { student_id: 3, enrollment_id: 30, student_name: 'Student One', student_email: 'one@example.invalid', enrollment_status: 'active', file_count: 1, needs_review_count: 0,
        files: [file({ id: 10, student_id: 3, source_file_id: 1, title: 'Job Search Plan' })] },
      { student_id: 5, enrollment_id: 50, student_name: 'Empty Student', student_email: 'empty@example.invalid', enrollment_status: 'active', file_count: 0, needs_review_count: 0, files: [] },
    ],
    folders: ['Career & Job Search', 'General'], storage_configured: false, can_upload_personal: false,
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
afterEach(() => { act(() => root.unmount()); container.remove(); document.body.innerHTML = '' })

async function mount() {
  await act(async () => root.render(<MemoryRouter initialEntries={['/admin/cohorts/4?tab=files']}><CohortFilesPanel cohortId={4} /></MemoryRouter>))
  await flush()
}
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
const button = (text: string, scope: ParentNode = container) => [...scope.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.includes(text))!
const row = (title: string) => [...container.querySelectorAll('[aria-label="Class files"] > li')].find((item) => item.textContent?.includes(title))!
async function menuItem(title: string, label: string) {
  await act(async () => row(title).querySelector<HTMLButtonElement>(`[aria-label="More actions for ${title}"]`)!.click())
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent === label)
}

it('summarizes imports in plain words', () => {
  expect(importSummary('Imported', 1, 0, 0)).toBe('Imported 1 item.')
  expect(importSummary('Copied', 2, 1, 3)).toBe('Copied 2 items, 1 already here, copied to 3 student folders.')
  expect(importSummary('Imported', 0, 3, 0, 1)).toBe("Imported 0 items, 3 already here. 1 upload couldn't be copied because file storage isn't available. Try again later.")
})

it('shows the auto-copy badge and turns auto-copy on after confirming, reporting the copies', async () => {
  mocks.updateCohortFile.mockResolvedValue({ data: { file: { ...schedule, auto_copy_to_students: true }, auto_copied_count: 2 }, error: null })
  await mount()
  const reloaded = response()
  reloaded.data.class_files[1] = { ...schedule, auto_copy_to_students: true }
  mocks.getCohortFiles.mockResolvedValueOnce(reloaded)
  expect(row('Job Search Plan').textContent).toContain('Auto-copy')
  expect(row('Cohort Schedule').textContent).not.toContain('Auto-copy')
  await act(async () => (await menuItem('Cohort Schedule', 'Auto-copy to new students'))!.click())
  expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Auto-copy Cohort Schedule to every student?', confirmLabel: 'Turn on auto-copy' }))
  expect(mocks.updateCohortFile).toHaveBeenCalledWith(4, 2, { auto_copy_to_students: true })
  expect(mocks.success).toHaveBeenCalledWith('Auto-copy is on and 2 students got a copy')
  await flush()
  expect(mocks.getCohortFiles).toHaveBeenCalledTimes(2)
  expect(row('Cohort Schedule').textContent).toContain('Auto-copy')
})

it('turns auto-copy off without asking', async () => {
  mocks.updateCohortFile.mockResolvedValue({ data: { file: { ...plan, auto_copy_to_students: false } }, error: null })
  await mount()
  await act(async () => (await menuItem('Job Search Plan', 'Turn off auto-copy'))!.click())
  expect(mocks.confirm).not.toHaveBeenCalled()
  expect(mocks.updateCohortFile).toHaveBeenCalledWith(4, 1, { auto_copy_to_students: false })
  expect(row('Job Search Plan').textContent).not.toContain('Auto-copy')
})

it('moving an auto-copy item to staff only turns auto-copy off with it', async () => {
  await mount()
  mocks.updateCohortFile.mockResolvedValue({ data: { file: { ...plan, visibility: 'staff_only', auto_copy_to_students: false } }, error: null })
  await act(async () => button('Move to staff only', row('Job Search Plan')).click())
  expect(mocks.updateCohortFile).toHaveBeenLastCalledWith(4, 1, { visibility: 'staff_only', auto_copy_to_students: false })
  expect(mocks.success).toHaveBeenLastCalledWith('Job Search Plan is staff only and no longer auto-copies')
})

it('does not offer auto-copy on staff-only items', async () => {
  const data = response()
  data.data.class_files.push(file({ id: 7, title: 'Facilitation Guide', visibility: 'staff_only' }))
  mocks.getCohortFiles.mockResolvedValue(data)
  await mount()
  expect(await menuItem('Facilitation Guide', 'Auto-copy to new students')).toBeUndefined()
})

it('imports from the curriculum with a summary and reloads the list', async () => {
  mocks.importCohortCurriculumFiles.mockResolvedValue({ data: { imported_count: 1, skipped_count: 3, failed_count: 0, auto_copied_count: 2, files: [] }, error: null })
  await mount()
  await act(async () => button('Import from curriculum').click())
  await flush()
  expect(mocks.importCohortCurriculumFiles).toHaveBeenCalledWith(4)
  expect(mocks.success).toHaveBeenCalledWith('Imported 1 item, 3 already here, copied to 2 student folders.')
  expect(mocks.getCohortFiles).toHaveBeenCalledTimes(2)

  mocks.importCohortCurriculumFiles.mockResolvedValue({ data: { imported_count: 0, skipped_count: 4, failed_count: 0, auto_copied_count: 0, files: [] }, error: null })
  await act(async () => button('Import from curriculum').click())
  await flush()
  expect(mocks.success).toHaveBeenLastCalledWith('Everything from the curriculum is already here.')
})

it('reports uploads storage could not copy as an error to retry, never as already here', async () => {
  mocks.importCohortCurriculumFiles.mockResolvedValue({ data: { imported_count: 0, skipped_count: 3, failed_count: 2, auto_copied_count: 0, files: [] }, error: null })
  await mount()
  await act(async () => button('Import from curriculum').click())
  await flush()
  expect(mocks.success).not.toHaveBeenCalled()
  expect(mocks.error).toHaveBeenCalledWith("Imported 0 items, 3 already here. 2 uploads couldn't be copied because file storage isn't available. Try again later.")

  mocks.getAccessibleCohorts.mockResolvedValue({ data: { cohorts: [{ id: 8, name: 'Fall 2026', curriculum_name: 'Prework', status: 'active', cohort_type: 'cohort' }] }, error: null })
  mocks.copyCohortFilesFromCohort.mockResolvedValue({ data: { copied_count: 1, skipped_count: 0, failed_count: 1, auto_copied_count: 0, files: [] }, error: null })
  await act(async () => button('Copy from another cohort').click())
  await flush()
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
  await act(async () => dialog.querySelector<HTMLInputElement>('input[type="radio"]')!.click())
  await act(async () => button('Copy class files', dialog).click())
  await flush()
  expect(mocks.error).toHaveBeenLastCalledWith("Copied 1 item. 1 upload couldn't be copied because file storage isn't available. Try again later.")
})

it('copies from another accessible cohort chosen in a dialog', async () => {
  mocks.getAccessibleCohorts.mockResolvedValue({ data: { cohorts: [
    { id: 4, name: 'This cohort', curriculum_name: 'Prework', status: 'active', cohort_type: 'cohort' },
    { id: 8, name: 'Fall 2026', curriculum_name: 'Prework', status: 'active', cohort_type: 'cohort' },
  ] }, error: null })
  mocks.copyCohortFilesFromCohort.mockResolvedValue({ data: { copied_count: 2, skipped_count: 0, failed_count: 0, auto_copied_count: 0, files: [] }, error: null })
  await mount()
  await act(async () => button('Copy from another cohort').click())
  await flush()
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
  expect(dialog.textContent).toContain('Student folders never are.')
  expect(dialog.textContent).not.toContain('This cohort')
  const copy = button('Copy class files', dialog)
  expect(copy.disabled).toBe(true)
  await act(async () => dialog.querySelector<HTMLInputElement>('input[type="radio"]')!.click())
  await act(async () => button('Copy class files', dialog).click())
  await flush()
  expect(mocks.copyCohortFilesFromCohort).toHaveBeenCalledWith(4, 8)
  expect(mocks.success).toHaveBeenCalledWith('Copied 2 items.')
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})

it('downloads class files and a student folder as ZIPs, disabled while preparing and for an empty folder', async () => {
  const created: string[] = []
  URL.createObjectURL = vi.fn(() => { created.push('blob:zip'); return 'blob:zip' })
  URL.revokeObjectURL = vi.fn()
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
  let resolve: (value: unknown) => void = () => undefined
  mocks.exportCohortFilesZip.mockReturnValue(new Promise((done) => { resolve = done }))
  await mount()
  const classZip = container.querySelector<HTMLButtonElement>('button[aria-label="Download all class files as a ZIP"]')!
  await act(async () => classZip.click())
  expect(classZip.disabled).toBe(true)
  expect(classZip.textContent).toContain('Preparing ZIP')
  await act(async () => resolve({ data: { blob: new Blob(['zip']), filename: 'cohort-class-files.zip' }, error: null }))
  await flush()
  expect(mocks.exportCohortFilesZip).toHaveBeenCalledWith(4, { scope: 'class', studentId: undefined, folder: undefined })
  expect(click).toHaveBeenCalled()
  expect(classZip.disabled).toBe(false)

  await act(async () => button('Student folders').click())
  await act(async () => button('Empty Student').click())
  expect(container.querySelector<HTMLButtonElement>('button[aria-label="Download Empty Student\'s folder as a ZIP"]')!.disabled).toBe(true)
  mocks.exportCohortFilesZip.mockResolvedValue({ data: null, error: 'There\'s nothing to download here yet.' })
  await act(async () => button('Student One').click())
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Download Student One\'s folder as a ZIP"]')!.click())
  await flush()
  expect(mocks.exportCohortFilesZip).toHaveBeenLastCalledWith(4, { scope: 'student', studentId: 3, folder: undefined })
  expect(mocks.error).toHaveBeenCalledWith('There\'s nothing to download here yet.')
  click.mockRestore()
})
