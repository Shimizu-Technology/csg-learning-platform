// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { ReviewResponseSettings } from './ReviewResponseSettings'
const api = vi.hoisted(() => ({ getFeatureSettings: vi.fn(), saveFeatureSettings: vi.fn() }))
vi.mock('../../lib/api', () => ({ api }))
let host: HTMLDivElement, root: ReturnType<typeof createRoot>
afterEach(() => { act(() => root.unmount()); host.remove(); vi.clearAllMocks() })
it.each([undefined, 13])('edits defaults or resets inheritance without writing other settings (%s)', async cohortId => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  api.getFeatureSettings.mockResolvedValue({ data: { review_response_time: 'usually reviewed within 2 days', review_response_time_override: null, review_response_time_default: 'usually reviewed within 2 days' } }); api.saveFeatureSettings.mockResolvedValue({ data: {} })
  await act(async () => root.render(<ReviewResponseSettings cohortId={cohortId} />))
  const input = host.querySelector('input')!
  expect(input.value).toBe(cohortId ? '' : 'usually reviewed within 2 days')
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'usually reviewed within 4 days'); input.dispatchEvent(new Event('input', { bubbles: true })) })
  await act(async () => host.querySelector('button')!.click())
  expect(api.saveFeatureSettings).toHaveBeenCalledWith({ review_response_time: 'usually reviewed within 4 days' }, cohortId)
  if (cohortId) {
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, ''); input.dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => host.querySelector('button')!.click())
    expect(api.saveFeatureSettings).toHaveBeenLastCalledWith({ review_response_time: null }, cohortId)
  }
})
