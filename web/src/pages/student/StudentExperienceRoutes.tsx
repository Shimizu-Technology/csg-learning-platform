import { Navigate, useLocation, useParams } from 'react-router-dom'
import { useAuthContext } from '../../contexts/AuthContext'
import { useCohortContext } from '../../contexts/CohortContext'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { useStudentExperience } from '../../lib/studentExperience'
import { CourseOutline, Materials, ModuleView } from '../../lib/routePreload'
import { StudentCohortHome } from './StudentCohortHome'

/*
 * Student routes behind the "New student experience" switch. Off renders each
 * page exactly as before; on renders the redesign. Until the cohort's switch
 * is known they show the old page's own loading state, so a cohort with it off
 * never sees the new view, even for a frame.
 */

function learnPath(cohortId: number | null | undefined, extra: Record<string, string> = {}) {
  const search = new URLSearchParams({ ...(cohortId ? { cohort_id: String(cohortId) } : {}), ...extra }).toString()
  return `/materials${search ? `?${search}` : ''}`
}

/** Learn: the one course outline when on (C-2), today's Materials when off. */
export function LearnRoute() {
  const { ready, v2 } = useStudentExperience()
  if (!ready) return <LoadingSpinner message="Loading Learn…" />
  return v2 ? <CourseOutline /> : <Materials />
}

/** A module is a place in Learn's outline when on (S-9, S-1); today's module page when off. */
export function ModuleRoute() {
  const { ready, v2 } = useStudentExperience()
  const { id } = useParams<{ id: string }>()
  const { selectedCohortId } = useCohortContext()
  const location = useLocation()
  if (!ready) return <LoadingSpinner message="Loading module..." />
  if (!v2) return <ModuleView />
  const cohortId = Number(new URLSearchParams(location.search).get('cohort_id')) || selectedCohortId
  return <Navigate replace to={learnPath(cohortId, id && /^[1-9]\d*$/.test(id) ? { module: id } : {})} />
}

/** A learner's cohort page is their course outline when on (C-2); today's cohort home when off. */
export function CohortHomeRoute() {
  const { ready, v2 } = useStudentExperience()
  const { user } = useAuthContext()
  const { id } = useParams<{ id: string }>()
  if (!ready) return <LoadingSpinner message="Loading your cohort…" />
  if (!v2 || user?.is_staff || !id || !/^[1-9]\d*$/.test(id)) return <StudentCohortHome />
  return <Navigate replace to={learnPath(Number(id))} />
}
