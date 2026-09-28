// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ selectedId: 1, getResources: vi.fn() }))

vi.mock('../../contexts/CohortContext', () => ({
  useCohortContext: () => ({ selectedCohortId: state.selectedId }),
}))
vi.mock('../../lib/api', () => ({ api: { getResources: state.getResources } }))

import { Resources } from './Resources'

describe('Resources course switching', () => {
  let container: HTMLDivElement
  let root: Root
  const pending = new Map<number, (value: unknown) => void>()

  beforeEach(() => {
    state.selectedId = 1
    state.getResources.mockReset()
    state.getResources.mockImplementation((cohortId: number) => new Promise((resolve) => pending.set(cohortId, resolve)))
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    pending.clear()
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
})
