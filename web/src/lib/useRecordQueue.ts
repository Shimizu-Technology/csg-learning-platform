import { useEffect, useRef, useState } from 'react'
import { useAuthContext } from '../contexts/AuthContext'
import { dropRecordQueue, loadRecordQueue, peekRecordQueue, type QueueLoad } from './recordQueueCache'

export interface RecordQueueOptions<T> {
  /**
   * Compares the loaded queue with the record on screen. Returns a token naming
   * the disagreement (e.g. "41:B") when the queue's copy is out of date (graded
   * or resolved elsewhere since it was fetched), or null when they agree. Each
   * new token drops the remembered queue and fetches it again, once.
   */
  staleToken?: (items: T) => string | null
}

/**
 * The queue for `source` (null for none), shared and cached as above.
 * Returns null until it loads, then the items or an error. While a refetch
 * runs the previous answer stays on screen, so the counter never flashes away.
 */
export function useRecordQueue<T>(
  source: string | null,
  fetcher: (signal: AbortSignal) => Promise<QueueLoad<T>>,
  options: RecordQueueOptions<T> = {},
) {
  const viewerId = useAuthContext().user?.id
  const key = source ? `${viewerId ?? ''}|${source}` : null
  const [state, setState] = useState<{ key: string; load: QueueLoad<T> } | null>(() => {
    // A remembered queue shows at once, so stepping through it never flashes the counter away.
    const load = source ? peekRecordQueue<T>(viewerId, source) : null
    return key && load ? { key, load } : null
  })
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (!source || !key) return
    let active = true
    const { promise, release } = loadRecordQueue(viewerId, source, fetcher)
    void promise.then((load) => {
      if (active && load.status !== 'aborted') setState((current) => (current?.key === key && current.load === load ? current : { key, load }))
    })
    return () => {
      active = false
      release()
    }
  }, [key, revision])
  const current = state?.key === key ? state.load : null
  const visible = current && current.status !== 'aborted' ? current : null
  const stale = visible?.status === 'ready' && options.staleToken ? options.staleToken(visible.items) : null
  const refreshed = useRef<string | null>(null)
  useEffect(() => {
    if (!source || !key || !stale) return
    const mark = `${key}|${stale}`
    // One refetch per disagreement: a list that still disagrees afterwards is not asked again in a loop.
    if (refreshed.current === mark) return
    refreshed.current = mark
    dropRecordQueue(viewerId, source)
    setRevision((value) => value + 1)
  }, [key, stale])
  return visible
}
