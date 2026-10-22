// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CohortManagement } from './CohortManagement'

const state = vi.hoisted(() => ({ createCohort: vi.fn(), getCohorts: vi.fn(), getCurricula: vi.fn(), admin: true, refresh: vi.fn() }))
vi.mock('../../lib/api', () => ({ api: state }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: { is_admin: state.admin } }) }))
vi.mock('../../contexts/CohortContext', () => ({ useCohortContext: () => ({ refreshCohorts: state.refresh }) }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root, container: HTMLDivElement
beforeEach(() => {
  vi.clearAllMocks(); state.admin = true
  state.getCohorts.mockResolvedValue({ data: { cohorts: [] } })
  state.getCurricula.mockResolvedValue({ data: { curricula: [{ id: 1, name: 'Python' }] } })
  state.createCohort.mockResolvedValue({ data: null, error: 'Test stops before navigation' })
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })
const render = () => act(async () => root.render(<MemoryRouter><CohortManagement /></MemoryRouter>))
const input = async (label: string, value: string) => act(async () => {
  const field = [...container.querySelectorAll('label')].find(el => el.textContent?.includes(label))!
  const element = document.getElementById(field.htmlFor) as HTMLInputElement | HTMLSelectElement
  Object.getOwnPropertyDescriptor(element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(element, value)
  element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
})
it('lets an admin create a self-paced cohort with checkout explicitly off', async () => {
  await render()
  await act(async () => [...container.querySelectorAll('button')].find(el => el.textContent?.includes('New cohort'))!.click())
  expect(container.textContent).toContain('Self-paced course')
  await input('Cohort name', 'New Python offering')
  await input('Curriculum', '1')
  await input('Start date', '2026-12-01')
  await input('Delivery', 'self_paced')
  expect(container.textContent).toContain('Checkout stays off')
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(state.createCohort).toHaveBeenCalledWith(expect.objectContaining({ name: 'New Python offering', course_delivery: 'self_paced', public_checkout_enabled: false }))
})
it('does not offer creation to an instructor', async () => {
  state.admin = false
  await render()
  expect(container.textContent).not.toContain('New cohort')
})
