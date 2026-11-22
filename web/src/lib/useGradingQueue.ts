import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api, type GradingQueueParams } from './api'
import type { GradingQueueResponse } from '../types/api'

/** Rows per page of the Grading workbench's queue (the server caps it at 100). */
export const GRADING_QUEUE_PAGE_SIZE = 50

export type GradingQueueRequest = Required<Pick<GradingQueueParams, 'filter' | 'sort'>> &
  Pick<GradingQueueParams, 'cohort_id' | 'module_id' | 'student_id' | 'lesson_id' | 'suggestion_outcome'> & { page: number }

/**
 * One page of the Grading workbench's queue (GET /grading_queue). The page, the counts and
 * the filter options come from the server, so they agree however much work is waiting.
 *
 * `focusId` (the open review, on the first load) and `reload(focusId)` (Save and next, a step
 * past the page edge) ask for the page that holds that item; when the server serves another
 * page than the one asked for, `onServedPage` moves the URL there without fetching again.
 * The last page stays on screen while the next one loads.
 */
export function useGradingQueue(request: GradingQueueRequest, focusId: number | null, onServedPage: (page: number) => void) {
  const key = JSON.stringify(request)
  const requestRef = useRef(request)
  const servedRef = useRef(onServedPage)
  useLayoutEffect(() => {
    requestRef.current = request
    servedRef.current = onServedPage
  })
  const initialFocus = useRef(focusId)
  const loadedKey = useRef<string | null>(null)
  const generation = useRef(0)
  const [state, setState] = useState<{ data: GradingQueueResponse | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true })

  const reload = useCallback(async (focus?: number | null) => {
    const current = requestRef.current
    const id = ++generation.current
    setState((previous) => ({ ...previous, loading: true }))
    try {
      const result = await api.getGradingQueue({ ...current, per_page: GRADING_QUEUE_PAGE_SIZE, focus_id: focus ?? null })
      if (id !== generation.current) return
      if (!result.data) {
        setState((previous) => ({ ...previous, loading: false, error: result.error || 'Could not load the grading queue.' }))
        return
      }
      const served = result.data.meta.page
      initialFocus.current = null
      loadedKey.current = JSON.stringify({ ...current, page: served })
      setState({ data: result.data, loading: false, error: result.error || (result.fromCache ? 'Showing saved data. Reconnect to refresh.' : null) })
      if (served !== current.page) servedRef.current(served)
    } catch (error) {
      if (id !== generation.current) return
      setState((previous) => ({ ...previous, loading: false, error: error instanceof Error ? error.message : 'Could not load the grading queue.' }))
    }
  }, [])

  useEffect(() => {
    // The page the server just served (after a focused load): already on screen.
    if (loadedKey.current === key) return
    void reload(initialFocus.current)
  }, [key, reload])
  useEffect(() => () => { generation.current += 1 }, [])

  return { ...state, reload }
}
