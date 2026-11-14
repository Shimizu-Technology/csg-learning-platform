// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
const auth = vi.hoisted(() => ({ isSignedIn: true, isLoading: false }))
vi.mock('./contexts/AuthContext', () => ({ useAuthContext: () => auth }))
vi.mock('./pages/Home', () => ({ HomePage: () => <p>Marketing landing</p> }))
import { HomeRoute } from './App'
it('takes a signed-in root visit to Today', async () => {
  const node = document.createElement('div')
  const root = createRoot(node)
  await act(async () => root.render(<MemoryRouter initialEntries={['/']}><Routes><Route path="/" element={<HomeRoute />} /><Route path="/dashboard" element={<p>Today destination</p>} /></Routes></MemoryRouter>))
  expect(node.textContent).toContain('Today destination')
  await act(async () => root.unmount())
})

it.each([true, false])('renders marketing immediately with loading=%s for a signed-out visitor', async (isLoading) => {
  auth.isSignedIn = false
  auth.isLoading = isLoading
  const node = document.createElement('div')
  const root = createRoot(node)
  await act(async () => root.render(<MemoryRouter><HomeRoute /></MemoryRouter>))
  expect(node.textContent).toContain('Marketing landing')
  await act(async () => root.unmount())
})
