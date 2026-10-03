import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { CohortSwitcher } from './CohortSwitcher'

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
    selectCohort: vi.fn(),
  }),
}))

describe('CohortSwitcher', () => {
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
})
