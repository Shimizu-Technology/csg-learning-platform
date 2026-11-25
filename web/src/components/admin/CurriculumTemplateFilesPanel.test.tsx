// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCurriculumFiles: vi.fn(), createCurriculumFileUpload: vi.fn(), completeCurriculumFile: vi.fn(), createCurriculumLink: vi.fn(), createCurriculumDoc: vi.fn(),
  updateCurriculumFile: vi.fn(), deleteCurriculumFile: vi.fn(), getCurriculumDoc: vi.fn(), downloadCurriculumFile: vi.fn(),
  uploadToS3: vi.fn(), confirm: vi.fn(), success: vi.fn(), error: vi.fn(),
}))
vi.mock('../../lib/api', () => ({ api: mocks }))
vi.mock('../../lib/uploadToS3', () => ({ uploadToS3: mocks.uploadToS3 }))
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => mocks.confirm }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ success: mocks.success, error: mocks.error }) }))
import { CurriculumTemplateFilesPanel, type CurriculumFile } from './CurriculumTemplateFilesPanel'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const template = (overrides: Partial<CurriculumFile>): CurriculumFile => ({
  id: 1, curriculum_id: 7, kind: 'doc', folder: 'Career & Job Search', visibility: 'students', title: 'Job Search Plan', description: null,
  auto_copy_to_students: true, filename: null, content_type: null, file_size: null, external_url: null, link_provider: null, previewable: false, preview_mode: null,
  ready: true, ready_at: '2026-11-24T00:00:00Z', created_at: '2026-11-24T00:00:00Z', uploaded_by_name: 'Ada Admin', doc_version: 2,
  doc_updated_at: '2026-11-24T00:00:00.000000Z', doc_updated_by_name: 'Ada Admin', can_manage: true, ...overrides,
})
const plan = template({})
const schedule = template({ id: 2, kind: 'link', folder: 'General', title: 'Cohort Schedule & Office Hours', auto_copy_to_students: false, doc_version: null,
  external_url: 'https://docs.google.com/spreadsheets/d/demo-cohort-schedule/edit', link_provider: 'google_sheet' })
const guide = template({ id: 3, folder: 'Instructor Notes', title: 'Instructor Week 1 Facilitation Guide', visibility: 'staff_only', auto_copy_to_students: false })
const list = (canManage = true, storage = false) => ({ data: { files: [plan, schedule, guide], folders: ['Career & Job Search', 'General', 'Instructor Notes'], storage_configured: storage, can_manage: canManage }, error: null })

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.clearAllMocks()
  mocks.getCurriculumFiles.mockResolvedValue(list())
  mocks.confirm.mockResolvedValue(true)
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove(); document.body.innerHTML = '' })

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
async function mount() {
  await act(async () => root.render(<MemoryRouter><CurriculumTemplateFilesPanel curriculumId={7} /></MemoryRouter>))
  await flush()
}
const button = (text: string, scope: ParentNode = container) => [...scope.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.includes(text))!
const row = (title: string) => [...container.querySelectorAll('[aria-label="Template files"] > li')].find((item) => item.textContent?.includes(title))!
const setValue = (input: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}
async function menuItem(title: string, label: string) {
  await act(async () => row(title).querySelector<HTMLButtonElement>(`[aria-label="More actions for ${title}"]`)!.click())
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent === label)
}

it('lists templates with folder chips and staff-only and auto-copy badges', async () => {
  await mount()
  expect(container.querySelectorAll('[aria-label="Template files"] > li')).toHaveLength(3)
  expect(row('Job Search Plan').textContent).toContain('Auto-copy')
  expect(row('Instructor Week 1 Facilitation Guide').textContent).toContain('Staff only')
  expect(button('Upload files').disabled).toBe(true)
  await act(async () => button('Instructor Notes', container.querySelector('[aria-label="Filter template files by folder"]')!).click())
  expect(container.querySelectorAll('[aria-label="Template files"] > li')).toHaveLength(1)
})

it('is read only for staff who cannot manage templates', async () => {
  mocks.getCurriculumFiles.mockResolvedValue(list(false))
  await mount()
  expect(button('Add link')).toBeUndefined()
  expect(container.querySelector('[aria-label^="More actions"]')).toBeNull()
  expect(container.querySelector<HTMLAnchorElement>('a[aria-label^="Open Cohort Schedule"]')!.href).toBe('https://docs.google.com/spreadsheets/d/demo-cohort-schedule/edit')
})

