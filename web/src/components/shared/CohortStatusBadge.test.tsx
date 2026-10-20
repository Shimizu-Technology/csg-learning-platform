import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CohortStatusBadge } from './CohortStatusBadge'

describe('CohortStatusBadge', () => {
  it.each([
    ['active', 'success', 'Active'],
    ['upcoming', 'info', 'Upcoming'],
    ['completed', 'neutral', 'Completed'],
    ['archived', 'neutral', 'Archived'],
    ['on_hold', 'neutral', 'On hold'],
  ])('renders %s with the %s tone', (status, tone, label) => {
    const html = renderToStaticMarkup(<CohortStatusBadge status={status} />)
    expect(html).toContain(`data-tone="${tone}"`)
    expect(html).toContain(`>${label}</span>`)
  })
})
