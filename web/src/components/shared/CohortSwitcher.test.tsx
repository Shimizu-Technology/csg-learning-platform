// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CohortSwitcher } from './CohortSwitcher'

const { selectCohort, state } = vi.hoisted(() => ({ selectCohort: vi.fn(), state: { selectedName: 'Web Dev Cohort 4' } }))

vi.mock('../../contexts/AuthContext', () => ({
  useAuthContext: () => ({ user: { id: 7, is_staff: true } }),
}))

vi.mock('../../contexts/CohortContext', () => ({
  useCohortContext: () => ({
    cohorts: [
      { id: 1, name: 'Web Dev Cohort 4', status: 'active' },
      { id: 2, name: 'CSG Alumni', status: 'completed' },
    ],
    selectedCohort: { id: 1, name: state.selectedName, status: 'active' },
    loading: false,
    error: null,
    selectCohort,
  }),
}))

describe('CohortSwitcher', () => {
  afterEach(() => { selectCohort.mockClear(); state.selectedName = 'Web Dev Cohort 4' })

  it('uses a bounded icon-only control in the collapsed sidebar', () => {
    const html = renderToStaticMarkup(<CohortSwitcher iconOnly />)

    expect(html).toContain('aria-label="Switch cohort workspace. Current cohort: Web Dev Cohort 4"')
    expect(html).toContain('data-cohort-switcher-visual="icon-only"')
    expect(html).toContain('absolute inset-0')
    expect(html).toContain('max-w-full')
    expect(html).toContain('opacity-0')
    expect(html).not.toContain('lucide-chevron-down')
  })

  it('keeps the labeled select treatment for expanded and mobile layouts', () => {
    const html = renderToStaticMarkup(<CohortSwitcher compact />)

    expect(html).toContain('aria-label="Switch cohort workspace"')
    expect(html).toContain('Web Dev Cohort 4')
    expect(html).toContain('lucide-chevron-down')
    expect(html).not.toContain('data-cohort-switcher-visual="icon-only"')
  })

  it('renders the visible cohort name in a truncating span so long names end in an ellipsis', () => {
    const container = document.createElement('div')
    const root = createRoot(container)

    act(() => root.render(<CohortSwitcher compact />))
    const label = container.querySelector('[data-cohort-switcher-label]')!
    expect(label.textContent).toBe('Web Dev Cohort 4')
    expect(label.className).toContain('truncate')
    expect(label.className).toContain('min-w-0')
    expect(container.querySelector('select')!.className).toContain('opacity-0')
    act(() => root.unmount())
  })

  it('keeps a very long cohort name whole in the label and title for truncation', () => {
    const longName = 'Python Fundamentals — Saturday Evening Extended Practice Group (Hagåtña)'
    state.selectedName = longName
    const container = document.createElement('div')
    const root = createRoot(container)

    act(() => root.render(<CohortSwitcher compact />))
    expect(container.querySelector('[data-cohort-switcher-label]')!.textContent).toBe(longName)
    expect(container.querySelector('select')!.getAttribute('title')).toBe(longName)
    act(() => root.unmount())
  })

  it('changes cohorts through the native control in icon-only mode', () => {
    const container = document.createElement('div')
    const root = createRoot(container)

    act(() => root.render(<CohortSwitcher iconOnly />))
    const select = container.querySelector('select')!
    act(() => {
      select.value = '2'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(selectCohort).toHaveBeenCalledOnce()
    expect(selectCohort).toHaveBeenCalledWith(2)
    act(() => root.unmount())
  })
})
