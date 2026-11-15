import { useEffect, useState } from 'react'
import { useAuthContext } from '../contexts/AuthContext'
import { loadRecordQueue, peekRecordQueue, type QueueLoad } from './recordQueueCache'

/**
 * The queue for `source` (null for none), shared and cached as above.
 * Returns null until it loads, then the items or an error.
 */
export function useRecordQueue<T>(source: string | null, fetcher: (signal: AbortSignal) => Promise<QueueLoad<T>>) {
  const viewerId = useAuthContext().user?.id
  const key = source ? `${viewerId ?? ''}|${source}` : null
  const [state, setState] = useState<{ key: string; load: QueueLoad<T> } | null>(() => {
    // A remembered queue shows at once, so stepping through it never flashes the counter away.
    const load = source ? peekRecordQueue<T>(viewerId, source) : null
    return key && load ? { key, load } : null
  })
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
  }, [key])
  const current = state?.key === key ? state.load : null
  return current && current.status !== 'aborted' ? current : null
}
