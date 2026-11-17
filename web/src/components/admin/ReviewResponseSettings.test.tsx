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

it('stages response edits for the cohort save instead of exposing an independent save action', async () => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  const draft = vi.fn()
  api.getFeatureSettings.mockResolvedValue({ data: { review_response_time_override: null, review_response_time_default: 'usually reviewed within 2 days' } })
  await act(async () => root.render(<ReviewResponseSettings cohortId={13} onDraftChange={draft} />))
  const field = host.querySelector('input')!
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, 'usually reviewed within 3 days'); field.dispatchEvent(new Event('input', { bubbles: true })) })
  expect(draft).toHaveBeenLastCalledWith('usually reviewed within 3 days')
  expect(host.querySelector('button')).toBeNull()
  expect(api.saveFeatureSettings).not.toHaveBeenCalled()
})

it('acknowledges an accepted save without overwriting a later edit', async () => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  const draft = vi.fn()
  api.getFeatureSettings.mockResolvedValue({ data: { review_response_time_override: 'usually reviewed within 2 days' } })
  const render = (savedResponse?: { cohortId: number; value: string }) => act(async () => root.render(<ReviewResponseSettings cohortId={13} onDraftChange={draft} savedResponse={savedResponse} />))
  await render()
  const field = host.querySelector('input')!
  const edit = async (value: string) => act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })) })
  await edit('usually reviewed within 4 days')
  await render({ cohortId: 13, value: 'usually reviewed within 3 days' })
  expect(field.value).toBe('usually reviewed within 4 days')
  expect(draft).toHaveBeenLastCalledWith('usually reviewed within 4 days')
  await edit('usually reviewed within 2 days')
  expect(draft).toHaveBeenLastCalledWith('usually reviewed within 2 days')
})
