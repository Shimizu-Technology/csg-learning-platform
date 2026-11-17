import { Navigate, useLocation, useParams } from 'react-router-dom'
import { useAuthContext } from '../../contexts/AuthContext'
import { useCohortContext } from '../../contexts/CohortContext'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { StudentExperienceSwitch } from '../../lib/studentExperience'
import { CourseOutline, Dashboard, Materials, ModuleView, MyWork, StudentToday } from '../../lib/routePreload'
import { StudentCohortHome } from './StudentCohortHome'

/*
 * Student routes behind the "New student experience" switch. Only an explicit
 * on for the cohort renders the redesign; off, unknown or a failed lookup
 * renders each page exactly as before. Until the switch is known they show
 * the old page's own loading state (StudentExperienceSwitch).
 */

function learnPath(cohortId: number | null | undefined, extra: Record<string, string> = {}) {
  const search = new URLSearchParams({ ...(cohortId ? { cohort_id: String(cohortId) } : {}), ...extra }).toString()
  return `/materials${search ? `?${search}` : ''}`
}

/** Learn: the one course outline when on (C-2), today's Materials otherwise. */
export function LearnRoute() {
  return <StudentExperienceSwitch loading={<LoadingSpinner message="Loading Learn…" />} on={<CourseOutline />} off={<Materials />} />
}

/** A module is a place in Learn's outline when on (S-9, S-1); today's module page otherwise. */
export function ModuleRoute() {
  const { id } = useParams<{ id: string }>()
  const { selectedCohortId } = useCohortContext()
  const location = useLocation()
  const cohortId = Number(new URLSearchParams(location.search).get('cohort_id')) || selectedCohortId
  const target = learnPath(cohortId, id && /^[1-9]\d*$/.test(id) ? { module: id } : {})
  return <StudentExperienceSwitch loading={<LoadingSpinner message="Loading module..." />} on={<Navigate replace to={target} />} off={<ModuleView />} />
}

/** A learner's cohort page is their course outline when on (C-2); today's cohort home otherwise. */
export function CohortHomeRoute() {
  const { user } = useAuthContext()
  const { id } = useParams<{ id: string }>()
  if (user?.is_staff || !id || !/^[1-9]\d*$/.test(id)) return <StudentCohortHome />
  return <StudentExperienceSwitch loading={<LoadingSpinner message="Loading your cohort…" />} on={<Navigate replace to={learnPath(Number(id))} />} off={<StudentCohortHome />} />
}

/** Today: the redesigned student Today when on (W8 PR 8.2), today's Today otherwise. Staff go to their own Today. */
export function TodayRoute() {
  const { user } = useAuthContext()
  if (user?.is_staff) return <Dashboard />
  return <StudentExperienceSwitch loading={<LoadingSpinner message="Loading Today…" />} on={<StudentToday />} off={<Dashboard />} />
}

/** My work exists only in the new student experience (L-1.2); otherwise the address goes to Today. */
export function MyWorkRoute() {
  const { user } = useAuthContext()
  const location = useLocation()
  const cohortId = Number(new URLSearchParams(location.search).get('cohort_id')) || null
  if (user?.is_staff) return <Navigate replace to="/admin" />
  return <StudentExperienceSwitch loading={<LoadingSpinner message="Loading My work…" />} on={<MyWork />} off={<Navigate replace to={cohortId ? `/dashboard?cohort_id=${cohortId}` : '/dashboard'} />} />
}
