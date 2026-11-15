import { useCallback, useContext, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuthContext } from '../contexts/AuthContext'
import { PreviewNavigationContext } from '../contexts/PreviewNavigationContext'
import { learnerPaths, recordPath, type RecordRef, type RecordViewer } from './routes'

/** The viewer whose pages links should open: learner pages inside a staff preview of the learner view. */
export function useRecordViewer(): RecordViewer {
  const { user } = useAuthContext()
  const preview = useContext(PreviewNavigationContext)
  return preview ? 'student' : user
}

/**
 * `recordPath` bound to the signed-in viewer and this page, for code that
 * navigates programmatically or styles a whole row/button as the link.
 * Render a name with `<RecordLink>` instead.
 */
export function useRecordPath() {
  const viewer = useRecordViewer()
  const location = useLocation()
  const currentPage = `${location.pathname}${location.search}`
  return useCallback((ref: RecordRef, options: { returnTo?: string | null } = {}) => recordPath(ref, { viewer, returnTo: options.returnTo === undefined ? currentPage : options.returnTo }), [viewer, currentPage])
}

/** `learnerPaths` for the selected cohort, stable across renders. */
export function useLearnerPaths(cohortId?: number | null) {
  return useMemo(() => learnerPaths(cohortId), [cohortId])
}
