// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CourseCatalog } from './CourseCatalog'
const state = vi.hoisted(() => ({ api: { getCourseOffering: vi.fn(), getCourseOfferings: vi.fn(), getPendingCoursePurchases: vi.fn() }, auth: { isSignedIn: false, user: null as unknown, enrollments: [] as unknown[] } }))
vi.mock('../lib/api', () => ({ api: state.api }))
vi.mock('../contexts/AuthContext', () => ({ useAuthContext: () => state.auth }))
let host: HTMLDivElement, root: ReturnType<typeof createRoot>
afterEach(() => { act(() => root.unmount()); host.remove(); vi.clearAllMocks(); state.auth.isSignedIn = false; state.auth.user = null; state.auth.enrollments = [] })
const course = { id: 13, slug: 'course-counter', name: 'Build a counter', description: 'Learn programming', outcomes: 'Explain your code', prerequisites: 'A browser', duration: '4 hours', preview: 'Try a counter', lesson_count: 2, syllabus: [{ title: 'Section', lessons: ['First steps', 'A project'] }], checkout_available: true, price_cents: 14900, access_months: 12, instructor_message_weeks: 6, instructor_response_target: 'usually reviewed within 2 days' }
beforeEach(() => state.api.getCourseOfferings.mockResolvedValue({ data: { public_catalog_mode: 'automatic', offerings: [course] } }))
async function render(search = '') {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(<MemoryRouter initialEntries={[`/courses/course-counter${search}`]}><Routes><Route path="/courses/:slug" element={<CourseCatalog />} /></Routes></MemoryRouter>))
}
it.each(['', '?utm_source=school&checkout=canceled'])('keeps the slug-selected course and query on the header Sign in link (%s)', async search => {
  state.api.getCourseOffering.mockResolvedValue({ data: { offering: course } })
  await render(search)
  const href = host.querySelector('header a[href^="/sign-in"]')!.getAttribute('href')!
  const params = new URLSearchParams(href.split('?')[1])
  expect(params.get('offering_id')).toBe('13')
  if (search) { expect(params.get('utm_source')).toBe('school'); expect(params.get('checkout')).toBe('canceled') }
})
it('shows public marketing, derived syllabus and a course-specific signup intent', async () => {
  state.api.getCourseOffering.mockResolvedValue({ data: { offering: course } })
  await render()
  expect(state.api.getCourseOffering).toHaveBeenCalledWith('course-counter')
  expect(host.querySelector('h1')?.textContent).toBe('Build a counter')
  for (const text of ['Explain your code', 'A browser', '4 hours', 'Try a counter', '2 lessons', 'First steps', 'A project']) expect(host.textContent).toContain(text)
  expect(host.querySelector('a[href="/sign-up?offering_id=13"]')).not.toBeNull()
  expect(host.querySelector('a[href="/courses"]')?.textContent).toBe('Back to courses')
})
it('makes an unlisted slug recoverable without an enrollment action', async () => {
  state.api.getCourseOffering.mockResolvedValue({ error: 'Not found', status: 404, data: null })
  await render()
  expect(host.querySelector('h1')?.textContent).toBe('This course isn’t available')
  expect(host.querySelector('a[href="/courses"]')?.textContent).toBe('Browse courses')
  expect(host.querySelector('main button')).toBeNull()
  expect(document.title).toContain('Course unavailable')
  expect(host.querySelector('a[href*="offering_id"]')).toBeNull()
})
it('opens an enrolled course on Today and promises self-paced instructor review', async () => {
  state.auth.isSignedIn = true; state.auth.user = { id: 1 }; state.auth.enrollments = [{ cohort: { id: 13 }, status: 'active' }]
  state.api.getCourseOffering.mockResolvedValue({ data: { offering: course } }); state.api.getPendingCoursePurchases.mockResolvedValue({ data: { purchases: [] } })
  await render()
  expect(host.querySelector('a[href="/dashboard?cohort_id=13"]')?.textContent).toContain('Open course')
  expect(host.textContent).toContain('Your instructor will review your work')
  expect(host.textContent).not.toContain('individual project review come with live programs')
})

it('uses Sign in to recover an unlisted course when the school hides its catalog', async () => {
  state.api.getCourseOfferings.mockResolvedValue({ data: { public_catalog_mode: 'hidden', offerings: [course] } })
  state.api.getCourseOffering.mockResolvedValue({ error: 'Not found', status: 404, data: null })
  await render()
  expect(host.querySelector('a[href="/sign-in"]')?.textContent).toBe('Sign in')
  expect(host.querySelector('a[href="/courses"]')).toBeNull()
  expect(host.textContent).not.toContain('Try again')
})

it('shows seats remaining and guided terms on a capped small-class course page', async () => {
  const guided = {
    ...course,
    course_delivery: 'guided' as const,
    unlisted: true,
    access_months: 12,
    instructor_message_weeks: 8,
    guided_access_ends_on: null,
    guided_support_ends_on: null,
    seat_limit: 15,
    seats_taken: 11,
    seats_remaining: 4,
    sold_out: false,
  }
  state.api.getCourseOffering.mockResolvedValue({ data: { offering: guided } })
  await render()
  expect(host.textContent).toContain('Small-class course')
  expect(host.textContent).toContain('4 of 15 seats remaining')
  expect(host.textContent).toContain('12 months of lesson access from your start')
  expect(host.textContent).toContain('Ask an instructor for help for 8 weeks from your start')
  expect(host.querySelector('a[href="/sign-up?offering_id=13&offering_slug=course-counter"]')).not.toBeNull()
  expect(host.querySelector('a[href="/courses"]')).toBeNull()
})

it('shows a disabled Cohort full state with support waitlist guidance when sold out', async () => {
  state.auth.isSignedIn = true
  state.auth.user = { id: 1 }
  state.api.getPendingCoursePurchases.mockResolvedValue({ data: { purchases: [] } })
  const full = {
    ...course,
    course_delivery: 'guided' as const,
    seat_limit: 10,
    seats_taken: 10,
    seats_remaining: 0,
    sold_out: true,
  }
  state.api.getCourseOffering.mockResolvedValue({ data: { offering: full } })
  await render()
  expect(host.textContent).toContain('Cohort full · 0 of 10 seats remaining')
  const btn = [...host.querySelectorAll('main button')].find(el => el.textContent?.includes('Cohort full')) as HTMLButtonElement
  expect(btn).toBeDefined()
  expect(btn.disabled).toBe(true)
  expect(host.querySelector('a[href^="mailto:"]')?.textContent).toBeTruthy()
  expect(host.textContent).not.toContain('Continue to secure checkout')
})
