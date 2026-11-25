// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ uploadCohortFile: vi.fn() }))
vi.mock('../../lib/cohortFiles', async (original) => ({
  ...(await original<typeof import('../../lib/cohortFiles')>()),
  uploadCohortFile: mocks.uploadCohortFile,
}))
import { CohortFileUploader } from './CohortFileParts'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.clearAllMocks()
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
  expect(mocks.uploadCohortFile).toHaveBeenNthCalledWith(1, 4, expect.any(File), expect.objectContaining({ title: 'Week 1 Slides', folder: 'Slides' }), expect.any(Function))
  expect(onUploaded).toHaveBeenCalledTimes(1)
  expect(onFinished).not.toHaveBeenCalled()
  expect(container.textContent).toContain('Could not upload week-2.pdf.')

  await act(async () => button('Retry').click())
  expect(mocks.uploadCohortFile).toHaveBeenCalledTimes(3)
  expect(onUploaded).toHaveBeenCalledTimes(2)
  expect(onFinished).toHaveBeenCalledTimes(1)
  expect(container.querySelector('ul[aria-label="Files to upload"]')).toBeNull()
})