it('adds a link with auto-copy, and auto-copy is not offered for staff only', async () => {
  mocks.createCurriculumLink.mockResolvedValue({ data: { file: template({ id: 9, kind: 'link', title: 'Portfolio Wireframe', external_url: 'https://www.figma.com/design/demo', link_provider: 'figma' }) }, error: null })
  await mount()
  await act(async () => button('Add link').click())
  const form = container.querySelector<HTMLFormElement>('form[aria-label="Add a template link"]')!
  await act(async () => setValue(form.querySelector<HTMLInputElement>('input[type="url"]')!, 'https://www.figma.com/design/demo'))
  await act(async () => [...form.querySelectorAll<HTMLInputElement>('input[type="radio"]')][1].click())
  expect(form.textContent).not.toContain('Auto-copy to students')
  await act(async () => [...form.querySelectorAll<HTMLInputElement>('input[type="radio"]')][0].click())
  await act(async () => form.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click())
  await act(async () => button('Add link', form).click())
  await flush()
  expect(mocks.createCurriculumLink).toHaveBeenCalledWith(7, { external_url: 'https://www.figma.com/design/demo', folder: 'General', visibility: 'students', auto_copy_to_students: true })
  expect(row('Portfolio Wireframe')).toBeTruthy()
})

it('uploads several files one after another and abandons a failed one', async () => {
  mocks.getCurriculumFiles.mockResolvedValue(list(true, true))
  mocks.createCurriculumFileUpload
    .mockResolvedValueOnce({ data: { file: template({ id: 20, kind: 'file', ready: false }), upload_url: 'https://s3.test', fields: {} }, error: null })
    .mockResolvedValueOnce({ data: { file: template({ id: 21, kind: 'file', ready: false }), upload_url: 'https://s3.test', fields: {} }, error: null })
  mocks.uploadToS3.mockResolvedValue(undefined)
  mocks.completeCurriculumFile
    .mockResolvedValueOnce({ data: { file: template({ id: 20, kind: 'file', title: 'week 1 slides', filename: 'week-1-slides.pdf', file_size: 1024, auto_copy_to_students: false }) }, error: null })
    .mockResolvedValueOnce({ data: null, error: "This file's contents don't match its .pdf type." })
  mocks.deleteCurriculumFile.mockResolvedValue({ data: null, error: null })
  await mount()
  await act(async () => button('Upload files').click())
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
  const files = [new File(['%PDF'], 'week-1-slides.pdf', { type: 'application/pdf' }), new File(['%PDF'], 'bad.pdf', { type: 'application/pdf' })]
  Object.defineProperty(input, 'files', { value: files, configurable: true })
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
  await act(async () => button('Upload', container.querySelector('form')!).click())
  await flush()
  expect(mocks.createCurriculumFileUpload).toHaveBeenCalledTimes(2)
  expect(mocks.createCurriculumFileUpload.mock.calls[0][1]).toMatchObject({ filename: 'week-1-slides.pdf', title: 'week 1 slides', visibility: 'students' })
  expect(mocks.deleteCurriculumFile).toHaveBeenCalledWith(7, 21, { pendingOnly: true })
  expect(container.textContent).toContain("This file's contents don't match")
  expect(row('week 1 slides')).toBeTruthy()
})

it('toggles sharing and auto-copy; staff only also turns auto-copy off', async () => {
  mocks.updateCurriculumFile.mockResolvedValue({ data: { file: { ...plan, visibility: 'staff_only', auto_copy_to_students: false } }, error: null })
  await mount()
  await act(async () => (await menuItem('Job Search Plan', 'Staff only'))!.click())
  expect(mocks.updateCurriculumFile).toHaveBeenCalledWith(7, 1, { visibility: 'staff_only', auto_copy_to_students: false })
  expect(row('Job Search Plan').textContent).toContain('Staff only')
  expect(await menuItem('Job Search Plan', 'Auto-copy to students')).toBeUndefined()

  mocks.updateCurriculumFile.mockResolvedValue({ data: { file: { ...schedule, auto_copy_to_students: true } }, error: null })
  await act(async () => (await menuItem('Cohort Schedule & Office Hours', 'Auto-copy to students'))!.click())
  expect(mocks.updateCurriculumFile).toHaveBeenLastCalledWith(7, 2, { auto_copy_to_students: true })
  expect(row('Cohort Schedule & Office Hours').textContent).toContain('Auto-copy')
})

