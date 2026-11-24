// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CourseCatalog } from './CourseCatalog'

const state = vi.hoisted(() => ({ auth: { isSignedIn: false, user: null as unknown, enrollments: [], syncSession: vi.fn() }, acceptCommunityPolicy: vi.fn(), getCourseOffering: vi.fn(), getCourseOfferings: vi.fn(), getPendingCoursePurchases: vi.fn(), getCourseCheckoutStatus: vi.fn(), startCourseCheckout: vi.fn() }))
vi.mock('../contexts/AuthContext', () => ({ useAuthContext: () => state.auth }))
vi.mock('../lib/api', () => ({ api: state }))
let root: Root, container: HTMLDivElement
const offering = { id: 13, name: 'Python', slug: 'course-python', lesson_count: 1, syllabus: [{ title: 'Section', lessons: ['Public lesson'] }], curriculum_name: 'Foundations', checkout_available: true, price_cents: 14900, access_months: 12, instructor_message_weeks: 6, instructor_response_target: '2 Guam business days' }
beforeEach(() => {
  vi.clearAllMocks()
  state.auth.isSignedIn = false; state.auth.user = null
  state.getCourseOfferings.mockResolvedValue({ data: { offerings: [offering, { ...offering, id: 14, name: 'Ruby' }] } })
  state.getPendingCoursePurchases.mockResolvedValue({ data: { purchases: [] } })
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })
const render = async (url = '/courses') => act(async () => root.render(<MemoryRouter initialEntries={[url]}><CourseCatalog /></MemoryRouter>))
it('carries the selected server-listed offering into signup and sign-in with slug preserved', async () => {
  await render('/courses?offering_id=13')
  expect(container.querySelector('a[href="/sign-up?offering_id=13&offering_slug=course-python"]')).not.toBeNull()
  expect(container.querySelector('main a[href="/sign-in?offering_id=13&offering_slug=course-python"]')?.textContent).toContain('Sign in')
  expect(container.textContent).not.toContain('Ruby')
  expect(state.startCourseCheckout).not.toHaveBeenCalled()
})
it('lets a learner leave a query-selected course and browse every offering', async () => {
  await render('/courses?offering_id=13')
  expect(container.textContent).not.toContain('Ruby')
  const allCourses = Array.from(container.querySelectorAll('a')).find(link => link.textContent === 'Back to courses')
  expect(allCourses?.getAttribute('href')).toBe('/courses')
  await act(async () => allCourses!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })))
  expect(container.textContent).toContain('Python')
  expect(container.textContent).toContain('Ruby')
  expect(state.startCourseCheckout).not.toHaveBeenCalled()
})
it('validates a stale or forged course id against the server listing', async () => {
  await render('/courses?offering_id=999')
  expect(container.textContent).toContain('not currently listed')
  expect(container.querySelector('a[href="/sign-up?offering_id=999"]')).toBeNull()
})
it('returns a signed-in learner to the selected checkout step without starting a payment', async () => {
  state.auth.isSignedIn = true; state.auth.user = { id: 1 }
  await render('/courses?offering_id=13')
  expect(state.getPendingCoursePurchases).toHaveBeenCalledTimes(1)
  expect(container.textContent).not.toContain('Staff preview')
  expect(container.textContent).toContain('Continue to secure checkout')
  expect(state.startCourseCheckout).not.toHaveBeenCalled()
})
it('blocks another payment while a purchase is pending', async () => {
  state.auth.isSignedIn = true; state.auth.user = { id: 1 }
  state.getPendingCoursePurchases.mockResolvedValue({ data: { purchases: [{ id: 20, cohort_id: 13 }] } })
  await render('/courses?offering_id=13')
  expect(container.textContent).toContain('Check enrollment confirmation')
  expect(container.textContent).not.toContain('Continue to secure checkout')
})
it('fails closed when purchase status cannot be checked', async () => {
  state.auth.isSignedIn = true; state.auth.user = { id: 1 }
  state.getPendingCoursePurchases.mockResolvedValue({ data: null, error: 'Offline' })
  await render('/courses?offering_id=13')
  expect(container.textContent).toContain('couldn’t check your purchases')
  expect(container.textContent).not.toContain('Continue to secure checkout')
})
it('keeps canceled checkout at the selected course with honest recovery copy', async () => {
  await render('/courses?checkout=canceled&offering_id=13')
  expect(container.textContent).toContain('Checkout wasn’t completed')
  expect(container.textContent).not.toContain('haven’t been charged')
  expect(container.textContent).not.toContain('Ruby')
})

