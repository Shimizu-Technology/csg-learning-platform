import { useEffect, useRef } from 'react'
import { isEditableTarget } from './navigationContext'
import { safeInternalReturnPath } from './routes'

/*
 * Return-to-queue for record pages (L-0.7). A record opened from a list shows
 * "3 of 9" with Previous/Next and "Back to <list>", and saving moves on to the
 * next item. The queue is the originating list as it was filtered: its URL is
 * the record's `return_to` (or router-state origin), so Back lands on the same
 * filtered list and the queue order matches what the list showed.
 *
 * Queues are never a list of ids in the URL. A live queue (grading, support)
 * is fetched again with the viewer's own permissions from the list's filters,
 * so it cannot reach records the viewer can't open, and an item someone else
 * finished drops out. A roster (people, not work) is remembered for this tab
 * when the list renders, and each record it leads to still checks access.
 */

export interface QueueStep<T> {
  /** Zero-based position of the current record, or -1 when it is not (or no longer) in the queue. */
  index: number
  total: number
  previous: T | null
  next: T | null
}

/** Where the current record sits in a queue, and its neighbours. */
export function queueStep<T>(items: readonly T[], isCurrent: (item: T) => boolean): QueueStep<T> {
  const index = items.findIndex(isCurrent)
  if (index < 0) return { index, total: items.length, previous: null, next: items[0] ?? null }
  return { index, total: items.length, previous: items[index - 1] ?? null, next: items[index + 1] ?? null }
}

/** The counter text: "3 of 9", or, when the record left the queue (finished by someone else), how many remain. */
export function queuePositionLabel(step: Pick<QueueStep<unknown>, 'index' | 'total'>) {
  if (step.index >= 0) return `${step.index + 1} of ${step.total}`
  return step.total === 0 ? 'Queue is empty' : `Not in queue · ${step.total} left`
}

function parsePath(path: string | null | undefined) {
  const safe = path ? safeInternalReturnPath(path, '') : ''
  if (!safe) return null
  try {
    const url = new URL(safe, 'https://csg.local')
    return { pathname: url.pathname.replace(/\/+$/, '') || '/', params: url.searchParams }
  } catch {
    return null
  }
}

const ID = /^[1-9]\d{0,15}$/
const idParam = (value: string | null) => (value && ID.test(value) ? Number(value) : null)

export type SubmissionFilter = 'ungraded' | 'redo' | 'all'
const submissionFilter = (value: string | null, fallback: SubmissionFilter): SubmissionFilter =>
  value === 'ungraded' || value === 'redo' || value === 'all' ? value : fallback

/** A module grading page's queue, read from its URL (the record's return path). */
export interface ModuleQueueSource {
  cohortId: number
  moduleId: number
  view: 'grid' | 'queue' | 'students'
  filter: SubmissionFilter
  studentId: number | null
}

export function moduleQueueSource(path: string | null | undefined): ModuleQueueSource | null {
  const parsed = parsePath(path)
  const match = parsed?.pathname.match(/^\/admin\/cohorts\/([1-9]\d{0,15})\/modules\/([1-9]\d{0,15})\/grading$/)
  if (!parsed || !match) return null
  const view = parsed.params.get('view')
  return {
    cohortId: Number(match[1]),
    moduleId: Number(match[2]),
    view: view === 'queue' || view === 'students' ? view : 'grid',
    filter: submissionFilter(parsed.params.get('filter'), 'ungraded'),
    studentId: idParam(parsed.params.get('student')),
  }
}

/** The Support page's request filters, from its URL. Shared by the page and the help-request record. */
export interface SupportFilters {
  cohortId: number | null
  view: 'active' | 'resolved'
  urgentOnly: boolean
}

export function supportFiltersFromSearch(search: string | URLSearchParams): SupportFilters {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search
  return {
    cohortId: idParam(params.get('cohort_id')),
    view: params.get('view') === 'resolved' ? 'resolved' : 'active',
    urgentOnly: params.get('urgency') === 'urgent',
  }
}

/** The Support page's filters when `path` is that page, else null. */
export function supportQueueSource(path: string | null | undefined): SupportFilters | null {
  const parsed = parsePath(path)
  return parsed?.pathname === '/admin/support' ? supportFiltersFromSearch(parsed.params) : null
}

export function filterSupportRequests<T extends { urgency?: string | null }>(
  queue: { help_requests: T[]; recently_resolved: T[] },
  filters: Pick<SupportFilters, 'view' | 'urgentOnly'>,
) {
  return (filters.view === 'active' ? queue.help_requests : queue.recently_resolved)
    .filter((request) => !filters.urgentOnly || request.urgency === 'urgent')
}

/* Rosters: the students a list showed, for this tab only. */

export interface RosterEntry {
  cohortId: number
  userId: number
}

