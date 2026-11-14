// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
vi.mock('./contexts/AuthContext', () => ({ useAuthContext: () => ({ isSignedIn: true, isLoading: false }) }))
import { HomeRoute } from './App'
it('takes a signed-in root visit to Today', async () => {
  const node = document.createElement('div')
  const root = createRoot(node)
  await act(async () => root.render(<MemoryRouter initialEntries={['/']}><Routes><Route path="/" element={<HomeRoute />} /><Route path="/dashboard" element={<p>Today destination</p>} /></Routes></MemoryRouter>))
  expect(node.textContent).toContain('Today destination')
  await act(async () => root.unmount())
})
