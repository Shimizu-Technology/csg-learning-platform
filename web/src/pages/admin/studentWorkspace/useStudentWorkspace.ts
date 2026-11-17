import { Activity, BookOpen, FileCheck2, KeyRound, LifeBuoy, MessageSquareText, UserRound } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useAuthContext } from '../../../contexts/AuthContext'
import { useToast } from '../../../contexts/ToastContext'
import { api } from '../../../lib/api'
import { unavailableResponse } from '../../../lib/loadFailure'
import { forwardReturnState, useReturnContext, type ReturnContext } from '../../../lib/navigationContext'
import { useBackLink } from '../../../lib/recordOrigin'
import { authorizedRoster, queueStep, readRoster, scrollToRecordTop } from '../../../lib/recordQueue'
import { useRecordRelated } from '../../../lib/recordRelated'
import { cohortStudentPath, conversationPath, type StudentWorkspaceTab } from '../../../lib/routes'
import { useRecordViewer } from '../../../lib/useRecordPath'
import { useRecordQueue } from '../../../lib/useRecordQueue'
import { requireSection, useSection } from '../../../lib/useSection'
import type { CohortDetail, StudentProgressResponse } from '../../../types/api'

export const tabs: Array<{ id: StudentWorkspaceTab; label: string; icon: typeof UserRound }> = [
  { id: 'overview', label: 'Overview', icon: UserRound },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'work', label: 'Work', icon: FileCheck2 },
  { id: 'learning', label: 'Learning', icon: BookOpen },
  { id: 'support', label: 'Support', icon: LifeBuoy },
  { id: 'communication', label: 'Communication', icon: MessageSquareText },
  { id: 'access', label: 'Access', icon: KeyRound },
]

export const tabIds = new Set(tabs.map((tab) => tab.id))

export interface WorkspaceData {
  progress: StudentProgressResponse
  cohort: CohortDetail
}

export const STUDENTS_RETURN: ReturnContext = { returnTo: '/admin/students', returnLabel: 'Students' }

