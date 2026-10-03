// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ selectedId: 1, getResources: vi.fn(), download: vi.fn() }))

vi.mock('../../contexts/CohortContext', () => ({
  useCohortContext: () => ({ selectedCohortId: state.selectedId }),
}))
vi.mock('../../lib/api', () => ({ api: { getResources: state.getResources, downloadCurriculumResource: state.download } }))

import { Resources } from './Resources'

describe('Resources course switching', () => {
  let container: HTMLDivElement
  let root: Root
  const pending = new Map<number, (value: unknown) => void>()

  beforeEach(() => {
    state.selectedId = 1
    state.getResources.mockReset()
    state.download.mockReset()
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
})
