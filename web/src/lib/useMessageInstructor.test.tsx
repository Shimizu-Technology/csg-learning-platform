// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

/* W8 PR 8.2: a pending "Ask about this feedback" belongs to the user and cohort it was asked in. */
const state = vi.hoisted(() => ({ user: { id: 5, full_name: 'Alex Rivera', is_staff: false } as { id: number; full_name: string; is_staff: boolean } }))
vi.mock('../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: state.user }) }))
vi.mock('./api', () => ({ api: { createDirectConversation: vi.fn() } }))

import { api } from './api'
import { useMessageInstructor } from './useMessageInstructor'

function Ask({ cohortId }: { cohortId: number }) {
  const { open, opening } = useMessageInstructor(cohortId)
  return <button type="button" onClick={() => void open(2, { label: 'Feedback on Loops', path: '/lessons/1#block-2' })}>{opening ? 'Opening' : 'Ask'}</button>
}
function Where() { const location = useLocation(); return <p data-where="">{location.pathname}</p> }

let root: Root
let container: HTMLDivElement
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); container = document.createElement('div'); document.body.append(container); root = createRoot(container) })
afterEach(() => { act(() => root.unmount()); container.remove() })
const tree = (cohortId: number) => <MemoryRouter initialEntries={['/my-work']}><Routes><Route path="/my-work" element={<Ask cohortId={cohortId} />} /><Route path="*" element={<Where />} /></Routes></MemoryRouter>

it('a result for the old cohort neither writes a draft nor navigates, and Opening resets for the new cohort', async () => {
  let settle!: (value: unknown) => void
  vi.mocked(api.createDirectConversation).mockReturnValueOnce(new Promise((resolve) => { settle = resolve }) as never)
  await act(async () => { root.render(tree(9)) })
  await act(async () => { container.querySelector('button')!.click() })
  expect(container.querySelector('button')?.textContent).toBe('Opening')
  await act(async () => { root.render(tree(10)) })
  expect(container.querySelector('button')?.textContent).toBe('Ask')
  await act(async () => { settle({ data: { direct_conversation: { id: 44, cohort_id: 9 } }, error: null }) })
  expect(container.querySelector('[data-where]')).toBeNull()
  expect(Object.keys(localStorage)).toEqual([])
  expect(container.querySelector('button')?.textContent).toBe('Ask')
})

it('a result for the old user is dropped too', async () => {
  let settle!: (value: unknown) => void
  vi.mocked(api.createDirectConversation).mockReturnValueOnce(new Promise((resolve) => { settle = resolve }) as never)
  await act(async () => { root.render(tree(9)) })
  await act(async () => { container.querySelector('button')!.click() })
  state.user = { id: 6, full_name: 'Blair Cruz', is_staff: false }
  await act(async () => { root.render(tree(9)) })
  await act(async () => { settle({ data: { direct_conversation: { id: 45, cohort_id: 9 } }, error: null }) })
  expect(container.querySelector('[data-where]')).toBeNull()
  expect(Object.keys(localStorage)).toEqual([])
  state.user = { id: 5, full_name: 'Alex Rivera', is_staff: false }
})

it('a result for the current context opens the conversation', async () => {
  vi.mocked(api.createDirectConversation).mockResolvedValueOnce({ data: { direct_conversation: { id: 46, cohort_id: 9 } }, error: null } as never)
  await act(async () => { root.render(tree(9)) })
  await act(async () => { container.querySelector('button')!.click() })
  expect(container.querySelector('[data-where]')?.textContent).toBe('/messages/dm/46')
})
