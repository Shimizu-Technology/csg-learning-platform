// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ uploadCohortFile: vi.fn(), abandonCohortUpload: vi.fn(), completeCohortFile: vi.fn() }))
vi.mock('../../lib/api', () => ({ api: { completeCohortFile: mocks.completeCohortFile } }))
vi.mock('../../lib/cohortFiles', async (original) => ({
  ...(await original<typeof import('../../lib/cohortFiles')>()),
  uploadCohortFile: mocks.uploadCohortFile,
  abandonCohortUpload: mocks.abandonCohortUpload,
}))
import { CohortFileUploader } from './CohortFileParts'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.clearAllMocks()
  mocks.uploadCohortFile.mockReset()
  mocks.abandonCohortUpload.mockReset()
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })

const button = (text: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.includes(text))!
const pdf = (name: string) => new File(['%PDF-1.7'], name, { type: 'application/pdf' })

async function choose(files: File[]) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
  Object.defineProperty(input, 'files', { configurable: true, value: files })
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
}

it('labels the hidden file input with the heading and accepts several files', async () => {
  await act(async () => root.render(<CohortFileUploader cohortId={4} heading="Upload class files" folderPresets={['Slides']} onUploaded={vi.fn()} />))
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
  expect(input.getAttribute('aria-label')).toBe('Upload class files')
  expect(input.className).toContain('sr-only')
  expect(input.multiple).toBe(true)
})

it('queues several files with editable titles, uploads each, and retries only a failed one', async () => {
  const onUploaded = vi.fn()
  const onFinished = vi.fn()
  mocks.uploadCohortFile
    .mockImplementationOnce(async (_cohort: number, file: File, options: { title: string }) => ({ id: 1, title: options.title, filename: file.name }))
    .mockRejectedValueOnce(new Error('Could not upload week-2.pdf.'))
    .mockImplementationOnce(async (_cohort: number, file: File, options: { title: string }) => ({ id: 2, title: options.title, filename: file.name }))
  await act(async () => root.render(<CohortFileUploader cohortId={4} heading="Upload class files" folderPresets={['Slides', 'General']}
    onUploaded={onUploaded} onFinished={onFinished} />))
  await choose([pdf('week-1_slides.pdf'), pdf('week-2.pdf'), new File(['<svg>'], 'logo.svg', { type: 'image/svg+xml' })])

  expect(container.querySelectorAll('ul[aria-label="Files to upload"] li')).toHaveLength(2)
  expect(container.textContent).toContain("logo.svg can't be uploaded")
  const title = container.querySelector<HTMLInputElement>('input[aria-label="Title for week-1_slides.pdf"]')!
  expect(title.value).toBe('week 1 slides')
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(title, 'Week 1 Slides')
    title.dispatchEvent(new Event('input', { bubbles: true }))
  })

  await act(async () => button('Upload 2 files').click())
  expect(mocks.uploadCohortFile).toHaveBeenNthCalledWith(1, 4, expect.any(File), expect.objectContaining({ title: 'Week 1 Slides', folder: 'Slides' }), expect.any(Function), expect.any(Object))
  expect(onUploaded).toHaveBeenCalledTimes(1)
  expect(onFinished).not.toHaveBeenCalled()
  expect(container.textContent).toContain('Could not upload week-2.pdf.')

  await act(async () => button('Retry').click())
  expect(mocks.uploadCohortFile).toHaveBeenCalledTimes(3)
  expect(onUploaded).toHaveBeenCalledTimes(2)
  expect(onFinished).toHaveBeenCalledTimes(1)
  expect(container.querySelector('ul[aria-label="Files to upload"]')).toBeNull()
})

it('retries a failed row with the same upload state, so a lost confirmation never creates a second file', async () => {
  const states: unknown[] = []
  mocks.uploadCohortFile
    .mockImplementationOnce(async (...args: unknown[]) => { states.push(args[4]); Object.assign(args[4] as object, { fileId: 41, uploaded: true }); throw new Error('Network lost') })
    .mockImplementationOnce(async (...args: unknown[]) => { states.push(args[4]); return { id: 41, title: 'notes' } })
  const onUploaded = vi.fn()
  await act(async () => root.render(<CohortFileUploader cohortId={4} heading="Upload class files" folderPresets={['Slides']} onUploaded={onUploaded} />))
  await choose([pdf('notes.pdf')])
  await act(async () => button('Upload file').click())
  await act(async () => button('Retry').click())
  expect(states).toHaveLength(2)
  expect(states[1]).toBe(states[0])
  expect(states[1]).toMatchObject({ fileId: 41, uploaded: true })
  expect(onUploaded).toHaveBeenCalledWith({ id: 41, title: 'notes' })
  expect(mocks.abandonCohortUpload).not.toHaveBeenCalled()
})

it('abandons a failed row\'s pending file when it is removed', async () => {
  mocks.abandonCohortUpload.mockResolvedValue(undefined)
  mocks.uploadCohortFile.mockImplementationOnce(async (...args: unknown[]) => { Object.assign(args[4] as object, { fileId: 42 }); throw new Error('Network lost') })
  await act(async () => root.render(<CohortFileUploader cohortId={4} heading="Upload class files" folderPresets={['Slides']} onUploaded={vi.fn()} />))
  await choose([pdf('notes.pdf')])
  await act(async () => button('Upload file').click())
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Remove notes.pdf"]')!.click())
  expect(mocks.abandonCohortUpload).toHaveBeenCalledWith(4, expect.objectContaining({ fileId: 42 }))
  expect(container.querySelector('ul[aria-label="Files to upload"]')).toBeNull()
})

