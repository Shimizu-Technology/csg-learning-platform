import { createContext, useContext, type ReactNode } from 'react'
import { Link as RouterLink, useLocation, type LinkProps } from 'react-router-dom'
import { listLinkState } from '../lib/navigationContext'

export const PreviewNavigationContext = createContext<((path: string) => string) | null>(null)

/**
 * The name of the list or hub page a link sits on ("Today", "Grading inbox ·
 * Redo"). Links rendered inside it carry this page's URL and name as router
 * state, so the record they open can say "Back to Today" (L-0.3).
 */
export const ReturnOriginContext = createContext<string | null>(null)

/** Wrap a list or hub page so links on it tell records where they were opened from. */
export function ReturnOrigin({ label, children }: { label: string | null | undefined; children: ReactNode }) {
  return <ReturnOriginContext.Provider value={label?.trim() || null}>{children}</ReturnOriginContext.Provider>
}

/**
 * A router link that stays inside a staff preview of the learner view and,
 * inside `ReturnOrigin`, passes this page as the destination's Back link.
 * An explicit `state` always wins.
 */
export function PreviewLink({ to, state, ...props }: LinkProps) {
  const previewPath = useContext(PreviewNavigationContext)
  const origin = useContext(ReturnOriginContext)
  const location = useLocation()
  return <RouterLink {...props} state={state !== undefined ? state : origin ? listLinkState(location, origin) : undefined} to={previewPath && typeof to === 'string' ? previewPath(to) : to} />
}
