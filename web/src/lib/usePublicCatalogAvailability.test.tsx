// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { usePublicCatalogAvailability } from './usePublicCatalogAvailability'
const api = vi.hoisted(() => ({ getCourseOfferings: vi.fn() }))
vi.mock('./api', () => ({ api }))
function Probe() { return <span>{String(usePublicCatalogAvailability())}</span> }
it.each([['automatic', false, false], ['automatic', true, true], ['always', false, true], ['hidden', true, false]])('catalog %s with checkout %s becomes %s', async (mode, checkout, expected) => {
  api.getCourseOfferings.mockResolvedValue({ data: { public_catalog_mode: mode, offerings: [{ checkout_available: checkout }] } })
  const container = document.createElement('div'); const root = createRoot(container)
  await act(async () => root.render(<Probe />))
  expect(container.textContent).toBe(String(expected))
  act(() => root.unmount())
})
