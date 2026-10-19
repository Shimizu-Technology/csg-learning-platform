import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/api', () => ({ api: { acceptCommunityPolicy: vi.fn() } }))

import { CommunityStandardsGate } from './CommunityStandardsGate'

describe('CommunityStandardsGate', () => {
  it('uses a plain "Agree and continue" action and the product name', () => {
    const html = renderToStaticMarkup(<MemoryRouter><CommunityStandardsGate version="2026-08-17" onAccepted={async () => {}} /></MemoryRouter>)
    expect(html).toContain('Agree and continue')
    expect(html).toContain('Welcome to CSG Learn')
    expect(html).not.toContain('CSG Connect')
    expect(html).toMatch(/<h1[^>]*font-display/)
  })
})