it('shows the community standards gate before starting checkout when terms are unaccepted', async () => {
  state.auth.isSignedIn = true
  state.auth.user = { id: 1, email: 'buyer@example.com', community_policy: { version: '2026-08-17', accepted: false } }
  state.auth.syncSession.mockResolvedValue(true)
  state.acceptCommunityPolicy.mockResolvedValue({ data: { accepted: true } })
  state.startCourseCheckout.mockResolvedValue({ data: null, error: 'Checkout unavailable' })
  await render('/courses?offering_id=13')

  const checkoutBtn = [...container.querySelectorAll('button')].find(el => el.textContent?.includes('Continue to secure checkout'))!
  await act(async () => checkoutBtn.click())
  expect(state.startCourseCheckout).not.toHaveBeenCalled()
  expect(container.textContent).toContain('Before class: our community guidelines')

  const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement
  await act(async () => checkbox.click())
  const agreeBtn = [...container.querySelectorAll('button')].find(el => el.textContent === 'Agree and continue')!
  await act(async () => agreeBtn.click())
  expect(state.acceptCommunityPolicy).toHaveBeenCalledWith('2026-08-17')
  expect(state.auth.syncSession).toHaveBeenCalledOnce()
  expect(state.startCourseCheckout).toHaveBeenCalledWith(13)
})

it('shows continue checkout on signed-in cancel with an owned pending purchase', async () => {
  state.auth.isSignedIn = true; state.auth.user = { id: 1 }
  state.getPendingCoursePurchases.mockResolvedValue({ data: { purchases: [{ id: 20, cohort_id: 13 }] } })
  state.getCourseCheckoutStatus.mockResolvedValue({ data: { status: 'pending', can_continue: true, cohort: { id: 13, name: 'Python' } } })
  await render('/courses?checkout=canceled&offering_id=13')
  expect(container.textContent).toContain('Checkout wasn’t finished')
  expect([...container.querySelectorAll('button')].some(el => el.textContent === 'Continue checkout')).toBe(true)
  expect(container.textContent).not.toContain('Confirming your enrollment')
  expect(state.startCourseCheckout).not.toHaveBeenCalled()
})

it('keeps the catalog reachable with an empty state linking to the school interest form', async () => {
  state.getCourseOfferings.mockResolvedValue({ data: { offerings: [] } })
  await render()
  expect(container.textContent).toContain('Courses are being prepared')
  expect(container.querySelector('a[href="https://codeschoolofguam.com/courses"]')?.textContent).toContain('Explore courses')
})

it.each(['admin', 'instructor'])('shows %s a staff preview without requesting student purchases', async (role) => {
  state.auth.isSignedIn = true; state.auth.user = { id: 1, role, is_staff: true }
  state.getPendingCoursePurchases.mockResolvedValue({ data: null, error: 'Forbidden' })
  await render()
  expect(state.getPendingCoursePurchases).not.toHaveBeenCalled()
  const cards = [...container.querySelectorAll('article')]
  expect(cards).toHaveLength(2)
  for (const card of cards) {
    expect(card.textContent).toContain('Staff preview — students see the enrollment button here.')
    expect(card.textContent).toContain('$149.00')
    expect(card.textContent).toContain('12 months of lesson access')
    expect(card.textContent).not.toContain('could not check your purchases')
    expect(card.textContent).not.toContain('Checking your purchases')
    expect(card.querySelector('button')).toBeNull()
    expect(card.querySelector('a')?.textContent).toBe('View course')
  }
  expect(state.startCourseCheckout).not.toHaveBeenCalled()
})

it.each([true, false])('waits for the user role before checking purchases (staff: %s)', async (isStaff) => {
  state.auth.isSignedIn = true
  await render()
  expect(state.getPendingCoursePurchases).not.toHaveBeenCalled()
  state.auth.user = { id: 1, is_staff: isStaff }
  await render()
  expect(state.getPendingCoursePurchases).toHaveBeenCalledTimes(isStaff ? 0 : 1)
  expect(container.textContent).toContain(isStaff ? 'Staff preview' : 'Continue to secure checkout')
})

it('shows public description and image without the internal curriculum label', async () => {
  state.getCourseOfferings.mockResolvedValue({ data: { offerings: [{ ...offering, description: 'Build a synthetic project', image_url: 'https://example.test/course.png', curriculum_name: 'Internal draft label' }] } })
  await render()
  expect(container.textContent).toContain('Build a synthetic project')
  expect(container.textContent).not.toContain('Internal draft label')
  expect(container.querySelector('article img')?.getAttribute('src')).toBe('https://example.test/course.png')
})
