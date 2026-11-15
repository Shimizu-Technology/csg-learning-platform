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
vi.mock('../../lib/api', () => ({ api: { searchEverything: vi.fn(async () => ({ error: null, data: { groups: [] } })) } }))
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

async function typeQuery(value: string) {
  const input = document.querySelector('input')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 300))
  })
}

it('keeps newer nonempty results when an older request finishes last', async () => {
  const { api } = await import('../../lib/api')
  type Response = Awaited<ReturnType<typeof api.searchEverything>>
  const pending = new Map<string, (value: Response) => void>()
  vi.mocked(api.searchEverything).mockImplementation(query => new Promise(resolve => { pending.set(query, resolve) }))
  mount(true, true)
  await typeQuery('older')
  await typeQuery('newer')
  const response = (title: string): Response => ({ error: null, data: { groups: [{ type: 'lesson', results: [{ id: '1', title, snippet: title, destination: { kind: 'lesson', id: '1', context: {}, anchor: {} } }] }] } })
  await act(async () => { pending.get('newer')!(response('Newer lesson')) })
  await act(async () => { pending.get('older')!(response('Older lesson')) })
  expect(document.body.textContent).toContain('Newer lesson')
  expect(document.body.textContent).not.toContain('Older lesson')
  vi.mocked(api.searchEverything).mockResolvedValue({ error: null, data: { groups: [] } })
})

it('revalidates Recent items independently and removes unavailable records', async () => {
  const { api } = await import('../../lib/api')
  localStorage.setItem('csg-search-recent:1', JSON.stringify([{ id: 'lesson-1', query: 'gone' }, { id: 'lesson-2', query: 'failed' }, { id: 'lesson-3', query: 'kept' }]))
  vi.mocked(api.searchEverything).mockImplementation(async query => {
    if (query === 'failed') throw new Error('offline')
    return { error: null, data: { groups: query === 'kept' ? [{ type: 'lesson', results: [{ id: '3', title: 'Kept recent', snippet: 'Still readable', destination: { kind: 'lesson', id: '3', context: {}, anchor: {} } }] }] : [] } }
  })
  mount(true, true)
  await act(async () => {})
  expect(document.body.textContent).toContain('Kept recent')
  expect(document.querySelectorAll('[href="/lessons/1"]').length).toBe(0)
  const input = document.querySelector('input')!
  act(() => { input.focus(); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })) })
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Close search')
  expect(document.querySelector('[aria-live]')?.textContent).toMatch(/\d+ results available/)
  vi.mocked(api.searchEverything).mockResolvedValue({ error: null, data: { groups: [] } })
})

it('announces partial results and clears the notice for the next query', async () => {
  const { api } = await import('../../lib/api')
  vi.mocked(api.searchEverything).mockResolvedValue({ error: null, data: { groups: [], partial: true } })
  mount(false, false)
  await typeQuery('slow')
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)) })
  expect(document.querySelector('[aria-live="polite"]')?.textContent).toContain('Some results took too long. Showing what we found.')
  vi.mocked(api.searchEverything).mockResolvedValue({ error: null, data: { groups: [] } })
  await typeQuery('next')
  expect(document.body.textContent).not.toContain('Some results took too long.')
})
