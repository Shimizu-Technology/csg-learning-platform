// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../lib/api'
import { uploadToS3 } from '../../lib/uploadToS3'
import { CourseResourcesPanel } from './CourseResourcesPanel'

vi.mock('../../lib/uploadToS3', () => ({ uploadToS3: vi.fn() }))

describe('draft course ZIP upload', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(async () => {
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
    vi.spyOn(api, 'getCurriculumResources').mockResolvedValue({ data: { resources: [] }, error: null })
    vi.spyOn(api, 'createCurriculumResource').mockResolvedValue({ data: { resource: { download_id: 8 }, upload_url: 'https://storage.test/upload', fields: { key: 'staging' } }, error: null })
    vi.spyOn(api, 'completeCurriculumResource').mockResolvedValue({ data: { resource: {} }, error: null })
    vi.spyOn(api, 'abandonCurriculumResource').mockResolvedValue({ data: null, error: null })
    vi.mocked(uploadToS3).mockResolvedValue(undefined)
    await act(async () => root.render(<CourseResourcesPanel curriculumId={3} draft />))
  })
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.mocked(uploadToS3).mockReset() })
  async function selectFile(name: string) {
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['ZIP'], name)] })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
  }
  it('keeps upload and confirmation scoped to the selected curriculum', async () => {
    await selectFile('python.zip')
    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click())
    expect(api.createCurriculumResource).toHaveBeenCalledWith(3, { title: 'Learner resources', filename: 'python.zip', file_size: 3 })
    expect(uploadToS3).toHaveBeenCalledOnce()
    expect(api.completeCurriculumResource).toHaveBeenCalledWith(3, 8)
    expect(container.textContent).toContain('ZIP uploaded')
    expect(api.abandonCurriculumResource).not.toHaveBeenCalled()
  })
  it('rejects other file types before upload and cleans staged failures', async () => {
    await selectFile('keys.txt')
    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click())
    expect(api.createCurriculumResource).not.toHaveBeenCalled()
    await selectFile('python.zip')
    vi.mocked(uploadToS3).mockRejectedValueOnce(new Error('Connection lost'))
    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click())
    expect(api.abandonCurriculumResource).toHaveBeenCalledWith(3, 8)
    expect(api.completeCurriculumResource).not.toHaveBeenCalled()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Connection lost')
  })
  it('has no upload action on active curricula', async () => {
    await act(async () => root.render(<CourseResourcesPanel curriculumId={3} draft={false} />))
    expect(container.querySelector('input[type="file"]')).toBeNull()
  })
})
