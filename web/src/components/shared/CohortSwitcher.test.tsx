// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CohortSwitcher } from './CohortSwitcher'

const { selectCohort } = vi.hoisted(() => ({ selectCohort: vi.fn() }))

vi.mock('../../contexts/AuthContext', () => ({
  useAuthContext: () => ({ user: { id: 7, is_staff: true } }),
}))

vi.mock('../../contexts/CohortContext', () => ({
  useCohortContext: () => ({
    cohorts: [
      { id: 1, name: 'Web Dev Cohort 4', status: 'active' },
      { id: 2, name: 'CSG Alumni', status: 'completed' },
    ],
    selectedCohort: { id: 1, name: 'Web Dev Cohort 4', status: 'active' },
    loading: false,
    error: null,
    selectCohort,
  }),
}))

describe('CohortSwitcher', () => {
  afterEach(() => selectCohort.mockClear())

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
