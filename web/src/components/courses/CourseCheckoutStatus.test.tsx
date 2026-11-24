// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CourseCheckoutStatus } from './CourseCheckoutStatus'
const state = vi.hoisted(() => ({ isSignedIn: true, getCourseCheckoutStatus: vi.fn(), startCourseCheckout: vi.fn(), syncSession: vi.fn() }))
vi.mock('../../lib/api', () => ({ api: state }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ isSignedIn: state.isSignedIn, syncSession: state.syncSession }) }))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root, container: HTMLDivElement
const response = (status: string) => ({ data: { status, purchase_id: 20, cohort: { id: 13, name: 'Python' }, enrollment_id: status === 'fulfilled' ? 2 : null } })
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks()
  state.isSignedIn = true
  state.getCourseCheckoutStatus.mockResolvedValue(response('pending'))
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers() })
const render = async () => act(async () => root.render(<MemoryRouter><CourseCheckoutStatus purchaseId="20" /></MemoryRouter>))
it('polls pending until fulfilled, then stops and offers the exact course', async () => {
  await render()
  expect(container.textContent).toContain('Confirming your enrollment…')
  expect(container.textContent).toContain('before making another payment')
  state.getCourseCheckoutStatus.mockResolvedValue(response('fulfilled'))
  await act(async () => vi.advanceTimersByTimeAsync(2000))
  expect(container.textContent).toContain('You’re in')
  expect(container.querySelector('a[href="/dashboard?cohort_id=13"]')?.textContent).toBe('Open Python')
  expect(state.syncSession).toHaveBeenCalledOnce()
  await act(async () => vi.advanceTimersByTimeAsync(120000))
  expect(state.getCourseCheckoutStatus).toHaveBeenCalledTimes(2)
})
it('bounds pending polling at one minute and retries without offering checkout', async () => {
  await render()
  await act(async () => vi.advanceTimersByTimeAsync(60000))
  expect(container.textContent).toContain('Still confirming — this can take a minute')
  const calls = state.getCourseCheckoutStatus.mock.calls.length
  await act(async () => vi.advanceTimersByTimeAsync(60000))
  expect(state.getCourseCheckoutStatus).toHaveBeenCalledTimes(calls)
  expect(container.textContent).toContain('Contact support')
  state.getCourseCheckoutStatus.mockResolvedValue(response('fulfilled'))
  await act(async () => container.querySelector('button')!.click())
  expect(container.textContent).toContain('Open Python')
})
it.each(['failed', 'refunded'])('shows a recoverable %s state and stops polling', async (status) => {
  state.getCourseCheckoutStatus.mockResolvedValue(response(status))
  await render()
  expect(container.textContent).toContain(status === 'refunded' ? 'refunded' : 'couldn’t confirm')
  expect(container.textContent).toContain('Contact support')
  expect(container.textContent).toContain('Reference #20')
  expect(container.querySelector('a[href^="mailto:"]')?.getAttribute('href')).toContain('reference%20%2320')
  await act(async () => vi.advanceTimersByTimeAsync(10000))
  expect(state.getCourseCheckoutStatus).toHaveBeenCalledOnce()
})
it('treats errors as uncertain rather than successful or another payment opportunity', async () => {
  state.getCourseCheckoutStatus.mockResolvedValue({ data: null, error: 'Not found' })
  await render()
  await act(async () => vi.advanceTimersByTimeAsync(60000))
  expect(container.textContent).toContain('Still confirming')
  expect(container.textContent).not.toContain('You’re in')
  expect(container.querySelector('a[href*="checkout.stripe"]')).toBeNull()
})
it('stops updates and polling on unmount', async () => {
  await render()
  await act(async () => root.render(null))
  await act(async () => vi.advanceTimersByTimeAsync(60000))
  expect(state.getCourseCheckoutStatus).toHaveBeenCalledOnce()
})

