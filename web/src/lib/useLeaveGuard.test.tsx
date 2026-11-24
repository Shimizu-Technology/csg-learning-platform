// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createMemoryRouter, Link, Outlet, RouterProvider } from 'react-router-dom'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { LeaveGuardProvider, leavesPathOrParam, useGuardedLinkClick, useLeaveGuard } from './useLeaveGuard'

beforeAll(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

type Answers = boolean[]
/** A confirm that answers from a queue, one answer per question. */
function answering(...answers: Answers) {
  return vi.fn(async () => answers.shift() ?? false)
}

interface EditorProps {
  name: string
  confirm: () => Promise<boolean>
  onDiscard: () => void
  controls?: (guard: ReturnType<typeof useLeaveGuard>) => void
}
function Editor({ name, confirm, onDiscard, controls }: EditorProps) {
  const guard = useLeaveGuard({ dirty: true, confirm, onDiscard })
  controls?.(guard)
  const guarded = useGuardedLinkClick(() => guard.confirmLeave())
  return <Link to="/away" onClick={(event) => guarded(event, '/away')}>Leave from {name}</Link>
}

let cleanup: (() => Promise<void>) | null = null
afterEach(async () => {
  await cleanup?.()
  cleanup = null
})

async function mount(editors: EditorProps[]) {
  const router = createMemoryRouter([
    {
      element: <LeaveGuardProvider><Outlet /></LeaveGuardProvider>,
      children: [
        { path: '/', element: <>{editors.map((props) => <Editor key={props.name} {...props} />)}</> },
        { path: '/away', element: <p>Away</p> },
      ],
    },
  ])
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(<RouterProvider router={router} />))
  cleanup = async () => {
    await act(async () => root.unmount())
    host.remove()
    router.dispose()
  }
  const unloadBlocked = () => {
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  }
  const click = async (label: string) => {
    await act(async () => {
      Array.from(host.querySelectorAll('a')).find((node) => node.textContent === label)
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    })
  }
  return { router, unloadBlocked, click }
}

it('keeps both drafts protected when A is confirmed and B is kept', async () => {
  const a = { name: 'A', confirm: answering(true, true), onDiscard: vi.fn() }
  const b = { name: 'B', confirm: answering(false, true), onDiscard: vi.fn() }
  const { router, unloadBlocked } = await mount([a, b])
  await act(async () => router.navigate('/away'))
  expect(router.state.location.pathname).toBe('/')
  expect(a.confirm).toHaveBeenCalledTimes(1)
  expect(b.confirm).toHaveBeenCalledTimes(1)
  expect(a.onDiscard).not.toHaveBeenCalled()
  expect(b.onDiscard).not.toHaveBeenCalled()
  expect(unloadBlocked()).toBe(true)
  // The next move asks about A again, not just B.
  await act(async () => router.navigate('/away'))
  expect(a.confirm).toHaveBeenCalledTimes(2)
  expect(b.confirm).toHaveBeenCalledTimes(2)
  expect(router.state.location.pathname).toBe('/away')
  expect(a.onDiscard).toHaveBeenCalledTimes(1)
  expect(b.onDiscard).toHaveBeenCalledTimes(1)
})

it('stops at the first Keep editing and discards nothing', async () => {
  const a = { name: 'A', confirm: answering(false, false), onDiscard: vi.fn() }
  const b = { name: 'B', confirm: answering(true), onDiscard: vi.fn() }
  const { router, unloadBlocked } = await mount([a, b])
  await act(async () => router.navigate('/away'))
  expect(router.state.location.pathname).toBe('/')
  expect(b.confirm).not.toHaveBeenCalled()
  expect(a.onDiscard).not.toHaveBeenCalled()
  expect(b.onDiscard).not.toHaveBeenCalled()
  expect(unloadBlocked()).toBe(true)
  await act(async () => router.navigate('/away'))
  expect(a.confirm).toHaveBeenCalledTimes(2)
  expect(router.state.location.pathname).toBe('/')
})

