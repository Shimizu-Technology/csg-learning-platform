// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCohortDoc: vi.fn(), saveCohortDoc: vi.fn(), getCohortDocRevisions: vi.fn(), getCohortDocRevision: vi.fn(), restoreCohortDocRevision: vi.fn(),
  getCohortFileComments: vi.fn(), createCohortFileComment: vi.fn(), deleteCohortFileComment: vi.fn(), setCohortFileReview: vi.fn(), confirm: vi.fn(),
}))
vi.mock('../../lib/api', () => ({ api: mocks }))
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => mocks.confirm }))
// The rich editor is exercised in its own tests; a plain text box stands in for it here.
vi.mock('./LazyMarkdownEditor', () => ({
  LazyMarkdownEditor: ({ label, value, onChange, disabled }: { label: string; value: string; onChange: (value: string) => void; disabled?: boolean }) => (
    <textarea aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
  ),
}))
import { CohortDocEditorModal } from './CohortDocEditorModal'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type DocFile = Parameters<typeof CohortDocEditorModal>[0]['file']
const docFile = (overrides: Partial<DocFile> = {}) => ({
  id: 7, cohort_id: 4, student_id: 3, source_file_id: null, kind: 'doc', folder: 'Career', visibility: 'students', title: 'Job search plan', description: null,
  filename: null, content_type: null, file_size: null, external_url: null, link_provider: null, version_number: 1, previewable: false, preview_mode: null,
  ready: true, ready_at: null, created_at: '2026-11-24T00:00:00Z', uploaded_by_name: 'Ina Instructor', uploaded_by_role: 'staff', can_manage: false,
  review_status: 'none', reviewed_by_name: null, reviewed_at: null, comment_count: 0, doc_updated_at: '2026-11-24T00:00:00.000001Z', doc_updated_by_name: 'Ina Instructor',
  can_edit_doc: true, ...overrides,
}) as DocFile
const docResponse = (content: string, updatedAt = '2026-11-24T00:00:00.000001Z', overrides: Partial<DocFile> = {}) => ({
  data: { file: docFile({ doc_updated_at: updatedAt, ...overrides }), doc_content: content, doc_updated_at: updatedAt, doc_updated_by_name: 'Ina Instructor', can_edit_doc: overrides.can_edit_doc ?? true, revision_count: 2 },
  error: null,
})

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  mocks.getCohortDocRevisions.mockResolvedValue({ data: { revisions: [] }, error: null })
  mocks.getCohortFileComments.mockResolvedValue({ data: { comments: [], can_comment: true }, error: null })
  mocks.confirm.mockResolvedValue(true)
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); document.body.innerHTML = '' })

