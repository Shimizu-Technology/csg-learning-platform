// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { CommandPalette, Highlight } from './CommandPalette'
import { renderToStaticMarkup } from 'react-dom/server'
import { shellNavigation } from '../../lib/shellNavigation'
const session = vi.hoisted(() => ({ user: { id: 1, is_admin: true, is_staff: true }, enrollments: [] }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => session }))
vi.mock('../../contexts/CohortContext', () => ({ useCohortContext: () => ({ selectedCohort: null, cohorts: [] }) }))
vi.mock('../../lib/api', () => ({ api: { searchEverything: vi.fn(async () => ({ data: { groups: [] } })) } }))
let cleanup = () => {}
afterEach(() => { cleanup(); localStorage.clear() })
function mount(staff: boolean, admin: boolean) {
  session.user.is_admin = admin; session.user.is_staff = staff
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); const close = vi.fn()
  act(() => root.render(<MemoryRouter><CommandPalette open isStaff={staff} onClose={close} /></MemoryRouter>))
  cleanup = () => { act(() => root.unmount()); host.remove() }
  return close
}
it.each([[true, true], [true, false], [false, false]])('generates every nav destination and authorized actions: staff=%s admin=%s', (staff, admin) => {
  mount(staff, admin)
  const links = [...document.querySelectorAll<HTMLAnchorElement>('[role=option]')]
  for (const item of Object.values(shellNavigation({ staff, admin, cohort: null })).flat()) expect(links.some(link => link.getAttribute('href') === item.to)).toBe(true)
  expect(links.some(link => link.textContent?.includes('New cohort'))).toBe(admin)
  expect(links.some(link => link.textContent?.includes('Post update'))).toBe(staff)
})
it('moves selection with arrows, opens with Enter, and closes with Escape', () => {
  const close = mount(true, true)
  const input = document.querySelector('input')!
  act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })) })
  expect(document.querySelector('[aria-selected=true]')?.textContent).toContain('Cohorts')
  act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
  expect(close).toHaveBeenCalledOnce()
  act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  expect(close).toHaveBeenCalledTimes(2)
})
it('highlights escaped text without rendering HTML', () => {
  const html = renderToStaticMarkup(<Highlight text={'<img src=x> Synthetic'} query="Synthetic" />)
  expect(html).toContain('&lt;img'); expect(html).toContain('Synthetic</mark>'); expect(html).not.toContain('<img')
})
