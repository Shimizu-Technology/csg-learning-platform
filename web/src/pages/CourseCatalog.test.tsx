// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CourseCatalog } from './CourseCatalog'

const state = vi.hoisted(() => ({ auth: { isSignedIn: false, user: null as unknown, enrollments: [], syncSession: vi.fn() }, getCourseOfferings: vi.fn(), getPendingCoursePurchases: vi.fn(), getCourseCheckoutStatus: vi.fn(), startCourseCheckout: vi.fn() }))
vi.mock('../contexts/AuthContext', () => ({ useAuthContext: () => state.auth }))
vi.mock('../lib/api', () => ({ api: state }))
let root: Root, container: HTMLDivElement
const offering = { id: 13, name: 'Python', curriculum_name: 'Foundations', checkout_available: true, price_cents: 14900, access_months: 12, instructor_message_weeks: 6, instructor_response_target: '2 Guam business days' }
beforeEach(() => {
  vi.clearAllMocks()
  state.auth.isSignedIn = false; state.auth.user = null
  state.getCourseOfferings.mockResolvedValue({ data: { offerings: [offering, { ...offering, id: 14, name: 'Ruby' }] } })
  state.getPendingCoursePurchases.mockResolvedValue({ data: { purchases: [] } })
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })
const render = async (url = '/courses') => act(async () => root.render(<MemoryRouter initialEntries={[url]}><CourseCatalog /></MemoryRouter>))
it('carries the selected server-listed offering into signup', async () => {
  await render('/courses?offering_id=13')
  expect(container.querySelector('a[href="/sign-up?offering_id=13"]')).not.toBeNull()
  expect(container.textContent).not.toContain('Ruby')
  expect(state.startCourseCheckout).not.toHaveBeenCalled()
})
it('validates a stale or forged course id against the server listing', async () => {
  await render('/courses?offering_id=999')
  expect(container.textContent).toContain('no longer listed')
  expect(container.querySelector('a[href="/sign-up?offering_id=999"]')).toBeNull()
})
it('returns a signed-in learner to the selected checkout step without starting a payment', async () => {
  state.auth.isSignedIn = true; state.auth.user = { id: 1 }
  await render('/courses?offering_id=13')
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
  expect(container.textContent).toContain('could not check your purchases')
  expect(container.textContent).not.toContain('Continue to secure checkout')
})
it('keeps canceled checkout at the selected course with calm recovery copy', async () => {
  await render('/courses?checkout=canceled&offering_id=13')
  expect(container.textContent).toContain('Checkout not completed')
  expect(container.textContent).not.toContain('Ruby')
})

it('shows continue checkout on signed-in cancel with an owned pending purchase', async () => {
  state.auth.isSignedIn = true; state.auth.user = { id: 1 }
  state.getPendingCoursePurchases.mockResolvedValue({ data: { purchases: [{ id: 20, cohort_id: 13 }] } })
  state.getCourseCheckoutStatus.mockResolvedValue({ data: { status: 'pending', can_continue: true, cohort: { id: 13, name: 'Python' } } })
  await render('/courses?checkout=canceled&offering_id=13')
  expect(container.textContent).toContain('Checkout not completed — Continue checkout')
  expect([...container.querySelectorAll('button')].some(el => el.textContent === 'Continue checkout')).toBe(true)
  expect(container.textContent).not.toContain('Confirming your enrollment')
  expect(state.startCourseCheckout).not.toHaveBeenCalled()
})