it('leaves and discards both drafts once when both are confirmed', async () => {
  const a = { name: 'A', confirm: answering(true), onDiscard: vi.fn() }
  const b = { name: 'B', confirm: answering(true), onDiscard: vi.fn() }
  const { router } = await mount([a, b])
  await act(async () => router.navigate('/away'))
  expect(router.state.location.pathname).toBe('/away')
  expect(a.onDiscard).toHaveBeenCalledTimes(1)
  expect(b.onDiscard).toHaveBeenCalledTimes(1)
})

it('holds an explicit link confirmation until every other draft agrees', async () => {
  const a = { name: 'A', confirm: answering(true, true), onDiscard: vi.fn() }
  const b = { name: 'B', confirm: answering(false, true), onDiscard: vi.fn() }
  const { router, click, unloadBlocked } = await mount([a, b])
  // The link asks A first; the navigation it starts then asks B, who keeps editing.
  await click('Leave from A')
  expect(a.confirm).toHaveBeenCalledTimes(1)
  expect(b.confirm).toHaveBeenCalledTimes(1)
  expect(router.state.location.pathname).toBe('/')
  expect(a.onDiscard).not.toHaveBeenCalled()
  expect(unloadBlocked()).toBe(true)
  // A plain navigation now asks A again: the earlier yes did not survive the cancel.
  await act(async () => router.navigate('/away'))
  expect(a.confirm).toHaveBeenCalledTimes(2)
  expect(b.confirm).toHaveBeenCalledTimes(2)
  expect(router.state.location.pathname).toBe('/away')
  expect(a.onDiscard).toHaveBeenCalledTimes(1)
  expect(b.onDiscard).toHaveBeenCalledTimes(1)
})

it('asks once for an explicit confirmation with one draft, and again after rearm', async () => {
  let guard: ReturnType<typeof useLeaveGuard> | null = null
  const a = { name: 'A', confirm: answering(true, false), onDiscard: vi.fn(), controls: (g: ReturnType<typeof useLeaveGuard>) => { guard = g } }
  const { router, unloadBlocked } = await mount([a])
  // A held yes whose request then failed (Message): rearm keeps the draft guarded and discards nothing.
  await act(async () => { await guard!.confirmLeave() })
  expect(unloadBlocked()).toBe(true)
  act(() => guard!.rearm())
  await act(async () => router.navigate('/away'))
  expect(a.confirm).toHaveBeenCalledTimes(2)
  expect(router.state.location.pathname).toBe('/')
  expect(a.onDiscard).not.toHaveBeenCalled()
})

it('lets an explicit confirmation with one draft through without asking twice', async () => {
  const a = { name: 'A', confirm: answering(true), onDiscard: vi.fn() }
  const { router, click } = await mount([a])
  await click('Leave from A')
  expect(a.confirm).toHaveBeenCalledTimes(1)
  expect(router.state.location.pathname).toBe('/away')
  expect(a.onDiscard).toHaveBeenCalledTimes(1)
})

describe('leavesPathOrParam (UX-1 review)', () => {
  const at = (search: string, pathname = '/admin/grading') => ({ pathname, search, hash: '', state: null, key: search })
  const moves = (from: string, to: string, ...params: string[]) =>
    leavesPathOrParam(...params)({ currentLocation: at(from), nextLocation: at(to), historyAction: 'PUSH' } as never)
  it('guards every parameter the inline review is keyed on', () => {
    expect(moves('?cohort_id=1&submission=5', '?cohort_id=2&submission=5', 'submission', 'cohort_id')).toBe(true)
    expect(moves('?cohort_id=1&submission=5', '?cohort_id=1&submission=6', 'submission', 'cohort_id')).toBe(true)
    expect(moves('?cohort_id=1&submission=5', '?cohort_id=1&submission=5&page=2', 'submission', 'cohort_id')).toBe(false)
    // One parameter, as the module grid uses it.
    expect(moves('?review=5&view=grid', '?review=5&view=queue', 'review')).toBe(false)
  })
})
