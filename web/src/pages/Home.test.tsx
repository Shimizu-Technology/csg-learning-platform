import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({ value: { isSignedIn: false, user: null as null | { is_staff: boolean } } }))
vi.mock('../contexts/AuthContext', () => ({ useAuthContext: () => auth.value }))

import { HomePage } from './Home'

function render() {
  return renderToStaticMarkup(<MemoryRouter><HomePage /></MemoryRouter>)
}

describe('HomePage (signed-out landing)', () => {
  beforeEach(() => {
    auth.value = { isSignedIn: false, user: null }
  })

  it('makes the invitation path obvious next to sign in', () => {
    const html = render()
    expect(html).toContain('href="/sign-in"')
    expect(html.match(/href="\/sign-up"[^>]*>[^<]*I have an invitation/g)?.length).toBeGreaterThanOrEqual(1)
    expect(html).toContain('Open your invitation email and choose “Accept invitation” to create your account')
  })

  it('links back to the CSG site and the course catalog', () => {
    const html = render()
    expect(html).toContain('href="https://codeschoolofguam.com/courses"')
    expect(html).toContain('href="https://codeschoolofguam.com/"')
    expect(html).toContain('href="/courses"')
  })

  it('uses the CSG brand: logo, Newsreader display heading, cream surface, one product name', () => {
    const html = render()
    expect(html).toContain('src="/CSG-Logo.png"')
    expect(html).toMatch(/<h1 class="[^"]*font-display/)
    expect(html).toContain('bg-brand-cream')
    expect(html).toContain('aria-label="CSG Learn home"')
  })

  it('labels the product illustration honestly and drops the old Rails mockup', () => {
    const html = render()
    expect(html).toContain('Illustration with sample course content')
    expect(html).not.toMatch(/Rails API|Week 4/)
  })

  it('offers one continue action when signed in', () => {
    auth.value = { isSignedIn: true, user: { is_staff: false } }
    const html = render()
    expect(html).toContain('Continue learning')
    expect(html).not.toContain('I have an invitation')
  })
})
