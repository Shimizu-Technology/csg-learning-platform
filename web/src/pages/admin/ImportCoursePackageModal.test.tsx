// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../lib/api'
import { ImportCoursePackageModal } from './ImportCoursePackageModal'

const preview = { key: 'python', revision: 'v1', title: 'Python', modules: 1, lessons: 26, blocks: 36, existing_curriculum_id: null, unchanged: false, status: 'draft', assigned: false }

describe('course package import', () => {
  let container: HTMLDivElement
  let root: Root
  const onClose = vi.fn()
  const onImported = vi.fn(async () => undefined)
  beforeEach(async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(callback, 0))
    vi.stubGlobal('cancelAnimationFrame', clearTimeout)
    vi.spyOn(api, 'previewCoursePackage').mockResolvedValue({ data: { preview }, error: null, status: 200 })
    vi.spyOn(api, 'importCoursePackage').mockResolvedValue({ data: { import: { curriculum_id: 12, unchanged: false } }, error: null, status: 201 })
    await act(async () => root.render(<ImportCoursePackageModal onClose={onClose} onImported={onImported} />))
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    onClose.mockClear()
    onImported.mockClear()
  })
  async function load(contents: string, size = contents.length) {
    const input = container.querySelector<HTMLInputElement>('input')!
    Object.defineProperty(input, 'files', { configurable: true, value: [{ size, text: async () => contents }] })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
  }
  function importButton() { return Array.from(container.querySelectorAll('button')).find(button => /Import draft|Confirm existing course/.test(button.textContent || ''))! }

  it('requires server preview and explicit confirmation before saving', async () => {
    expect(importButton().disabled).toBe(true)
    await load('{"schema_version":1}')
    expect(container.textContent).toContain('26 lessons')
    expect(api.importCoursePackage).not.toHaveBeenCalled()
    await act(async () => importButton().click())
    expect(api.importCoursePackage).toHaveBeenCalledWith({ schema_version: 1 })
    expect(onImported).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })
  it('clears a previous preview when a replacement file is malformed or oversized', async () => {
    await load('{}')
    await load('bad json')
    expect(importButton().disabled).toBe(true)
    expect(container.querySelector('[role="alert"]')).not.toBeNull()
    await load('{}', 2 * 1024 * 1024 + 1)
    expect(container.textContent).toContain('smaller than 2 MB')
    expect(api.previewCoursePackage).toHaveBeenCalledTimes(1)
  })
  it('shows server eligibility errors and keeps a failed save open', async () => {
    vi.mocked(api.previewCoursePackage).mockResolvedValueOnce({ data: null, error: 'Assigned curriculum cannot be revised', status: 422 })
    await load('{}')
    expect(container.textContent).toContain('Assigned curriculum cannot be revised')
    expect(importButton().disabled).toBe(true)
    await load('{}')
    vi.mocked(api.importCoursePackage).mockResolvedValueOnce({ data: null, error: 'Staff changed this draft', status: 422 })
    await act(async () => importButton().click())
    expect(container.textContent).toContain('Staff changed this draft')
    expect(onClose).not.toHaveBeenCalled()
    expect(onImported).not.toHaveBeenCalled()
  })
  it('labels an already imported assigned course with its actual status', async () => {
    vi.mocked(api.previewCoursePackage).mockResolvedValueOnce({ data: { preview: { ...preview, unchanged: true, existing_curriculum_id: 12, status: 'active', assigned: true } }, error: null, status: 200 })
    await load('{}')
    expect(container.textContent).toContain('Current status: active, assigned to a cohort')
    expect(importButton().textContent).toBe('Confirm existing course')
  })
})
