// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { CourseCatalog } from './CourseCatalog'
const state = vi.hoisted(() => ({ api: { getCourseOffering: vi.fn(), getCourseOfferings: vi.fn(), getPendingCoursePurchases: vi.fn() }, auth: { isSignedIn: false, user: null as unknown, enrollments: [] as unknown[] } }))
vi.mock('../lib/api', () => ({ api: state.api }))
vi.mock('../contexts/AuthContext', () => ({ useAuthContext: () => state.auth }))
let host: HTMLDivElement, root: ReturnType<typeof createRoot>
afterEach(() => { act(() => root.unmount()); host.remove(); vi.clearAllMocks(); state.auth.isSignedIn = false; state.auth.user = null; state.auth.enrollments = [] })
const course = { id: 13, slug: 'course-counter', name: 'Build a counter', description: 'Learn programming', outcomes: 'Explain your code', prerequisites: 'A browser', duration: '4 hours', preview: 'Try a counter', lesson_count: 2, syllabus: [{ title: 'Section', lessons: ['First steps', 'A project'] }], checkout_available: true, price_cents: 14900, access_months: 12, instructor_message_weeks: 6, instructor_response_target: 'usually reviewed within 2 days' }
async function render() {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(<MemoryRouter initialEntries={['/courses/course-counter']}><Routes><Route path="/courses/:slug" element={<CourseCatalog />} /></Routes></MemoryRouter>))
}
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
  expect(host.textContent).toContain('This course is not currently listed')
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