async function mount(props: Partial<Parameters<typeof CohortDocEditorModal>[0]> = {}) {
  const onFileChange = vi.fn()
  await act(async () => root.render(<CohortDocEditorModal cohortId={4} file={docFile()} open onClose={vi.fn()} onFileChange={onFileChange} {...props} />))
  await flush()
  return onFileChange
}
async function flush(ms = 0) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.trim() === text || item.getAttribute('aria-label') === text)!
function type(element: HTMLTextAreaElement | HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')!.set!
  act(() => {
    setter.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

it('ticks a task in Read view and saves it once typing pauses, sending the version it was based on', async () => {
  mocks.getCohortDoc.mockResolvedValue(docResponse('# Plan\n\n- [ ] Draft resume\n- [x] Pick roles\n'))
  mocks.saveCohortDoc.mockResolvedValue(docResponse('# Plan\n\n- [x] Draft resume\n- [x] Pick roles\n', '2026-11-24T00:05:00.123456Z'))
  const onFileChange = await mount()
  expect(dialog().textContent).toContain('Learn Doc · Saved')
  const box = dialog().querySelector<HTMLInputElement>('input[type="checkbox"][aria-label="Draft resume"]')!
  expect(box.disabled).toBe(false)
  act(() => box.click())
  expect(dialog().textContent).toContain('Unsaved changes')
  await flush(1400)
  expect(mocks.saveCohortDoc).not.toHaveBeenCalled()
  await flush(200)
  expect(mocks.saveCohortDoc).toHaveBeenCalledWith(4, 7, { doc_content: '# Plan\n\n- [x] Draft resume\n- [x] Pick roles\n', title: 'Job search plan', base_updated_at: '2026-11-24T00:00:00.000001Z' })
  expect(dialog().textContent).toContain('Learn Doc · Saved')
  expect(onFileChange).toHaveBeenCalledWith(expect.objectContaining({ doc_updated_at: '2026-11-24T00:05:00.123456Z' }))

  // The next save is based on the version the server just returned; Save records a revision.
  act(() => button('Edit').click())
  type(dialog().querySelector<HTMLTextAreaElement>('textarea[aria-label="Doc content"]')!, '# Plan\n\nAll done')
  await act(async () => button('Save').click())
  await flush()
  expect(mocks.saveCohortDoc).toHaveBeenLastCalledWith(4, 7, { doc_content: '# Plan\n\nAll done', title: 'Job search plan', base_updated_at: '2026-11-24T00:05:00.123456Z', save_revision: true })
})

it('stops saving on a 409 and offers the latest version without losing the typed text first', async () => {
  mocks.getCohortDoc.mockResolvedValueOnce(docResponse('Start')).mockResolvedValueOnce(docResponse('Teacher feedback', '2026-11-24T00:09:00.000001Z'))
  mocks.saveCohortDoc.mockResolvedValue({ data: null, error: 'This document was updated by someone else.', status: 409 })
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
  await mount()
  act(() => button('Edit').click())
  type(dialog().querySelector<HTMLTextAreaElement>('textarea[aria-label="Doc content"]')!, 'My overwrite')
  await flush(1600)
  const banner = dialog().querySelector('[role="alert"]')!
  expect(banner.textContent).toContain('Someone else updated this doc')
  expect(dialog().textContent).toContain('Not saved: someone else updated this doc')
  // No retry loop while the conflict stands.
  await flush(5000)
  expect(mocks.saveCohortDoc).toHaveBeenCalledTimes(1)
  await act(async () => button('Copy my text').click())
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith('My overwrite')
  await act(async () => button('Load latest').click())
  await flush()
  expect(dialog().querySelector<HTMLTextAreaElement>('textarea[aria-label="Doc content"]')!.value).toBe('Teacher feedback')
  expect(dialog().textContent).toContain('Learn Doc · Saved')
})

it('lists history, shows a revision and restores it from the loaded version', async () => {
  mocks.getCohortDoc.mockResolvedValue(docResponse('Current'))
  mocks.getCohortDocRevisions.mockResolvedValue({ data: { revisions: [
    { id: 21, cohort_file_id: 7, revision_number: 2, title: 'Job search plan', summary: 'Ready for class', edited_by_name: 'Ina Instructor', created_at: '2026-11-24T00:00:00Z', content_length: 7 },
    { id: 20, cohort_file_id: 7, revision_number: 1, title: 'Job search plan', summary: null, edited_by_name: 'Student One', created_at: '2026-11-23T00:00:00Z', content_length: 8 },
  ] }, error: null })
  mocks.getCohortDocRevision.mockResolvedValue({ data: { revision: { id: 20, cohort_file_id: 7, revision_number: 1, title: 'Job search plan', summary: null, edited_by_name: 'Student One', created_at: '2026-11-23T00:00:00Z', content_length: 8, content: 'Original' } }, error: null })
  mocks.restoreCohortDocRevision.mockResolvedValue(docResponse('Original', '2026-11-24T01:00:00.000001Z'))
  await mount({ file: docFile({ student_id: null }) })
  const history = dialog().querySelector('[aria-label="Revision history"]')!
  expect(history.textContent).toContain('Ready for class')
  expect(history.textContent).toContain('Student One')
  await act(async () => [...history.querySelectorAll('button')][1].click())
  await flush()
  expect(dialog().textContent).toContain('Revision 1')
  expect(dialog().textContent).toContain('Original')
  await act(async () => button('Restore this version').click())
  await flush()
  expect(mocks.restoreCohortDocRevision).toHaveBeenCalledWith(4, 7, 20, '2026-11-24T00:00:00.000001Z')
  expect(dialog().querySelector('article')!.textContent).toContain('Original')
})

it('is read only without edit rights, with review and comments beside it for a student-folder doc', async () => {
  mocks.getCohortDoc.mockResolvedValue(docResponse('- [ ] Locked task', undefined, { can_edit_doc: false }))
  mocks.getCohortFileComments.mockResolvedValue({ data: { comments: [], can_comment: false }, error: null })
  await mount({ file: docFile({ can_edit_doc: false }), reviewAccess: { staff: false, canChange: false } })
  expect(dialog().textContent).toContain('Learn Doc · Read only')
  expect(button('Save')).toBeUndefined()
  expect(button('Edit')).toBeUndefined()
  expect(dialog().querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled).toBe(true)
  const side = dialog().querySelector('[aria-label="Review and comments"]')!
  expect(side.textContent).toContain('read only while your course is paused')
  expect(side.querySelector('textarea')).toBeNull()
})

it('downloads the doc as Markdown and prints only the doc', async () => {
  mocks.getCohortDoc.mockResolvedValue(docResponse('# Plan'))
  const createObjectURL = vi.fn(() => 'blob:doc')
  Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() })
  const print = vi.spyOn(window, 'print').mockImplementation(() => undefined)
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
  await mount()
  await act(async () => button('Export this doc').click())
  await act(async () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent?.includes('Download .md'))!.click())
  expect(createObjectURL).toHaveBeenCalledTimes(1)
  expect(click).toHaveBeenCalledTimes(1)
  await act(async () => button('Export this doc').click())
  await act(async () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent?.includes('Print'))!.click())
  expect(document.querySelector('.doc-print-root h1')!.textContent).toBe('Job search plan')
  await flush(50)
  expect(print).toHaveBeenCalledTimes(1)
  expect(document.querySelector('.doc-print-root')).toBeNull()
})
