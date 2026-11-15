import { api } from './api'
import type { RecordRelated, RelatedRecordType } from './recordRelated'

/*
 * One related-panel request per record and viewer (L-0.4). Callers asking for
 * the same record at the same time (StrictMode's double effect, a header and a
 * panel) share one request. Nothing is kept after it settles: counts change as
 * work arrives, so the next visit asks again.
 *
 * Like the peek-card summaries (recordSummary.ts), entries are keyed by the
 * signed-in user's id, and signing out or switching accounts cancels every
 * request in flight (AuthContext calls clearRecordRelatedCache). A response
 * that arrives after a clear is dropped, never shown.
 */

export type RelatedLoad = { status: 'ready'; related: RecordRelated } | { status: 'error'; error: string } | { status: 'aborted' }
export interface RelatedParams { cohortId?: number | null; studentId?: number | null }

type Shared = { promise: Promise<RelatedLoad>; controller: AbortController; users: number; abortTimer?: ReturnType<typeof setTimeout> }
const inFlight = new Map<string, Shared>()
let generation = 0

const UNAVAILABLE = 'Related items are unavailable.'
const validId = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0

export function relatedRequestKey(viewerId: number, type: RelatedRecordType, id: number, params: RelatedParams = {}) {
  return `${viewerId}|${type}:${id}:${params.cohortId || ''}:${params.studentId || ''}`
}

/** Cancels every related request in flight and drops their answers (sign-out, account switch). */
export function clearRecordRelatedCache() {
  generation += 1
  for (const shared of inFlight.values()) {
    clearTimeout(shared.abortTimer)
    shared.controller.abort()
  }
  inFlight.clear()
}

/**
 * Starts (or joins) the request for one record. Call `release` when the
 * caller no longer wants the answer; the request is cancelled only when its
 * last caller releases it, one tick later, so an unmount and immediate
 * remount (StrictMode) keeps it. Without a viewer id nothing is shared.
 */
export function loadRecordRelated(viewerId: number | null | undefined, type: RelatedRecordType, id: number, params: RelatedParams = {}): { promise: Promise<RelatedLoad>; release: () => void } {
  const key = validId(viewerId) ? relatedRequestKey(viewerId, type, id, params) : null
  let shared = key ? inFlight.get(key) : undefined
  if (!shared) {
    const controller = new AbortController()
    const startedIn = generation
    const stale = () => controller.signal.aborted || startedIn !== generation
    // A thrown request (offline, a stubbed client) becomes an error result, never a page crash.
    const promise = Promise.resolve()
      .then(() => api.getRecordRelated(type, id, { cohortId: params.cohortId, studentId: params.studentId }, controller.signal))
      .then((result): RelatedLoad => {
        if (stale()) return { status: 'aborted' }
        return result.data ? { status: 'ready', related: result.data.related } : { status: 'error', error: result.error || UNAVAILABLE }
      }, (): RelatedLoad => (stale() ? { status: 'aborted' } : { status: 'error', error: UNAVAILABLE }))
      .finally(() => {
        if (key && inFlight.get(key) === entry) inFlight.delete(key)
      })
    const entry: Shared = { controller, users: 0, promise }
    if (key) inFlight.set(key, entry)
    shared = entry
  }

  const current = shared
  current.users += 1
  clearTimeout(current.abortTimer)
  let released = false
  return {
    promise: current.promise,
    release: () => {
      if (released) return
      released = true
      current.users -= 1
      if (current.users > 0) return
      current.abortTimer = setTimeout(() => {
        if (current.users > 0) return
        current.controller.abort()
        if (key && inFlight.get(key) === current) inFlight.delete(key)
      }, 0)
    },
  }
}