/** A roster spanning more cohorts than this is not checked one cohort at a time; it shows no counter. */
export const ROSTER_COHORT_CHECK_LIMIT = 4
export function useStudentWorkspace() {
  const params = useParams<{ cohortId: string; id: string; tab?: string }>()
  const cohortId = Number(params.cohortId)
  const studentId = Number(params.id)
  const activeTab = tabIds.has(params.tab as StudentWorkspaceTab) ? (params.tab as StudentWorkspaceTab) : 'overview'
  const navigate = useNavigate()
  const toast = useToast()
  const location = useLocation()
  // Opened from the students list (or another list): Back returns to that exact filtered list.
  const returnContext = useReturnContext(STUDENTS_RETURN, `student-workspace:${cohortId}:${studentId}`)
  // A student page honours only Activity as a return_to path (route registry); other origins come as router state.
  const back = useBackLink(STUDENTS_RETURN, { scope: `student-workspace:${cohortId}:${studentId}`, accept: 'activity' })
  const viewer = useRecordViewer()
  const related = useRecordRelated('student', Number.isInteger(studentId) && studentId > 0 ? studentId : null, {
    cohortId: Number.isInteger(cohortId) && cohortId > 0 ? cohortId : null,
  })
  // Forward the resolved context (router state or the remembered one) when moving between students and tabs.
  const returnState =
    forwardReturnState(location.state) || (returnContext === STUDENTS_RETURN ? undefined : returnContext)
  // Opened from a filtered student list: Previous/Next walk that list (L-0.7).
  const viewerId = useAuthContext().user?.id
  const roster = useMemo(
    () => (back.fallback ? null : readRoster(viewerId, back.to)),
    [viewerId, back.fallback, back.to],
  )
  // The remembered ids are only what the list showed. Before counting or stepping, keep the ones this
  // viewer can open now: this cohort's students load with the page; other cohorts are fetched with the
  // viewer's own access (shared and briefly cached as they step). Too many cohorts to check: no counter.
  const otherCohorts = useMemo(
    () =>
      Array.from(new Set((roster || []).map((entry) => entry.cohortId)))
        .filter((id) => id !== cohortId)
        .sort((a, b) => a - b),
    [roster, cohortId],
  )
  const rosterCheckable = otherCohorts.length <= ROSTER_COHORT_CHECK_LIMIT
  const otherSource =
    roster?.length && otherCohorts.length && rosterCheckable ? `roster-cohorts:${otherCohorts.join(',')}` : null
  const otherRosters = useRecordQueue<Array<[number, number[]]>>(otherSource, async (signal) => {
    const results = await Promise.all(otherCohorts.map((id) => api.getCohort(id, signal)))
    if (results.some((result) => !result.data || result.error || result.fromCache))
      return { status: 'error', error: 'Roster unavailable.' }
    return {
      status: 'ready',
      items: results.map((result) => [
        result.data!.cohort.id,
        result.data!.cohort.students.map((student) => student.user_id),
      ]),
    }
  })
  const [data, setData] = useState<WorkspaceData | null>(null)
  const checkedRoster = useMemo(() => {
    if (!roster?.length || !data || !rosterCheckable || (otherSource && otherRosters?.status !== 'ready')) return null
    const students = new Map<number, number[]>([[cohortId, data.cohort.students.map((student) => student.user_id)]])
    if (otherRosters?.status === 'ready') otherRosters.items.forEach(([id, ids]) => students.set(id, ids))
    return authorizedRoster(roster, students)
  }, [roster, data, rosterCheckable, otherSource, otherRosters, cohortId])
  const rosterMatch = checkedRoster?.length
    ? queueStep(checkedRoster, (entry) => entry.cohortId === cohortId && entry.userId === studentId)
    : null
  // A student the list didn't show (opened some other way) gets no counter.
  const rosterStep = rosterMatch && rosterMatch.index >= 0 ? rosterMatch : null
  const goToRosterEntry = (entry: { cohortId: number; userId: number }) => {
    navigate(cohortStudentPath(entry.cohortId, entry.userId, activeTab), { state: returnState })
    scrollToRecordTop()
  }
  const [loading, setLoading] = useState(true)
  const [noAccess, setNoAccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openingMessage, setOpeningMessage] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const loadGenerationRef = useRef(0)

  const load = useCallback(
    async (showLoading = true) => {
      const generation = ++loadGenerationRef.current
      if (!Number.isInteger(cohortId) || !Number.isInteger(studentId)) {
        setError('This student page link is invalid.')
        setLoading(false)
        return
      }
      if (showLoading) setLoading(true)
      else setRefreshing(true)
      setError(null)
      try {
        const [progressResult, cohortResult] = await Promise.all([
          api.getStudentProgress(studentId, cohortId),
          api.getCohort(cohortId),
        ])
        if (generation !== loadGenerationRef.current) return
        const denied = unavailableResponse(progressResult) || unavailableResponse(cohortResult)
        setNoAccess(denied)
        if (denied) {
          setData(null)
          setLoading(false)
          setRefreshing(false)
          return
        }
        setData({ progress: requireSection(progressResult), cohort: requireSection(cohortResult).cohort })
        setRefreshError(null)
      } catch {
        if (generation !== loadGenerationRef.current) return
        if (showLoading) setError('Could not load this student page.')
        else setRefreshError("Changes saved, but this page couldn't refresh. The details below may be out of date.")
      }
      setLoading(false)
      setRefreshing(false)
    },
    [cohortId, studentId],
  )

  const scope = `${cohortId}:${studentId}`
  const submissionsSection = useSection(
    scope,
    useCallback(
      async () =>
        requireSection(await api.getSubmissions({ user_id: String(studentId), cohort_id: String(cohortId) }))
          .submissions,
      [studentId, cohortId],
    ),
  )
  const helpSection = useSection(
    scope,
    useCallback(
      async () =>
        requireSection(await api.getHelpRequests({ cohort_id: cohortId, student_id: studentId })).help_requests,
      [cohortId, studentId],
    ),
  )
  const recordingsSection = useSection(
    scope,
    useCallback(
      async () => requireSection(await api.getStudentWatchProgress(studentId, cohortId)).watch_progresses,
      [studentId, cohortId],
    ),
  )
  const videosSection = useSection(
    scope,
    useCallback(
      async () => requireSection(await api.getStudentLessonVideoProgress(studentId, cohortId)).lesson_videos,
      [studentId, cohortId],
    ),
  )
  const enrollmentId = data?.progress.enrollment.id
  const interventionsSection = useSection(
    enrollmentId ? String(enrollmentId) : null,
    useCallback(
      async () => requireSection(await api.getInterventions({ enrollment_id: enrollmentId! })).interventions,
      [enrollmentId],
    ),
  )
  const recoverySection = useSection(
    enrollmentId ? String(enrollmentId) : null,
    useCallback(
      async () => requireSection(await api.getRecoveryPlans({ enrollment_id: enrollmentId! })).recovery_plans,
      [enrollmentId],
    ),
  )
  const refresh = () => {
    void load(false)
    submissionsSection.retry()
    helpSection.retry()
    recordingsSection.retry()
    videosSection.retry()
    interventionsSection.retry()
    recoverySection.retry()
  }

  useEffect(() => {
    void load()
    return () => {
      loadGenerationRef.current += 1
    }
  }, [load])

  useEffect(() => {
    if (
      params.tab &&
      !tabIds.has(params.tab as StudentWorkspaceTab) &&
      Number.isInteger(cohortId) &&
      Number.isInteger(studentId)
    ) {
      navigate(cohortStudentPath(cohortId, studentId), { replace: true })
    }
  }, [cohortId, navigate, params.tab, studentId])

  useEffect(() => {
    if (loading || activeTab !== 'learning' || !['#recordings', '#lesson-videos'].includes(location.hash)) return
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(location.hash.slice(1))
      target?.scrollIntoView({ block: 'start', behavior: 'instant' })
      target?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [activeTab, loading, location.hash])

  async function openDirectMessage() {
    if (!data) return
    setOpeningMessage(true)
    const result = await api.createDirectConversation({ cohort_id: cohortId, user_ids: [studentId] })
    setOpeningMessage(false)
    if (result.data)
      navigate(
        conversationPath(
          { type: 'dm', id: result.data.direct_conversation.id },
          { cohortId, returnTo: `${location.pathname}${location.search}` },
        ),
        { state: { returnTo: `${location.pathname}${location.search}`, returnLabel: data.progress.user.full_name } },
      )
    else toast.error(result.error || 'Could not open a direct message.')
  }

  return {
    params,
    cohortId,
    studentId,
    activeTab,
    navigate,
    location,
    back,
    viewer,
    related,
    returnState,
    data,
    rosterStep,
    goToRosterEntry,
    loading,
    noAccess,
    error,
    openingMessage,
    refreshError,
    refreshing,
    load,
    submissionsSection,
    helpSection,
    recordingsSection,
    videosSection,
    enrollmentId,
    interventionsSection,
    recoverySection,
    refresh,
    openDirectMessage,
  }
}
