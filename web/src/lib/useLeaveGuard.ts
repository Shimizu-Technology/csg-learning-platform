import type { MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { isPlainLeftClick } from './links'

/**
 * A link click handler for pages that host an unsaved editor (e.g. an inline
 * submission review). A plain left click asks `confirmLeave` first and
 * navigates only when it resolves true; ⌘/Ctrl/Shift/Alt and middle clicks open
 * a new tab as usual. When `confirmLeave` returns undefined (no editor open) the
 * link navigates normally.
 *
 * Pass the result as RecordLink's `onClick`, or call it from a Link's onClick
 * with the same path as its `to`.
 */
export function useLeaveGuard(confirmLeave: () => Promise<boolean> | undefined) {
  const navigate = useNavigate()
  return (event: MouseEvent<HTMLAnchorElement>, path: string, state?: unknown) => {
    if (!isPlainLeftClick(event)) return
    const pending = confirmLeave()
    if (!pending) return
    event.preventDefault()
    void pending.then((leave) => { if (leave) navigate(path, state === undefined ? undefined : { state }) })
  }
}