const ROSTER_PREFIX = 'csg:roster:'
const ROSTER_LIMIT = 500

function session(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

function rosterKey(listPath: string) {
  return ROSTER_PREFIX + (listPath.split(/[?#]/)[0] || '/')
}

/**
 * Remembers the students a list is showing, in order, under that list's URL.
 * One slot per list page, so typing in its search box replaces the slot.
 * Holds ids only; names and emails never leave the page.
 */
export function rememberRoster(listPath: string, entries: readonly RosterEntry[]) {
  const store = session()
  if (!store) return
  const seen = new Set<string>()
  const ids: string[] = []
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.cohortId) || !Number.isSafeInteger(entry.userId) || entry.cohortId <= 0 || entry.userId <= 0) continue
    const id = `${entry.cohortId}:${entry.userId}`
    if (seen.has(id)) continue
    seen.add(id)
    ids.push(id)
    if (ids.length >= ROSTER_LIMIT) break
  }
  try {
    store.setItem(rosterKey(listPath), JSON.stringify({ path: listPath, ids }))
  } catch {
    // Storage full or disabled: the record shows no counter, which is the deep-link behaviour.
  }
}

/** The roster remembered for exactly this list URL (same filters), or null. Malformed entries are dropped. */
export function readRoster(listPath: string | null | undefined): RosterEntry[] | null {
  if (!listPath) return null
  try {
    const raw = session()?.getItem(rosterKey(listPath))
    if (!raw) return null
    const saved = JSON.parse(raw) as { path?: unknown; ids?: unknown }
    if (saved.path !== listPath || !Array.isArray(saved.ids)) return null
    return saved.ids.slice(0, ROSTER_LIMIT).flatMap((id): RosterEntry[] => {
      const match = typeof id === 'string' ? id.match(/^([1-9]\d{0,15}):([1-9]\d{0,15})$/) : null
      return match ? [{ cohortId: Number(match[1]), userId: Number(match[2]) }] : []
    })
  } catch {
    return null
  }
}

/** Keeps a list's roster up to date while it renders. */
export function useRememberRoster(listPath: string, entries: readonly RosterEntry[], ready = true) {
  const signature = entries.map((entry) => `${entry.cohortId}:${entry.userId}`).join(',')
  useEffect(() => {
    if (ready) rememberRoster(listPath, entries)
    // The signature captures the entries' content; the array identity changes every render.
  }, [listPath, signature, ready])
}

/**
 * Queue keyboard shortcuts on a record page: J next, K previous. Ignored while
 * typing, inside dialogs, with modifier keys, or when a focused panel already
 * handled the key. (Alt+← / → is the browser's own Back on Windows and Linux,
 * so it is left alone; ⌘K / Ctrl+K stays with search.)
 */
export function useQueueShortcuts(handlers: { onPrevious?: () => void; onNext?: () => void } | null) {
  const latest = useRef(handlers)
  latest.current = handlers
  const enabled = Boolean(handlers)
  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
      if (isEditableTarget(event.target) || document.querySelector('[data-app-modal]')) return
      const key = event.key.toLowerCase()
      const action = key === 'j' ? latest.current?.onNext : key === 'k' ? latest.current?.onPrevious : undefined
      if (!action) return
      event.preventDefault()
      action()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [enabled])
}

/**
 * The list's return path with its selection moved to `target`, so Back to the
 * queue after Previous/Next lands on the item you were last on: the Grading
 * inbox's `submission`, a module grid's `review` and its cell anchor. Paths
 * that select nothing are returned unchanged.
 */
export function retargetReturnPath(path: string, target: { id: number; user_id?: number | null; content_block_id?: number | null }) {
  const parsed = parsePath(path)
  if (!parsed) return path
  const url = new URL(safeInternalReturnPath(path, '/'), 'https://csg.local')
  let changed = false
  if (parsed.pathname === '/admin/grading' && url.searchParams.has('submission')) {
    url.searchParams.set('submission', String(target.id))
    changed = true
  }
  if (moduleQueueSource(path)) {
    if (url.searchParams.has('review')) {
      url.searchParams.set('review', String(target.id))
      changed = true
    }
    if (url.hash.startsWith('#grading-cell-') && target.user_id && target.content_block_id) {
      url.hash = `#grading-cell-${target.user_id}-${target.content_block_id}`
      changed = true
    }
  }
  return changed ? `${url.pathname}${url.search}${url.hash}` : path
}

/**
 * Moving through a queue opens the next record at its top (U-4.1: Save and next
 * "scrolls the review to the top"). Routes don't reset scroll on their own, so a
 * phone grading at the bottom of a long review would land mid-way down the next.
 */
export function scrollToRecordTop() {
  if (typeof window === 'undefined') return
  try {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
  } catch {
    // jsdom and old engines: nothing to scroll.
  }
}
