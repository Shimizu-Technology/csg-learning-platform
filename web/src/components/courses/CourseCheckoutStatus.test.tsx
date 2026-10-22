// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CourseCheckoutStatus } from './CourseCheckoutStatus'
const state = vi.hoisted(() => ({ getCourseCheckoutStatus: vi.fn(), syncSession: vi.fn() }))
vi.mock('../../lib/api', () => ({ api: state }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ isSignedIn: true, syncSession: state.syncSession }) }))
let root: Root, container: HTMLDivElement
const response = (status: string) => ({ data: { status, purchase_id: 20, cohort: { id: 13, name: 'Python' }, enrollment_id: status === 'fulfilled' ? 2 : null } })
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks()
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
  expect(container.querySelector('a[href="/materials?cohort_id=13"]')?.textContent).toBe('Open Python')
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
  expect(container.textContent).toContain(status === 'refunded' ? 'refunded' : 'could not confirm')
  expect(container.textContent).toContain('Contact support')
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
