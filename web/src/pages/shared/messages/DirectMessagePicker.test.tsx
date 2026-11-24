// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DirectMessagePicker } from './DirectMessagePicker'
import { useMessageSearch } from './useMessageSearch'

const searchMessages = vi.hoisted(() => vi.fn())
vi.mock('../../../lib/api', () => ({ api: { searchMessages } }))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const people = [
  { id: 1, full_name: 'Ana Cruz', role: 'student', avatar_url: null, cohort_name: 'Cohort 7' },
  { id: 2, full_name: 'Ben Santos', role: 'student', avatar_url: null, cohort_name: 'Cohort 7' },
  { id: 3, full_name: 'Ina Teacher', role: 'instructor', avatar_url: null },
]
let root: Root
let container: HTMLDivElement
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers() })
const type = async (input: HTMLInputElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
})

function Picker({ onIds }: { onIds: (ids: number[]) => void }) {
  const [ids, setIds] = useState<number[]>([])
  return <DirectMessagePicker people={people} workspace="Python" selectedIds={ids} onChange={(next) => { setIds(next); onIds(next) }} />
}

it('filters people by name or role and picks several for a group message', async () => {
  const onIds = vi.fn()
  await act(async () => root.render(<Picker onIds={onIds} />))
  const search = container.querySelector<HTMLInputElement>('input[type="search"]')!
  await type(search, 'instructor')
  expect([...container.querySelectorAll('li label')].map((row) => row.textContent)).toEqual(['Ina Teacherinstructor · Python'])
  await act(async () => container.querySelector<HTMLInputElement>('li input[type="checkbox"]')!.click())
  await type(search, 'ben')
  await act(async () => container.querySelector<HTMLInputElement>('li input[type="checkbox"]')!.click())
  expect(onIds).toHaveBeenLastCalledWith([3, 2])
  // Picked people stay visible as removable chips while the list is filtered.
  expect(container.querySelector('[aria-label="Remove Ina Teacher"]')).not.toBeNull()
  await type(search, 'nobody here')
  expect(container.textContent).toContain('No one matches “nobody here”.')
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Remove Ina Teacher"]')!.click())
  expect(onIds).toHaveBeenLastCalledWith([2])
})

function SearchProbe() {
  const search = useMessageSearch()
  return <div><input aria-label="q" value={search.searchQuery} onChange={(event) => search.setSearchQuery(event.target.value)} /><output>{search.searchStatus}:{search.searchResults.length}</output></div>
}

it('reports loading, then empty or failed search results instead of staying blank', async () => {
  vi.useFakeTimers()
  let finish!: (value: unknown) => void
  searchMessages.mockReturnValueOnce(new Promise((resolve) => { finish = resolve })).mockResolvedValueOnce({ data: null, error: 'Offline' })
  await act(async () => root.render(<SearchProbe />))
  const input = container.querySelector<HTMLInputElement>('input')!
  await type(input, 'loops')
  expect(container.querySelector('output')!.textContent).toBe('loading:0')
  await act(async () => { vi.advanceTimersByTime(300) })
  await act(async () => finish({ data: { results: [] } }))
  expect(container.querySelector('output')!.textContent).toBe('done:0')
  await type(input, 'arrays')
  await act(async () => { vi.advanceTimersByTime(300) })
  expect(container.querySelector('output')!.textContent).toBe('error:0')
})
