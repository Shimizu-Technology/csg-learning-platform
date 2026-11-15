/*
 * Queue requests for record pages (L-0.7), shared by viewer and source.
 *
 * A record opened from a list fetches that list again to show "3 of 9" and
 * Previous/Next. Each step opens a new record, so without sharing every step
 * fetched the whole queue again. Requests are keyed by the signed-in user's
 * id and the list's normalized filters (never search text), and:
 *
 * - callers asking at the same time share one request;
 * - a successful answer is kept for a short time, so stepping through the
 *   queue reuses it;
 * - grading or resolving invalidates every queue, so the next record asks again;
 * - a record that loads fresh and disagrees with its remembered copy (graded or
 *   resolved elsewhere) drops that queue, so the page asks again (useRecordQueue);
 * - the request is aborted when its last caller goes away (one tick later, so
 *   StrictMode's unmount and remount keeps it);
 * - signing out or switching accounts aborts and drops everything
 *   (AuthContext calls clearRecordQueueCache). An answer that arrives after an
 *   invalidation or clear is never stored or shown.
 */

export type QueueLoad<T> = { status: 'ready'; items: T } | { status: 'error'; error: string } | { status: 'aborted' }

const QUEUE_TTL_MS = 30_000

interface Entry {
  promise: Promise<QueueLoad<unknown>>
  controller: AbortController
  users: number
  settledAt: number | null
  ready: QueueLoad<unknown> | null
  abortTimer?: ReturnType<typeof setTimeout>
}
const entries = new Map<string, Entry>()
let generation = 0

const validViewer = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0
const cacheKey = (viewerId: number, source: string) => `${viewerId}|${source}`

/** Aborts and forgets every queue request (sign-out, account switch). */
export function clearRecordQueueCache() {
  generation += 1
  for (const entry of entries.values()) {
    clearTimeout(entry.abortTimer)
    entry.controller.abort()
  }
  entries.clear()
}

/** Forgets every remembered queue after a grade or resolve; requests in flight finish for their callers but are not kept. */
export function invalidateRecordQueues() {
  entries.clear()
}

/** Forgets one remembered queue, e.g. when a freshly loaded record shows it is out of date. */
export function dropRecordQueue(viewerId: number | null | undefined, source: string) {
  if (validViewer(viewerId)) entries.delete(cacheKey(viewerId, source))
}

function fresh(entry: Entry | undefined) {
  return Boolean(entry && (entry.settledAt === null || Date.now() - entry.settledAt < QUEUE_TTL_MS))
}

/** The remembered answer for this viewer and source, if it is still fresh. */
export function peekRecordQueue<T>(viewerId: number | null | undefined, source: string): QueueLoad<T> | null {
  if (!validViewer(viewerId)) return null
  const entry = entries.get(cacheKey(viewerId, source))
  return fresh(entry) && entry?.ready ? (entry.ready as QueueLoad<T>) : null
}

/**
 * Starts or joins the queue request for `source`. `fetcher` receives the
 * request's AbortSignal. Call `release` when the answer is no longer wanted.
 */
export function loadRecordQueue<T>(
  viewerId: number | null | undefined,
  source: string,
  fetcher: (signal: AbortSignal) => Promise<QueueLoad<T>>,
): { promise: Promise<QueueLoad<T>>; release: () => void } {
  const key = validViewer(viewerId) ? cacheKey(viewerId, source) : null
  let entry = key ? entries.get(key) : undefined
  if (entry && !fresh(entry)) {
    if (key) entries.delete(key)
    entry = undefined
  }
  if (!entry) {
    const controller = new AbortController()
    const startedIn = generation
    const stale = () => controller.signal.aborted || startedIn !== generation
    const created: Entry = { controller, users: 0, settledAt: null, ready: null, promise: Promise.resolve({ status: 'aborted' }) }
    created.promise = Promise.resolve()
      .then(() => fetcher(controller.signal))
      .then((load): QueueLoad<unknown> => (stale() ? { status: 'aborted' } : load), (): QueueLoad<unknown> => (stale() ? { status: 'aborted' } : { status: 'error', error: 'Queue unavailable. Return to the list to retry.' }))
      .then((load) => {
        const current = key ? entries.get(key) === created : false
        // Only a successful answer is remembered; errors ask again next time.
        if (current && load.status === 'ready') {
          created.settledAt = Date.now()
          created.ready = load
        } else if (current && key) entries.delete(key)
        return load
      })
    if (key) entries.set(key, created)
    entry = created
  }

  const shared = entry
  shared.users += 1
  clearTimeout(shared.abortTimer)
  let released = false
  return {
    promise: shared.promise as Promise<QueueLoad<T>>,
    release: () => {
      if (released) return
      released = true
      shared.users -= 1
      if (shared.users > 0 || shared.settledAt !== null) return
      shared.abortTimer = setTimeout(() => {
        if (shared.users > 0 || shared.settledAt !== null) return
        shared.controller.abort()
        if (key && entries.get(key) === shared) entries.delete(key)
      }, 0)
    },
  }
}