it('keeps a row with an error when its pending file could not be abandoned', async () => {
  mocks.abandonCohortUpload.mockRejectedValue(new Error('Server error'))
  mocks.uploadCohortFile.mockImplementationOnce(async (...args: unknown[]) => { Object.assign(args[4] as object, { fileId: 43 }); throw new Error('Network lost') })
  await act(async () => root.render(<CohortFileUploader cohortId={4} heading="Upload class files" folderPresets={['Slides']} onUploaded={vi.fn()} />))
  await choose([pdf('notes.pdf')])
  await act(async () => button('Upload file').click())
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Remove notes.pdf"]')!.click())
  expect(container.querySelectorAll('ul[aria-label="Files to upload"] li')).toHaveLength(1)
  expect(container.textContent).toContain("Couldn't cancel this upload. Server error")
})

it('stops a running batch when the uploader unmounts, before starting the next file', async () => {
  let release: () => void = () => {}
  mocks.uploadCohortFile.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({ id: 1, title: 'a' }) }))
    .mockResolvedValue({ id: 2, title: 'b' })
  await act(async () => root.render(<CohortFileUploader cohortId={4} heading="Upload class files" folderPresets={['Slides']} onUploaded={vi.fn()} />))
  await choose([pdf('a.pdf'), pdf('b.pdf'), pdf('c.pdf')])
  await act(async () => { button('Upload 3 files').click() })
  // Another student's folder opens: this uploader goes away mid-batch.
  await act(async () => root.render(<p>Another folder</p>))
  await act(async () => { release(); await new Promise((resolve) => setTimeout(resolve, 0)) })
  expect(mocks.uploadCohortFile).toHaveBeenCalledTimes(1)
})

it('reads each waiting row when its turn comes: removed rows are skipped and edited titles are used', async () => {
  let release: () => void = () => {}
  mocks.uploadCohortFile
    .mockImplementationOnce((_cohort: number, file: File, options: { title: string }) => new Promise((resolve) => { release = () => resolve({ id: 1, title: options.title, filename: file.name }) }))
    .mockImplementation(async (_cohort: number, file: File, options: { title: string }) => ({ id: 2, title: options.title, filename: file.name }))
  const onFinished = vi.fn()
  await act(async () => root.render(<CohortFileUploader cohortId={4} heading="Upload class files" folderPresets={['Slides']} onUploaded={vi.fn()} onFinished={onFinished} />))
  await choose([pdf('a.pdf'), pdf('b.pdf'), pdf('c.pdf')])
  await act(async () => { button('Upload 3 files').click() })
  // The uploading row is locked; waiting rows can still change.
  expect(container.querySelector<HTMLButtonElement>('button[aria-label="Remove a.pdf"]')!.disabled).toBe(true)
  expect(container.querySelector<HTMLInputElement>('input[aria-label="Title for a.pdf"]')!.disabled).toBe(true)
  const title = container.querySelector<HTMLInputElement>('input[aria-label="Title for b.pdf"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(title, 'Renamed B')
    title.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Remove c.pdf"]')!.click())
  await act(async () => { release(); await new Promise((resolve) => setTimeout(resolve, 0)) })
  expect(mocks.uploadCohortFile).toHaveBeenCalledTimes(2)
  expect(mocks.uploadCohortFile).toHaveBeenLastCalledWith(4, expect.any(File), expect.objectContaining({ title: 'Renamed B' }), expect.any(Function), expect.any(Object))
  expect(onFinished).toHaveBeenCalledTimes(1)
})

it('never retries or batch-uploads a row while it is being removed', async () => {
  let finishRemoving: (value: string) => void = () => {}
  mocks.abandonCohortUpload.mockImplementation(() => new Promise((resolve) => { finishRemoving = resolve }))
  mocks.uploadCohortFile.mockImplementationOnce(async (...args: unknown[]) => { Object.assign(args[4] as object, { fileId: 44 }); throw new Error('Network lost') })
  await act(async () => root.render(<CohortFileUploader cohortId={4} heading="Upload class files" folderPresets={['Slides']} onUploaded={vi.fn()} />))
  await choose([pdf('a.pdf')])
  await act(async () => button('Upload file').click())
  await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-label="Remove a.pdf"]')!.click() })
  // While the server cancels the pending file, neither Retry nor the batch button can start it again.
  expect(button('Retry').disabled).toBe(true)
  expect(container.querySelector<HTMLButtonElement>('button[aria-label="Remove a.pdf"]')!.disabled).toBe(true)
  const batch = [...container.querySelectorAll<HTMLButtonElement>('button')].find((item) => /^Upload( \d+)? files?$/.test(item.textContent || ''))!
  expect(batch.disabled).toBe(true)
  await act(async () => { batch.click(); button('Retry').click() })
  expect(mocks.uploadCohortFile).toHaveBeenCalledTimes(1)
  await act(async () => { finishRemoving('abandoned') })
  expect(container.querySelector('ul[aria-label="Files to upload"]')).toBeNull()
})

it('shows a removed row\'s file when the server says it was already published', async () => {
  const onUploaded = vi.fn()
  mocks.abandonCohortUpload.mockResolvedValue('published')
  mocks.completeCohortFile.mockResolvedValue({ data: { file: { id: 45, title: 'a' } }, error: null })
  mocks.uploadCohortFile.mockImplementationOnce(async (...args: unknown[]) => { Object.assign(args[4] as object, { fileId: 45 }); throw new Error('Network lost') })
  await act(async () => root.render(<CohortFileUploader cohortId={4} heading="Upload class files" folderPresets={['Slides']} onUploaded={onUploaded} />))
  await choose([pdf('a.pdf')])
  await act(async () => button('Upload file').click())
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Remove a.pdf"]')!.click())
  expect(mocks.completeCohortFile).toHaveBeenCalledWith(4, 45)
  expect(onUploaded).toHaveBeenCalledWith({ id: 45, title: 'a' })
})
