import { useLocation } from 'react-router-dom'
import { readReturnContext, useReturnContext, type ReturnContext } from './navigationContext'
import { activityReturnPath, safeInternalReturnPath } from './routes'

/*
 * Where a record page was opened from, for its "Back to …" link (L-0.3).
 *
 * Origins arrive three ways, in this order of trust:
 * 1. Router state `{ returnTo, returnLabel }` from the page that linked here
 *    (`RecordLink returnLabel`, `listLinkState`). It carries the most specific
 *    label ("Grading inbox · Redo", "Cohort 3").
 * 2. A `return_to` (or `from`) query parameter, which survives a copied link or
 *    a new tab. The path goes through `safeInternalReturnPath`, and the label is
 *    derived from the path here, never read from the URL.
 * 3. The record's parent (`fallback`), so there is always a way back and the
 *    page never calls `navigate(-1)`.
 */

/** The Grading inbox's filter chips, by `filter` value (the ungraded queue is the default and adds nothing). */
const GRADING_FILTERS: Record<string, string> = { redo: 'Redo', all: 'All submissions' }

function queryOf(path: string) {
  try {
    return new URL(path, 'https://csg.local').searchParams
  } catch {
    return new URLSearchParams()
  }
}

/**
 * A label for a page the app knows, from its path alone. Returns null for
 * anything else, so callers fall back to a generic "Back".
 */
export function originLabel(path: string): string | null {
  const pathname = path.split(/[?#]/)[0].replace(/\/+$/, '') || '/'
  const query = queryOf(path)
  if (pathname === '/admin' || pathname === '/dashboard') return 'Today'
  if (pathname === '/admin/grading') {
    const filter = GRADING_FILTERS[query.get('filter') || '']
    return filter ? `Grading · ${filter}` : 'Grading'
  }
  if (pathname === '/admin/support') return 'Support'
  if (pathname === '/admin/students') return 'Students'
  if (pathname === '/admin/cohorts') return 'Cohorts'
  if (pathname === '/admin/content') return 'Content'
  if (pathname === '/admin/activity') return 'Activity'
  if (pathname === '/admin/meetings') return 'Meetings'
  if (pathname === '/admin/moderation') return 'Safety'
  if (pathname === '/admin/team') return 'Team'
  if (/^\/admin\/team\/\d+$/.test(pathname)) return 'Team member'
  if (/^\/admin\/cohorts\/\d+\/modules\/\d+\/grading$/.test(pathname)) return 'Module grading'
  if (/^\/admin\/cohorts\/\d+\/settings$/.test(pathname)) return 'Cohort settings'
  if (/^\/admin\/cohorts\/\d+\/students\/\d+(\/[a-z]+)?$/.test(pathname)) return 'Student page'
  if (/^\/admin\/cohorts\/\d+$/.test(pathname)) return query.get('tab') === 'activity' ? 'Activity' : 'Cohort'
  if (/^\/admin\/submissions\/\d+$/.test(pathname)) return 'Submission'
  if (/^\/admin\/help-requests\/\d+$/.test(pathname)) return 'Help request'
  if (/^\/admin\/interventions\/\d+$/.test(pathname)) return 'Follow-up plan'
  if (/^\/admin\/lessons\/\d+\/edit$/.test(pathname)) return 'Lesson editor'
  if (/^\/admin\/lessons\/\d+$/.test(pathname)) return 'Lesson'
  if (/^\/admin\/modules\/\d+$/.test(pathname)) return 'Module'
  if (/^\/admin\/curricula\/\d+$/.test(pathname)) return 'Curriculum'
  if (pathname === '/materials') return 'Learn'
  if (/^\/modules\/\d+$/.test(pathname)) return 'Module'
  if (/^\/lessons\/\d+$/.test(pathname)) return 'Lesson'
  if (/^\/cohorts\/\d+$/.test(pathname)) return 'Cohort'
  if (pathname === '/messages' || /^\/messages\/\d+$/.test(pathname)) return 'Messages'
  if (/^\/messages\/dm\/\d+$/.test(pathname)) return 'conversation'
  if (pathname === '/announcements') return query.get('tab') === 'inbox' ? 'Notifications' : 'Updates'
  if (/^\/announcements\/\d+$/.test(pathname)) return 'Updates'
  if (pathname === '/recordings') return 'Recordings'
  return null
}

/** "Back to <label>", leaving a label that already says "Back …" alone. */
export function backLinkText(label: string) {
  const trimmed = label.trim()
  return /^back\b/i.test(trimmed) ? trimmed : `Back to ${trimmed}`
}

/**
 * The origin carried in the URL (`return_to`, or `from`), as a safe internal
 * path with a label derived from the path, or null. Unsafe values (other
 * origins, `//host`, `javascript:`, encoded tricks) are rejected.
 */
export function originFromParams(search: string, accept: 'any' | 'activity' = 'any'): ReturnContext | null {
  const params = new URLSearchParams(search)
  const raw = params.get('return_to') ?? params.get('from')
  if (!raw) return null
  const activity = activityReturnPath(raw)
  if (activity) return { returnTo: activity, returnLabel: 'Activity' }
  if (accept === 'activity') return null
  const path = safeInternalReturnPath(raw, '')
  if (!path || /\s/.test(path)) return null
  return { returnTo: path, returnLabel: originLabel(path) || 'Back' }
}

export interface BackLink {
  to: string
  /** Visible text, "Back to …". */
  label: string
  /** True when this is the parent fallback rather than where the user came from. */
  fallback: boolean
}

/**
 * The Back link for a record page. `fallback` is the record's parent
 * ("Support", "Students"). `accept` limits which `return_to` paths the page
 * honours, matching its entry in the route registry. With a `scope`, the
 * origin is remembered for this tab, so a round trip through a linked page
 * keeps it.
 */
export function useBackLink(fallback: ReturnContext, options: { scope?: string; accept?: 'any' | 'activity' } = {}): BackLink {
  const location = useLocation()
  const remembered = useReturnContext(fallback, options.scope)
  const legacyFrom = typeof location.state?.from === 'string' ? safeInternalReturnPath(location.state.from, '') : ''
  const fromState = readReturnContext(location.state) || (legacyFrom && originLabel(legacyFrom) ? { returnTo: legacyFrom, returnLabel: originLabel(legacyFrom)! } : null)
  const fromParams = originFromParams(location.search, options.accept)
  // Router state wins when it points at the same place as the URL (or the URL says nothing).
  const chosen = fromState && (!fromParams || fromParams.returnTo === fromState.returnTo)
    ? fromState
    : fromParams || remembered
  return { to: chosen.returnTo, label: backLinkText(chosen.returnLabel), fallback: chosen === fallback }
}
