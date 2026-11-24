// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DirectMessagePicker } from './DirectMessagePicker'
import { useMessageSearch } from './useMessageSearch'
import { useDirectRecipients } from './useDirectRecipients'

const searchMessages = vi.hoisted(() => vi.fn())
const getAvailableDirectUsers = vi.hoisted(() => vi.fn())
vi.mock('../../../lib/api', () => ({ api: { searchMessages, getAvailableDirectUsers } }))
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

it('never leaves earlier hits clickable while an edited query waits for its own search', async () => {
  vi.useFakeTimers()
  searchMessages.mockResolvedValueOnce({ data: { results: [{ id: 1 }, { id: 2 }] } }).mockResolvedValueOnce({ data: { results: [{ id: 3 }] } })
  await act(async () => root.render(<SearchProbe />))
  const input = container.querySelector<HTMLInputElement>('input')!
  await type(input, 'loops')
  await act(async () => { vi.advanceTimersByTime(300) })
  expect(container.querySelector('output')!.textContent).toBe('done:2')
  await type(input, 'loopsy')
  expect(container.querySelector('output')!.textContent).toBe('loading:0')
  await type(input, 'l')
  expect(container.querySelector('output')!.textContent).toBe('idle:0')
  await type(input, 'loops')
  expect(container.querySelector('output')!.textContent).toBe('done:2')
  await type(input, 'arrays')
  await act(async () => { vi.advanceTimersByTime(300) })
  expect(container.querySelector('output')!.textContent).toBe('done:1')
})

function RecipientsProbe({ workspaceId, pick }: { workspaceId: number | null; pick?: number[] }) {
  const recipients = useDirectRecipients(workspaceId)
  return <div>
    <output>{recipients.status}:{recipients.users.map((user) => user.id).join(',')}:{recipients.selectedIds.join(',')}</output>
    <button type="button" data-pick="" onClick={() => recipients.setSelectedIds(pick ?? [])} />
    <button type="button" data-retry="" onClick={recipients.retry} />
  </div>
}

it('keeps New DM recipients and picks to the current workspace and shows a retryable error', async () => {
  let finishFirst!: (value: unknown) => void
  getAvailableDirectUsers.mockReset()
    .mockReturnValueOnce(new Promise((resolve) => { finishFirst = resolve }))
    .mockResolvedValueOnce({ data: { users: [people[2]] } })
    .mockResolvedValueOnce({ data: null, error: 'Offline' })
    .mockResolvedValueOnce({ data: { users: [people[0], people[1]] } })
  const output = () => container.querySelector('output')!.textContent
  await act(async () => root.render(<RecipientsProbe workspaceId={1} pick={[1]} />))
  expect(output()).toBe('loading::')
  await act(async () => root.render(<RecipientsProbe workspaceId={2} pick={[3]} />))
  expect(output()).toBe('ready:3:')
  await act(async () => container.querySelector<HTMLButtonElement>('[data-pick]')!.click())
  expect(output()).toBe('ready:3:3')
  // Workspace 1 answers late: dropped, never shown over workspace 2.
  await act(async () => finishFirst({ data: { users: [people[0]] } }))
  expect(output()).toBe('ready:3:3')
  // Back to workspace 1: its load fails, and workspace 2's pick is not carried over.
  await act(async () => root.render(<RecipientsProbe workspaceId={1} pick={[1]} />))
  expect(output()).toBe('error::')
  await act(async () => container.querySelector<HTMLButtonElement>('[data-retry]')!.click())
  expect(output()).toBe('ready:1,2:')
})
