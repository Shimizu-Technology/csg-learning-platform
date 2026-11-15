// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyUrlPatch, readUrlState, urlParsers, useUrlSearch, useUrlState } from './useUrlState'

describe('urlParsers', () => {
  it('oneOf falls back for unknown, empty and missing values and omits the default', () => {
    const parser = urlParsers.oneOf(['ready', 'redo', 'all'] as const, 'ready')
    expect(parser.parse('redo')).toBe('redo')
    expect(parser.parse('REDO')).toBe('ready')
    expect(parser.parse('<script>')).toBe('ready')
    expect(parser.parse('')).toBe('ready')
    expect(parser.parse(null)).toBe('ready')
    expect(parser.serialize('ready')).toBeNull()
    expect(parser.serialize('all')).toBe('all')
    expect(parser.serialize('nope' as never)).toBeNull()
  })

  it('id accepts only positive safe integers', () => {
    const parser = urlParsers.id()
    expect(parser.parse('42')).toBe(42)
    for (const raw of ['0', '-3', '1.5', '1e3', '42abc', ' 42', '99999999999999999', '', null]) expect(parser.parse(raw)).toBeNull()
    expect(parser.serialize(null)).toBeNull()
    expect(parser.serialize(7)).toBe('7')
    expect(parser.serialize(-1)).toBeNull()
  })

  it('int clamps out-of-range numbers and ignores junk', () => {
    const parser = urlParsers.int(1, 52, 1)
    expect(parser.parse('3')).toBe(3)
    expect(parser.parse('900')).toBe(52)
    expect(parser.parse('-4')).toBe(1)
    expect(parser.parse('two')).toBe(1)
    expect(parser.parse('9999999999')).toBe(1)
    expect(parser.serialize(1)).toBeNull()
    expect(parser.serialize(99)).toBe('52')
  })

  it('text caps length and leaves blank text out of the URL', () => {
    const parser = urlParsers.text(5)
    expect(parser.parse('abcdefgh')).toBe('abcde')
    expect(parser.parse(null)).toBe('')
    expect(parser.serialize('   ')).toBeNull()
    expect(parser.serialize('abcdefgh')).toBe('abcde')
  })

  it('ids deduplicates, sorts, drops junk and caps the count', () => {
    const parser = urlParsers.ids(3)
    expect(parser.parse('9,2,x,2,-1,0,5,7')).toEqual([2, 5, 9])
    expect(parser.parse('')).toEqual([])
    expect(parser.serialize([5, 1, 5])).toBe('1,5')
    expect(parser.serialize([])).toBeNull()
  })

  it('idMap keeps valid pairs, clamps values and omits defaults', () => {
    const parser = urlParsers.idMap(1, 10, 1)
    expect(parser.parse('12:3,15:99,x:2,4:,7:1,8:-2')).toEqual({ 12: 3, 15: 10, 7: 1 })
    expect(parser.serialize({ 15: 2, 12: 1, 3: 4 })).toBe('3:4,15:2')
    expect(parser.serialize({ 12: 1 })).toBeNull()
  })

  it('flag is on only for "1"', () => {
    const parser = urlParsers.flag()
    expect(parser.parse('1')).toBe(true)
    expect(parser.parse('true')).toBe(false)
    expect(parser.serialize(false)).toBeNull()
  })
})

const SCHEMA = { filter: urlParsers.oneOf(['ready', 'redo', 'all'] as const, 'ready'), module: urlParsers.id() }

describe('applyUrlPatch / readUrlState', () => {
  it('keeps keys it does not own and removes defaults', () => {
    expect(applyUrlPatch('?cohort_id=3&filter=redo&return_to=%2Fadmin', SCHEMA, { filter: 'ready', module: 8 })).toBe('?cohort_id=3&return_to=%2Fadmin&module=8')
    expect(applyUrlPatch('?filter=redo', SCHEMA, { filter: 'ready' })).toBe('')
    expect(readUrlState('?filter=bogus&module=-1', SCHEMA)).toEqual({ filter: 'ready', module: null })
  })
})

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

