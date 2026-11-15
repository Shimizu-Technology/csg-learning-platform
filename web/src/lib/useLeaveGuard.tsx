import { createContext, useCallback, useContext, useEffect, useRef, type MouseEvent, type ReactNode } from 'react'
import { useBlocker, useLocation, useNavigate, type BlockerFunction } from 'react-router-dom'
import { isPlainLeftClick } from './links'

/*
 * Unsaved-draft protection for every way out of a page: links, browser
 * Back/Forward, a query change that replaces an inline editor, Previous/Next,
 * and reload or tab close (beforeunload).
 *
 * React Router honours one blocker per router, so the app mounts one
 * LeaveGuardProvider inside the data router and each editor registers with it
 * through useLeaveGuard. A blocked navigation asks each dirty guard it would
 * discard, using that guard's own confirm dialog, and goes ahead only when all
 * agree.
 */

type BlockArgs = Parameters<BlockerFunction>[0]

interface GuardState {
  dirty: boolean
  /** Set once leaving is confirmed (or a save succeeded) so the navigation that follows is not asked twice. */
  released: boolean
  blocks: (args: BlockArgs) => boolean
  confirm: () => Promise<boolean>
  onDiscard?: () => void
}
type GuardRecord = { current: GuardState }

interface Registry {
  register: (guard: GuardRecord) => () => void
}
const LeaveGuardContext = createContext<Registry | null>(null)

/** Leaving the page: the next location has a different path. */
export const leavesPath = ({ currentLocation, nextLocation }: BlockArgs) => currentLocation.pathname !== nextLocation.pathname

/** Leaving the page, or changing the query parameter that selects an inline editor (e.g. `?submission=`). */
export const leavesPathOrParam = (param: string) => (args: BlockArgs) =>
  leavesPath(args) ||
  new URLSearchParams(args.currentLocation.search).get(param) !== new URLSearchParams(args.nextLocation.search).get(param)

export function LeaveGuardProvider({ children }: { children: ReactNode }) {
  const guards = useRef(new Set<GuardRecord>())
  const pending = useRef<GuardRecord[]>([])
  const shouldBlock = useCallback<BlockerFunction>((args) => {
    pending.current = Array.from(guards.current).filter((guard) => guard.current.dirty && !guard.current.released && guard.current.blocks(args))
    return pending.current.length > 0
  }, [])
  const blocker = useBlocker(shouldBlock)
  const latest = useRef(blocker)
  latest.current = blocker
  useEffect(() => {
    if (blocker.state !== 'blocked') return
    let current = true
    void (async () => {
      for (const guard of pending.current) {
        if (!guard.current.dirty || guard.current.released) continue
        const leave = await confirmGuard(guard)
        if (!current) return
        if (!leave) {
          if (latest.current.state === 'blocked') latest.current.reset()
          return
        }
      }
      if (latest.current.state === 'blocked') latest.current.proceed()
    })()
    return () => {
      current = false
    }
  }, [blocker.state])
  const registry = useRef<Registry>({
    register: (guard) => {
      guards.current.add(guard)
      return () => {
        guards.current.delete(guard)
      }
    },
  })
  return <LeaveGuardContext.Provider value={registry.current}>{children}</LeaveGuardContext.Provider>
}

async function confirmGuard(guard: GuardRecord) {
  const state = guard.current
  if (!state.dirty || state.released) return true
  const leave = await state.confirm()
  if (leave) {
    state.released = true
    state.onDiscard?.()
  }
  return leave
}

export interface LeaveGuardOptions {
  /** True while there is something to lose. */
  dirty: boolean
  /** Asks whether to discard; resolves true to leave. */
  confirm: () => Promise<boolean>
  /** Which navigations discard this draft. Defaults to leaving the path. */
  blocks?: (args: BlockArgs) => boolean
  onDiscard?: () => void
}

/**
 * Registers an unsaved draft with the router-level guard and the browser's
 * beforeunload prompt. Returns `confirmLeave` for in-page actions that discard
 * the draft (it asks only when dirty, and a yes lets the navigation that follows
 * through), `release` to call right before navigating after a successful save,
 * and `rearm` for when a confirmed leave did not happen after all.
 */
export function useLeaveGuard({ dirty, confirm, blocks = leavesPath, onDiscard }: LeaveGuardOptions) {
  const registry = useContext(LeaveGuardContext)
  const { key } = useLocation()
  const guard = useRef<GuardState>({ dirty, released: false, blocks, confirm, onDiscard })
  Object.assign(guard.current, { dirty, blocks, confirm, onDiscard })
  useEffect(() => registry?.register(guard), [registry])
  // A confirmed leave or save covers one move: any later edit, or arriving somewhere new, guards again.
  useEffect(() => {
    if (!dirty) guard.current.released = false
  }, [dirty])
  useEffect(() => {
    guard.current.released = false
  }, [key])
  useEffect(() => {
    if (!dirty) return
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (guard.current.released) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [dirty])
  const confirmLeave = useCallback(() => confirmGuard(guard), [])
  const release = useCallback(() => {
    guard.current.released = true
  }, [])
  /** Guards again after a confirmed leave that did not happen (the request behind it failed). */
  const rearm = useCallback(() => {
    guard.current.released = false
  }, [])
  return { confirmLeave, release, rearm }
}

/**
 * A link click handler for pages that host an unsaved editor (e.g. an inline
 * submission review). A plain left click asks `confirmLeave` first and
 * navigates only when it resolves true; ⌘/Ctrl/Shift/Alt and middle clicks open
 * a new tab as usual. When `confirmLeave` returns undefined (no editor open) the
 * link navigates normally. Browser Back and other navigations are covered by
 * useLeaveGuard; this keeps the question ahead of the click.
 *
 * Pass the result as RecordLink's `onClick`, or call it from a Link's onClick
 * with the same path as its `to`.
 */
export function useGuardedLinkClick(confirmLeave: () => Promise<boolean> | undefined) {
  const navigate = useNavigate()
  return (event: MouseEvent<HTMLAnchorElement>, path: string, state?: unknown) => {
    if (!isPlainLeftClick(event)) return
    const pending = confirmLeave()
    if (!pending) return
    event.preventDefault()
    void pending.then((leave) => { if (leave) navigate(path, state === undefined ? undefined : { state }) })
  }
}