it('shows a setup failure with a course retry destination and stops polling', async () => {
  state.getCourseCheckoutStatus.mockResolvedValue(response('setup_failed'))
  await render()
  expect(container.textContent).toContain('We couldn’t start checkout')
  expect(container.querySelector('a[href="/courses?offering_id=13"]')?.textContent).toBe('Try checkout again')
  await act(async () => vi.advanceTimersByTimeAsync(120000))
  expect(state.getCourseCheckoutStatus).toHaveBeenCalledOnce()
})

it('does not poll a session-less uncertain creation or invite a fresh payment', async () => {
  state.getCourseCheckoutStatus.mockResolvedValue({ data: { ...response('starting').data, can_resume: false } })
  await render()
  expect(container.textContent).toContain('Checking your checkout')
  expect(container.textContent).toContain('Contact support')
  await act(async () => vi.advanceTimersByTimeAsync(120000))
  expect(state.getCourseCheckoutStatus).toHaveBeenCalledOnce()
  expect(container.querySelector('a[href="/courses?offering_id=13"]')).toBeNull()
})


it('resumes a session-less attempt explicitly and retains uncertainty on a lost response', async () => {
  state.getCourseCheckoutStatus.mockResolvedValue({ data: { ...response('starting').data, can_resume: true } })
  state.startCourseCheckout.mockResolvedValue({ data: null, error: 'Status check needed' })
  await render()
  const resume = [...container.querySelectorAll('button')].find(el => el.textContent === 'Resume checkout')!
  expect(resume).toBeDefined()
  await act(async () => resume.click())
  expect(state.startCourseCheckout).toHaveBeenCalledWith(13)
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Status check needed')
  expect(container.querySelector('a[href="/courses?offering_id=13"]')).toBeNull()
})

it('offers server-authorized continuation after cancel without confirmation polling', async () => {
  state.getCourseCheckoutStatus.mockResolvedValue({ data: { ...response('pending').data, can_continue: true } })
  state.startCourseCheckout.mockResolvedValue({ error: 'Connection lost. Try continuing again.' })
  await act(async () => root.render(<MemoryRouter><CourseCheckoutStatus purchaseId="20" canceled /></MemoryRouter>))
  expect(container.textContent).toContain('Checkout wasn’t finished')
  expect(container.textContent).toContain('You haven’t been charged yet')
  const button = [...container.querySelectorAll('button')].find(el => el.textContent === 'Continue checkout')!
  await act(async () => button.click())
  expect(state.startCourseCheckout).toHaveBeenCalledWith(13)
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Connection lost')
  await act(async () => vi.advanceTimersByTimeAsync(120000))
  expect(state.getCourseCheckoutStatus).toHaveBeenCalledOnce()
})

it('allows continuation of an expired session using the server renewal path', async () => {
  state.getCourseCheckoutStatus.mockResolvedValue({ data: { ...response('failed').data, can_continue: true } })
  state.startCourseCheckout.mockResolvedValue({ error: 'Temporarily unavailable' })
  await render()
  const button = [...container.querySelectorAll('button')].find(el => el.textContent === 'Continue checkout')!
  await act(async () => button.click())
  expect(state.startCourseCheckout).toHaveBeenCalledWith(13)
})

it('prompts signed-out visitors to sign in instead of pretending to poll, preserving validated offering_slug', async () => {
  state.isSignedIn = false
  await act(async () => root.render(<MemoryRouter><CourseCheckoutStatus purchaseId="20" slug="python-pilot" /></MemoryRouter>))
  expect(container.textContent).toContain('Sign in to confirm your enrollment')
  expect(container.textContent).not.toContain('Confirming your enrollment…')
  const link = container.querySelector('a[href^="/sign-in"]')!
  expect(link.getAttribute('href')).toBe('/sign-in?checkout=return&purchase_id=20&offering_slug=python-pilot')

  await act(async () => root.render(<MemoryRouter><CourseCheckoutStatus purchaseId="20" slug="../evil" /></MemoryRouter>))
  const sanitizedLink = container.querySelector('a[href^="/sign-in"]')!
  expect(sanitizedLink.getAttribute('href')).toBe('/sign-in?checkout=return&purchase_id=20')
})
