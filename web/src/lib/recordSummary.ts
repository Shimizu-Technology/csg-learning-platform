import { api } from './api'
import type { RecordRef, ViewerRole } from './routes'

/** The records a peek card can summarize (L-0.5). */
export type PeekRecordType = 'student' | 'lesson' | 'cohort'

export interface PeekTarget {
  type: PeekRecordType
  id: number
  cohortId?: number | null
}

export interface RecordSummaryFact {
  key: string
  label: string
  value: string | number | null
  /** `time` values are ISO timestamps. */
  kind: 'count' | 'text' | 'time'
  attention: boolean
}

export interface RecordSummary {
  type: PeekRecordType
  id: number
  title: string
  subtitle: string
  facts: RecordSummaryFact[]
  handle?: string | null
  avatar_url?: string | null
  cohort_id?: number | null
  cohort_name?: string | null
  module_id?: number | null
  module_name?: string | null
  last_active_at?: string | null
  archived?: boolean
  status?: string
}

const validId = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0

/**
 * The summary a record link can peek at, or null. Staff peek at learners,
 * lessons and cohorts; learners peek only at lessons (never at other learners).
 */
export function peekTargetFor(ref: RecordRef, role: ViewerRole | null): PeekTarget | null {
  if (!role) return null
  const staff = role !== 'student'
  switch (ref.type) {
    case 'student':
      return staff && validId(ref.id) ? { type: 'student', id: ref.id, cohortId: validId(ref.cohortId) ? ref.cohortId : null } : null
    case 'enrollment':
      return staff && validId(ref.userId) && validId(ref.cohortId) ? { type: 'student', id: ref.userId, cohortId: ref.cohortId } : null
    case 'cohort':
      return staff && validId(ref.id) ? { type: 'cohort', id: ref.id } : null
    case 'lesson':
      return validId(ref.id) ? { type: 'lesson', id: ref.id, cohortId: validId(ref.cohortId) ? ref.cohortId : null } : null
    default:
      return null
  }
}

export function peekTargetKey(target: PeekTarget) {
  return `${target.type}:${target.id}:${target.cohortId || ''}`
}

/** Summaries stay fresh for 30 seconds: long enough for moving back and forth along a list. */
export const SUMMARY_CACHE_MS = 30_000

/*
 * Summaries are facts for one viewer, so every cache entry is keyed by the
 * signed-in user's id, and signing out or switching accounts clears the cache
 * and cancels requests still in flight (AuthContext calls
 * clearRecordSummaryCache). A response that arrives after a clear is dropped,
 * never cached or shown.
 */
type CacheEntry = { summary: RecordSummary | null; at: number }
const cache = new Map<string, CacheEntry>()
const inFlight = new Set<AbortController>()
const MAX_ENTRIES = 100
let generation = 0

function cacheKey(target: PeekTarget, viewerId: number) {
  return `${viewerId}|${peekTargetKey(target)}`
}

/** A cached summary (or a cached "not available"), or undefined when it must be fetched. */
export function cachedRecordSummary(target: PeekTarget, viewerId: number | null | undefined, now = Date.now()): RecordSummary | null | undefined {
  if (!validId(viewerId)) return undefined
  const key = cacheKey(target, viewerId)
  const entry = cache.get(key)
  if (!entry) return undefined
  if (now - entry.at > SUMMARY_CACHE_MS) {
    cache.delete(key)
    return undefined
  }
  return entry.summary
}

/** Forgets every summary and cancels every request in flight (sign-out, account switch). */
export function clearRecordSummaryCache() {
  generation += 1
  cache.clear()
  for (const controller of inFlight) controller.abort()
  inFlight.clear()
}

export type SummaryLoad = { status: 'ready'; summary: RecordSummary } | { status: 'missing' } | { status: 'error'; error: string } | { status: 'aborted' }

/**
 * Loads one summary for the signed-in viewer. "Not found" is cached like a
 * summary (the viewer can't open it); errors are not, so the next hover retries.
 */
export async function loadRecordSummary(target: PeekTarget, viewerId: number | null | undefined, signal?: AbortSignal): Promise<SummaryLoad> {
  if (!validId(viewerId)) return { status: 'aborted' }
  const cached = cachedRecordSummary(target, viewerId)
  if (cached) return { status: 'ready', summary: cached }
  if (cached === null) return { status: 'missing' }

  const startedIn = generation
  const controller = new AbortController()
  const forwardAbort = () => controller.abort()
  if (signal?.aborted) controller.abort()
  signal?.addEventListener('abort', forwardAbort)
  inFlight.add(controller)
  try {
    const result = await api.getRecordSummary(target.type, target.id, target.cohortId, controller.signal)
    if (controller.signal.aborted || startedIn !== generation) return { status: 'aborted' }
    if (result.data?.summary) {
      remember(target, viewerId, result.data.summary)
      return { status: 'ready', summary: result.data.summary }
    }
    if (result.status === 404 || result.status === 403) {
      remember(target, viewerId, null)
      return { status: 'missing' }
    }
    return { status: 'error', error: result.error || 'Could not load this summary.' }
  } finally {
    inFlight.delete(controller)
    signal?.removeEventListener('abort', forwardAbort)
  }
}

function remember(target: PeekTarget, viewerId: number, summary: RecordSummary | null) {
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!)
  cache.set(cacheKey(target, viewerId), { summary, at: Date.now() })
}

/** "active now", "25 min ago", "3 h ago", "8 days ago". */
export function lastActiveLabel(value: string | null | undefined, now = Date.now()) {
  if (!value) return 'no activity yet'
  const at = new Date(value).getTime()
  if (Number.isNaN(at)) return 'no activity yet'
  const minutes = Math.max(0, Math.floor((now - at) / 60_000))
  if (minutes < 5) return 'active now'
  if (minutes < 60) return `last active ${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `last active ${hours} h ago`
  const days = Math.floor(hours / 24)
  return `last active ${days} day${days === 1 ? '' : 's'} ago`
}
