// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { FeatureSettings } from './FeatureSettings'
const api = vi.hoisted(() => ({ getFeatureSettings: vi.fn(), saveFeatureSettings: vi.fn() }))
vi.mock('../../lib/api', () => ({ api }))
let root: Root, container: HTMLDivElement
const data = { features: { recordings: true }, defaults: { recordings: true }, overrides: {}, public_catalog_mode: 'automatic' }
beforeEach(() => {
  api.getFeatureSettings.mockResolvedValue({ data }); api.saveFeatureSettings.mockResolvedValue({ data })
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks() })
it('saves school changes including public catalog preference', async () => {
  await act(async () => root.render(<FeatureSettings />))
  const select = container.querySelectorAll('select')[2]
  await act(async () => { select.value = 'off'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  await act(async () => container.querySelector('button')!.click())
  expect(api.saveFeatureSettings).toHaveBeenCalledWith({ features: { recordings: false }, public_catalog_mode: 'automatic' }, undefined)
  expect(container.textContent).toContain('Features saved')
})
it('shows inherited values and persists explicit cohort overrides', async () => {
  await act(async () => root.render(<FeatureSettings cohortId={12} />))
  expect(container.textContent).toContain('Inherit (On)')
  const select = container.querySelectorAll('select')[2]
  await act(async () => { select.value = 'off'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  await act(async () => container.querySelector('button')!.click())
  expect(api.saveFeatureSettings).toHaveBeenCalledWith({ features: { recordings: false } }, 12)
})