it('edits a doc from the version it loaded and offers the latest after a conflict', async () => {
  mocks.getCurriculumDoc
    .mockResolvedValueOnce({ data: { file: plan, doc_content: '- [ ] Apply', doc_version: 2, doc_updated_at: plan.doc_updated_at, doc_updated_by_name: 'Ada Admin', can_edit_doc: true }, error: null })
    .mockResolvedValueOnce({ data: { file: { ...plan, doc_version: 3 }, doc_content: '- [x] Apply', doc_version: 3, doc_updated_at: plan.doc_updated_at, doc_updated_by_name: 'Bo Admin', can_edit_doc: true }, error: null })
  mocks.updateCurriculumFile
    .mockResolvedValueOnce({ data: null, error: 'conflict', status: 409 })
    .mockResolvedValueOnce({ data: { file: { ...plan, doc_version: 4 } }, error: null })
  await mount()
  await act(async () => button('Open doc', row('Job Search Plan')).click())
  await flush()
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!
  expect(dialog().textContent).toContain('Apply')
  await act(async () => button('Edit doc', dialog()).click())
  await act(async () => setValue(dialog().querySelector('textarea')!, '- [ ] Apply\n- [ ] Network'))
  await act(async () => button('Save doc', dialog()).click())
  await flush()
  expect(mocks.updateCurriculumFile).toHaveBeenCalledWith(7, 1, { doc_content: '- [ ] Apply\n- [ ] Network', base_doc_version: 2 })
  expect(dialog().textContent).toContain('Someone else saved this doc')
  expect(button('Save doc', dialog()).disabled).toBe(true)
  await act(async () => button('Load latest version', dialog()).click())
  expect(dialog().querySelector('textarea')!.value).toBe('- [x] Apply')
  await act(async () => setValue(dialog().querySelector('textarea')!, '- [x] Apply\n- [ ] Network'))
  await act(async () => button('Save doc', dialog()).click())
  await flush()
  expect(mocks.updateCurriculumFile).toHaveBeenLastCalledWith(7, 1, { doc_content: '- [x] Apply\n- [ ] Network', base_doc_version: 3 })
  expect(button('Edit doc', dialog())).toBeTruthy()
})

it('never goes silent when the latest version cannot load after a conflict, and saves only from it', async () => {
  mocks.getCurriculumDoc
    .mockResolvedValueOnce({ data: { file: plan, doc_content: 'v2', doc_version: 2, doc_updated_at: plan.doc_updated_at, doc_updated_by_name: 'Ada Admin', can_edit_doc: true }, error: null })
    .mockResolvedValueOnce({ data: null, error: 'Request timed out.' })
    .mockResolvedValueOnce({ data: { file: { ...plan, doc_version: 3 }, doc_content: 'v3', doc_version: 3, doc_updated_at: plan.doc_updated_at, doc_updated_by_name: 'Bo Admin', can_edit_doc: true }, error: null })
  mocks.updateCurriculumFile
    .mockResolvedValueOnce({ data: null, error: 'conflict', status: 409 })
    .mockResolvedValueOnce({ data: { file: { ...plan, doc_version: 4 } }, error: null })
  await mount()
  await act(async () => button('Open doc', row('Job Search Plan')).click())
  await flush()
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!
  await act(async () => button('Edit doc', dialog()).click())
  await act(async () => setValue(dialog().querySelector('textarea')!, 'mine'))
  await act(async () => button('Save doc', dialog()).click())
  await flush()
  expect(dialog().textContent).toContain("Their version couldn't be loaded: Request timed out.")
  expect(button('Save doc', dialog()).disabled).toBe(true)
  expect(dialog().querySelector('textarea')!.value).toBe('mine')
  // Cancelling and reopening Edit keeps the doc marked stale until a fresh version actually loads.
  await act(async () => button('Cancel', dialog()).click())
  await act(async () => button('Edit doc', dialog()).click())
  await act(async () => setValue(dialog().querySelector('textarea')!, 'still stale'))
  expect(button('Save doc', dialog()).disabled).toBe(true)
  expect(dialog().textContent).toContain("Their version couldn't be loaded: Request timed out.")
  await act(async () => button('Try loading again', dialog()).click())
  await flush()
  await act(async () => button('Load latest version', dialog()).click())
  await act(async () => setValue(dialog().querySelector('textarea')!, 'v3 and mine'))
  await act(async () => button('Save doc', dialog()).click())
  await flush()
  expect(mocks.updateCurriculumFile).toHaveBeenLastCalledWith(7, 1, { doc_content: 'v3 and mine', base_doc_version: 3 })
})

it('tells an admin renaming a doc when the latest version cannot load after a conflict', async () => {
  mocks.updateCurriculumFile.mockResolvedValueOnce({ data: null, error: 'conflict', status: 409 })
  mocks.getCurriculumDoc.mockResolvedValueOnce({ data: null, error: 'Request timed out.' })
  await mount()
  await act(async () => (await menuItem('Job Search Plan', 'Edit details'))!.click())
  await act(async () => button('Save', container.querySelector('[aria-label="Template files"]')!).click())
  await flush()
  expect(container.textContent).toContain("the latest version couldn't be loaded (Request timed out.)")
})

it('deletes a template after confirming', async () => {
  mocks.deleteCurriculumFile.mockResolvedValue({ data: null, error: null })
  await mount()
  await act(async () => (await menuItem('Cohort Schedule & Office Hours', 'Delete'))!.click())
  expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ tone: 'danger', confirmLabel: 'Delete template' }))
  expect(mocks.deleteCurriculumFile).toHaveBeenCalledWith(7, 2)
  expect(row('Cohort Schedule & Office Hours')).toBeUndefined()
})
