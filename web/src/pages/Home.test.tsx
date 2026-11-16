// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({ value: { isSignedIn: false, user: null as null | { is_staff: boolean } } }))
vi.mock('../contexts/AuthContext', () => ({ useAuthContext: () => auth.value }))

vi.mock('../lib/api', () => ({ api: { getCourseOfferings: vi.fn() } }))
import { api } from '../lib/api'
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

  it('links back to the CSG site without advertising the catalog before loading', () => {
    const html = render()
    expect(html).toContain('href="https://codeschoolofguam.com/courses"')
    expect(html).toContain('href="https://codeschoolofguam.com/"')
    expect(html).not.toContain('href="/courses"')
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

  it('offers staff Today', () => {
    auth.value = { isSignedIn: true, user: { is_staff: true } }
    expect(render()).toContain('Open Today')
    expect(render()).not.toContain('Continue learning')
  })

  it('offers one continue action when signed in', () => {
    auth.value = { isSignedIn: true, user: { is_staff: false } }
    const html = render()
    expect(html).toContain('Continue learning')
    expect(html).not.toContain('I have an invitation')
  })
})

describe('automatic public catalog availability', () => {
  let root: Root
  let container: HTMLDivElement
  const getOfferings = vi.mocked(api.getCourseOfferings)
  type Result = Awaited<ReturnType<typeof api.getCourseOfferings>>
  const result = (...purchasable: boolean[]): Result => ({ error: null, data: { offerings: purchasable.map((checkout_available, id) => ({
    id, name: 'Sample course', curriculum_name: 'Foundations', checkout_available,
    price_cents: 14900, currency: 'USD', access_months: 12, instructor_message_weeks: 6,
    instructor_response_target: '2 Guam business days', includes_private_meetings: false,
    includes_individual_project_review: false,
  })) } })
  const renderPage = async () => act(async () => root.render(<StrictMode><MemoryRouter><HomePage /></MemoryRouter></StrictMode>))
  const catalogLink = () => container.querySelector('a[href="/courses"]')
  const schoolLink = () => container.querySelector('a[href="https://codeschoolofguam.com/courses"]')

  beforeEach(() => {
    vi.clearAllMocks()
    auth.value = { isSignedIn: false, user: null }
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  it.each([[[]], [[false, false]]])('hides the catalog with no purchasable offering: %j', async (available) => {
    getOfferings.mockResolvedValue(result(...available))
    await renderPage()
    expect(catalogLink()).toBeNull()
    expect(schoolLink()).not.toBeNull()
    expect(schoolLink()?.parentElement?.children).toHaveLength(2)
  })

  it.each([false, true])('shows the catalog when one offering is purchasable (signed in: %s)', async (signedIn) => {
    auth.value = { isSignedIn: signedIn, user: signedIn ? { is_staff: false } : null }
    getOfferings.mockResolvedValue(result(false, true))
    await renderPage()
    expect(catalogLink()?.textContent).toContain('See the course catalog')
    expect(catalogLink()?.classList.contains('min-h-11')).toBe(true)
    expect(schoolLink()).not.toBeNull()
    await renderPage()
    expect(getOfferings).toHaveBeenCalledTimes(1)
  })

  it('hides the link while loading and preserves the school link when the response arrives', async () => {
    let resolve!: (value: Result) => void
    getOfferings.mockReturnValue(new Promise((done) => { resolve = done }))
    await renderPage()
    expect(catalogLink()).toBeNull()
    const school = schoolLink()
    expect(school).not.toBeNull()
    expect(school?.parentElement?.children).toHaveLength(2)
    const heading = container.querySelector('h1')
    await act(async () => resolve(result(true)))
    expect(catalogLink()).not.toBeNull()
    expect(schoolLink()).toBe(school)
    expect(container.querySelector('h1')).toBe(heading)
    expect(school?.parentElement?.children).toHaveLength(3)
  })

  it.each(['response', 'rejection'])('hides the link on an API %s error', async (kind) => {
    if (kind === 'response') getOfferings.mockResolvedValue({ ...result(true), error: 'Unavailable' })
    else getOfferings.mockRejectedValue(new Error('Offline'))
    await renderPage()
    expect(catalogLink()).toBeNull()
    expect(schoolLink()).not.toBeNull()
  })

  it('ignores a response after unmount', async () => {
    let resolve!: (value: Result) => void
    getOfferings.mockReturnValue(new Promise((done) => { resolve = done }))
    await renderPage()
    await act(async () => root.render(null))
    await act(async () => resolve(result(true)))
    expect(container.textContent).toBe('')
  })
})