let api: { values: ReturnType<typeof readUrlState<typeof SCHEMA>>; set: ReturnType<typeof useUrlState<typeof SCHEMA>>[1]; search: string; state: unknown }
function Probe() {
  const [values, set] = useUrlState(SCHEMA)
  const location = useLocation()
  api = { values, set, search: location.search, state: location.state }
  return null
}

function renderAt(entry: string | { pathname: string; search: string; state?: unknown }) {
  const router = createMemoryRouter([{ path: '/learn', element: <Probe /> }, { path: '*', element: <p>Elsewhere</p> }], { initialEntries: ['/start', entry], initialIndex: 1 })
  act(() => root.render(<RouterProvider router={router} />))
  return router
}

describe('useUrlState', () => {
  it('reads typed values from the URL, falling back for invalid ones', () => {
    renderAt('/learn?filter=nonsense&module=abc&cohort_id=3')
    expect(api.values).toEqual({ filter: 'ready', module: null })
  })

  it('pushes by default so Back restores the previous state', async () => {
    const router = renderAt('/learn?cohort_id=3')
    await act(async () => api.set({ filter: 'redo' }))
    expect(api.search).toBe('?cohort_id=3&filter=redo')
    await act(async () => router.navigate(-1))
    expect(api.values.filter).toBe('ready')
    expect(api.search).toBe('?cohort_id=3')
  })

  it('replaces when asked, so Back skips over the change', async () => {
    const router = renderAt('/learn')
    await act(async () => api.set({ filter: 'redo' }, { history: 'replace' }))
    expect(api.values.filter).toBe('redo')
    await act(async () => router.navigate(-1))
    expect(container.textContent).toBe('Elsewhere')
  })

  it('combines several updates made in one event', async () => {
    renderAt('/learn')
    await act(async () => {
      api.set({ filter: 'all' })
      api.set({ module: 4 })
    })
    expect(api.values).toEqual({ filter: 'all', module: 4 })
  })

  it('keeps the record origin in router state across changes', async () => {
    renderAt({ pathname: '/learn', search: '', state: { returnTo: '/admin/students?q=al', returnLabel: 'Students', restoreList: true } })
    await act(async () => api.set({ filter: 'redo' }))
    expect(api.state).toEqual({ returnTo: '/admin/students?q=al', returnLabel: 'Students' })
  })

  it('does nothing when the value is unchanged', async () => {
    const router = renderAt('/learn?filter=redo')
    const before = router.state.historyAction
    await act(async () => api.set({ filter: 'redo' }))
    expect(router.state.historyAction).toBe(before)
  })
})

describe('useUrlSearch', () => {
  let search: { value: string; set: (value: string) => void; url: string }
  function SearchProbe() {
    const [value, set] = useUrlSearch('q', 20)
    const location = useLocation()
    search = { value, set, url: location.search }
    return null
  }

  it('mirrors typing into the URL with replace and follows Back', async () => {
    const router = createMemoryRouter([{ path: '/list', element: <SearchProbe /> }], { initialEntries: ['/list?q=old'] })
    act(() => root.render(<RouterProvider router={router} />))
    expect(search.value).toBe('old')
    await act(async () => {
      search.set('a')
      search.set('al')
      search.set('ale')
    })
    expect(search.value).toBe('ale')
    expect(search.url).toBe('?q=ale')
    // Typing replaced the entry; a later push and Back return to the typed search.
    await act(async () => router.navigate('/list?q=other'))
    expect(search.value).toBe('other')
    await act(async () => router.navigate(-1))
    expect(search.value).toBe('ale')
  })

  it('caps long input and clears the key when the box is emptied', async () => {
    const router = createMemoryRouter([{ path: '/list', element: <SearchProbe /> }], { initialEntries: ['/list?q=x'] })
    act(() => root.render(<RouterProvider router={router} />))
    await act(async () => search.set('x'.repeat(40)))
    expect(search.value).toHaveLength(20)
    await act(async () => search.set(''))
    expect(search.url).toBe('')
  })
})
