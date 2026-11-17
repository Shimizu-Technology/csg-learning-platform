import { NoAccess } from '../../components/shared/NoAccess'
import { ReturnOrigin, PreviewLink as Link } from '../../contexts/PreviewNavigationContext'
import { unavailableResponse } from '../../lib/loadFailure'
import { getLatestSubmissionIds } from '../../lib/submissionQueue'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowRight,
  AlertTriangle,
  Activity,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  CircleHelp,
  Clock3,
  ClipboardCheck,
  ExternalLink,
  FileCheck2,
  GitBranch,
  GraduationCap,
  KeyRound,
  LifeBuoy,
  MessageSquareText,
  RefreshCw,
  RotateCcw,
  Target,
  UserRound,
  Video,
} from 'lucide-react'
import { StartFollowUpPlan } from '../../components/admin/StartFollowUpPlan'
import { StudentCommunication } from '../../components/admin/StudentCommunication'
import { StudentLearningPlan } from '../../components/admin/StudentLearningPlan'
import { StudentAccess } from '../../components/admin/StudentAccess'
import { requireSection, SectionBoundary, useSection, type Section } from '../../lib/useSection'
import { RecoveryPlanActions } from '../../components/admin/RecoveryPlanActions'
import { api } from '../../lib/api'
import { cohortPath, cohortStudentPath, helpRequestPath, interventionPath, submissionPath, type StudentWorkspaceTab, cohortStudentViewPath, conversationPath } from '../../lib/routes'
import { formatShortDateTime } from '../../lib/format'
import { lessonsLabel } from '../../lib/progressLabel'
import { StatusBadge as LessonStatusBadge } from '../../components/shared/StatusBadge'
import { TERMS, humanize } from '../../lib/glossary'
import { followUpLabel } from '../../lib/followUpLabels'
import { forwardReturnState, useReturnContext, type ReturnContext } from '../../lib/navigationContext'
import { useBackLink } from '../../lib/recordOrigin'
import { authorizedRoster, queuePositionLabel, queueStep, readRoster, scrollToRecordTop } from '../../lib/recordQueue'
import { useRecordQueue } from '../../lib/useRecordQueue'
import { useAuthContext } from '../../contexts/AuthContext'
import { relatedRows, useRecordRelated } from '../../lib/recordRelated'
import { useRecordViewer } from '../../lib/useRecordPath'
import { RecordHeader, staffBreadcrumb } from '../../components/shared/RecordHeader'
import { RelatedPanel } from '../../components/shared/RelatedPanel'
import type { ReactNode } from 'react'
import { Button, LinkButton } from '../../components/ui/Button'
import { Avatar } from '../../components/ui/Avatar'
import { Badge, type BadgeTone } from '../../components/ui/Badge'
import { useToast } from '../../contexts/ToastContext'
import { EmptyState } from '../../components/shared/EmptyState'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { ActivityTimeline } from '../../components/shared/ActivityTimeline'
import { ProgressBar } from '../../components/shared/ProgressBar'
import { markdownExcerpt } from '../../lib/plainText'
import type {
  CohortDetail,
  HelpRequest,
  StudentLessonVideoProgress,
  StudentProgressResponse,
  StudentRecordingProgress,
  Submission,
  Intervention,
  RecoveryPlan,
  LearningInsights,
  LearningEvidenceStatus,
} from '../../types/api'
import { RecordLink } from '../../components/shared/RecordLink'

const EVIDENCE_KIND_LABELS: Record<string, string> = { knowledge_check: 'Checkpoint', rubric_criterion: 'Rubric rating', aligned_submission: 'Graded submission' }

const tabs: Array<{ id: StudentWorkspaceTab; label: string; icon: typeof UserRound }> = [
  { id: 'overview', label: 'Overview', icon: UserRound },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'work', label: 'Work', icon: FileCheck2 },
  { id: 'learning', label: 'Learning', icon: BookOpen },
  { id: 'support', label: 'Support', icon: LifeBuoy },
  { id: 'communication', label: 'Communication', icon: MessageSquareText },
  { id: 'access', label: 'Access', icon: KeyRound },
]

const tabIds = new Set(tabs.map((tab) => tab.id))

interface WorkspaceData {
  progress: StudentProgressResponse
  cohort: CohortDetail
}

const STUDENTS_RETURN: ReturnContext = { returnTo: '/admin/students', returnLabel: 'Students' }

export function StudentWorkspace() {
  const { cohortId, id } = useParams()
  return <Workspace key={`${cohortId}:${id}`} />
}

/** A roster spanning more cohorts than this is not checked one cohort at a time; it shows no counter. */
const ROSTER_COHORT_CHECK_LIMIT = 4

function Workspace() {
  const params = useParams<{ cohortId: string; id: string; tab?: string }>()
  const cohortId = Number(params.cohortId)
  const studentId = Number(params.id)
  const activeTab = tabIds.has(params.tab as StudentWorkspaceTab) ? params.tab as StudentWorkspaceTab : 'overview'
  const navigate = useNavigate()
  const toast = useToast()
  const location = useLocation()
  // Opened from the students list (or another list): Back returns to that exact filtered list.
  const returnContext = useReturnContext(STUDENTS_RETURN, `student-workspace:${cohortId}:${studentId}`)
  // A student page honours only Activity as a return_to path (route registry); other origins come as router state.
  const back = useBackLink(STUDENTS_RETURN, { scope: `student-workspace:${cohortId}:${studentId}`, accept: 'activity' })
  const viewer = useRecordViewer()
  const related = useRecordRelated('student', Number.isInteger(studentId) && studentId > 0 ? studentId : null, { cohortId: Number.isInteger(cohortId) && cohortId > 0 ? cohortId : null })
  // Forward the resolved context (router state or the remembered one) when moving between students and tabs.
  const returnState = forwardReturnState(location.state) || (returnContext === STUDENTS_RETURN ? undefined : returnContext)
  // Opened from a filtered student list: Previous/Next walk that list (L-0.7).
  const viewerId = useAuthContext().user?.id
  const roster = useMemo(() => (back.fallback ? null : readRoster(viewerId, back.to)), [viewerId, back.fallback, back.to])
  // The remembered ids are only what the list showed. Before counting or stepping, keep the ones this
  // viewer can open now: this cohort's students load with the page; other cohorts are fetched with the
  // viewer's own access (shared and briefly cached as they step). Too many cohorts to check: no counter.
  const otherCohorts = useMemo(() => Array.from(new Set((roster || []).map((entry) => entry.cohortId))).filter((id) => id !== cohortId).sort((a, b) => a - b), [roster, cohortId])
  const rosterCheckable = otherCohorts.length <= ROSTER_COHORT_CHECK_LIMIT
  const otherSource = roster?.length && otherCohorts.length && rosterCheckable ? `roster-cohorts:${otherCohorts.join(',')}` : null
  const otherRosters = useRecordQueue<Array<[number, number[]]>>(otherSource, async (signal) => {
    const results = await Promise.all(otherCohorts.map((id) => api.getCohort(id, signal)))
    if (results.some((result) => !result.data || result.error || result.fromCache)) return { status: 'error', error: 'Roster unavailable.' }
    return { status: 'ready', items: results.map((result) => [result.data!.cohort.id, result.data!.cohort.students.map((student) => student.user_id)]) }
  })
  const [data, setData] = useState<WorkspaceData | null>(null)
  const checkedRoster = useMemo(() => {
    if (!roster?.length || !data || !rosterCheckable || (otherSource && otherRosters?.status !== 'ready')) return null
    const students = new Map<number, number[]>([[cohortId, data.cohort.students.map((student) => student.user_id)]])
    if (otherRosters?.status === 'ready') otherRosters.items.forEach(([id, ids]) => students.set(id, ids))
    return authorizedRoster(roster, students)
  }, [roster, data, rosterCheckable, otherSource, otherRosters, cohortId])
  const rosterMatch = checkedRoster?.length ? queueStep(checkedRoster, (entry) => entry.cohortId === cohortId && entry.userId === studentId) : null
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

  const load = useCallback(async (showLoading = true) => {
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
        api.getStudentProgress(studentId, cohortId), api.getCohort(cohortId),
      ])
      if (generation !== loadGenerationRef.current) return
      const denied = unavailableResponse(progressResult) || unavailableResponse(cohortResult)
      setNoAccess(denied)
      if (denied) { setData(null); setLoading(false); setRefreshing(false); return }
      setData({ progress: requireSection(progressResult), cohort: requireSection(cohortResult).cohort })
      setRefreshError(null)
    } catch {
      if (generation !== loadGenerationRef.current) return
      if (showLoading) setError('Could not load this student page.')
      else setRefreshError("Changes saved, but this page couldn't refresh. The details below may be out of date.")
    }
    setLoading(false)
    setRefreshing(false)
  }, [cohortId, studentId])

  const scope = `${cohortId}:${studentId}`
  const submissionsSection = useSection(scope, useCallback(async () => requireSection(await api.getSubmissions({ user_id: String(studentId), cohort_id: String(cohortId) })).submissions, [studentId, cohortId]))
  const helpSection = useSection(scope, useCallback(async () => requireSection(await api.getHelpRequests({ cohort_id: cohortId, student_id: studentId })).help_requests, [cohortId, studentId]))
  const recordingsSection = useSection(scope, useCallback(async () => requireSection(await api.getStudentWatchProgress(studentId, cohortId)).watch_progresses, [studentId, cohortId]))
  const videosSection = useSection(scope, useCallback(async () => requireSection(await api.getStudentLessonVideoProgress(studentId, cohortId)).lesson_videos, [studentId, cohortId]))
  const enrollmentId = data?.progress.enrollment.id
  const interventionsSection = useSection(enrollmentId ? String(enrollmentId) : null, useCallback(async () => requireSection(await api.getInterventions({ enrollment_id: enrollmentId! })).interventions, [enrollmentId]))
  const recoverySection = useSection(enrollmentId ? String(enrollmentId) : null, useCallback(async () => requireSection(await api.getRecoveryPlans({ enrollment_id: enrollmentId! })).recovery_plans, [enrollmentId]))
  const refresh = () => {
    void load(false)
    submissionsSection.retry(); helpSection.retry(); recordingsSection.retry(); videosSection.retry(); interventionsSection.retry(); recoverySection.retry()
  }

  useEffect(() => {
    void load()
    return () => { loadGenerationRef.current += 1 }
  }, [load])

  useEffect(() => {
    if (params.tab && !tabIds.has(params.tab as StudentWorkspaceTab) && Number.isInteger(cohortId) && Number.isInteger(studentId)) {
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
    if (result.data) navigate(conversationPath({ type: 'dm', id: result.data.direct_conversation.id }, { cohortId, returnTo: `${location.pathname}${location.search}` }), { state: { returnTo: `${location.pathname}${location.search}`, returnLabel: data.progress.user.full_name } })
    else toast.error(result.error || 'Could not open a direct message.')
  }

  if (noAccess) return <NoAccess />
  if (loading) return <LoadingSpinner message="Loading student…" />
  if (!data || error) {
    return (
      <div className="app-page">
        <EmptyState icon={UserRound} title="Could not open this student page" description={error || 'The enrollment could not be found.'} action={<Button onClick={() => void load()}><RefreshCw className="h-4 w-4" />Try again</Button>} />
      </div>
    )
  }

  const { progress, cohort } = data
  // The API scopes history to this enrollment, including work retained after a curriculum change.
  const submissions = submissionsSection.data || []
  const helpRequests = helpSection.data || []
  const recordings = recordingsSection.data || []
  const lessonVideos = videosSection.data || []
  const interventions = interventionsSection.data || []
  const recoveryPlans = recoverySection.data || []
  const studentIndex = cohort.students.findIndex((student) => student.user_id === studentId)
  const previousStudent = studentIndex > 0 ? cohort.students[studentIndex - 1] : null
  const nextStudent = studentIndex >= 0 && studentIndex < cohort.students.length - 1 ? cohort.students[studentIndex + 1] : null
  const ungraded = progress.status?.ungraded_count
  const openHelp = progress.status?.help_request_count
  const nextReview = progress.status?.next_review_submission_id
  const currentPath = `${location.pathname}${location.search}`


  return (
    <ReturnOrigin label={progress.user.full_name}><div className="app-page-wide space-y-6">
      {refreshError && <div role="alert" className="app-surface flex flex-wrap items-center justify-between gap-3 border-warning-line p-4 text-sm text-warning-ink"><p>{refreshError}</p><Button variant="secondary" aria-label="Retry refreshing this page" disabled={refreshing} onClick={() => void load(false)}>{refreshing ? 'Refreshing…' : 'Retry'}</Button></div>}
      <RecordHeader
        back={back}
        breadcrumb={staffBreadcrumb({ cohort: { label: cohort.name, to: cohortPath(cohortId) }, record: progress.user.full_name })}
        type={<>Student · {cohort.curriculum_name}</>}
        queue={rosterStep ? {
          position: queuePositionLabel(rosterStep),
          onPrevious: rosterStep.previous ? () => goToRosterEntry(rosterStep.previous!) : undefined,
          onNext: rosterStep.next ? () => goToRosterEntry(rosterStep.next!) : undefined,
          previousLabel: 'Previous student',
          nextLabel: 'Next student',
          direction: 'horizontal',
        } : undefined}
        leading={<Avatar name={progress.user.full_name} src={progress.user.avatar_url} size="lg" />}
        title={progress.user.full_name}
        titleText={progress.user.full_name}
        status={<>{progress.status && progress.enrollment.status === 'active'
          ? <Badge tone={progress.status.needs_attention ? 'warning' : 'success'}>{progress.status.label}</Badge>
          : <StatusBadge status={progress.enrollment.status} />}</>}
        context={<>
          <span className="max-w-full truncate" title={progress.user.email}>{progress.user.email}</span>
          <span aria-hidden="true">·</span>
          <RecordLink record={{ type: 'cohort', id: cohortId }} variant="plain" touchTarget className="font-normal text-ink-muted">{cohort.name}</RecordLink>
          {'last_active_at' in progress.user && <><span aria-hidden="true">·</span><span className="tabular-nums">{progress.user.last_active_at ? `Last active ${formatShortDateTime(progress.user.last_active_at)}` : 'No learning activity yet'}</span></>}
        </>}
        actions={<>
          <Button size="sm" onClick={() => void openDirectMessage()} disabled={openingMessage || progress.can_message === false}><MessageSquareText className="h-4 w-4" aria-hidden="true" />{openingMessage ? 'Opening…' : 'Message'}</Button>
          {nextReview && <LinkButton size="sm" to={`/admin/grading?${new URLSearchParams({ cohort_id: String(cohortId), student_id: String(studentId), submission: String(nextReview), return_to: currentPath })}`} variant="secondary"><FileCheck2 className="h-4 w-4" aria-hidden="true" />Grade next ({ungraded})</LinkButton>}
          <StartFollowUpPlan activePlanId={progress.status?.active_intervention_id} enrollmentId={progress.enrollment.id} studentName={progress.user.full_name} returnTo={currentPath} />
        </>}
      >
        <div className="flex flex-wrap items-center gap-3">
          <LinkButton size="sm" to={cohortStudentViewPath(cohortId, studentId)} variant="quiet"><ExternalLink className="h-4 w-4" aria-hidden="true" />View as student</LinkButton>
          {(progress.enrollments?.length || 0) > 1 && <label className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-semibold text-ink-secondary">Enrollment<select aria-label="Switch student enrollment" className="app-control max-w-full" value={cohortId} onChange={event => navigate(cohortStudentPath(Number(event.target.value), studentId, activeTab), { state: returnState })}>{progress.enrollments!.map(enrollment => <option key={enrollment.id} value={enrollment.cohort_id}>{enrollment.cohort_name} · {humanize(enrollment.status)}</option>)}</select></label>}
        </div>
      </RecordHeader>

      {progress.status?.needs_attention && <section role="note" aria-labelledby="why-flagged" className="flex gap-3 rounded-2xl border border-warning-line bg-warning-soft p-4 sm:p-5"><AlertTriangle className="mt-1 h-5 w-5 shrink-0 text-warning-ink" aria-hidden="true" /><div className="min-w-0"><h2 id="why-flagged" className="font-bold text-warning-ink">Why flagged</h2><p className="mt-1 text-sm font-semibold text-ink">{progress.status.label}</p><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-secondary">{progress.status.reasons.map(reason => <li key={reason.code}>{reason.label}</li>)}</ul></div></section>}

      <section className="app-surface overflow-hidden">
        <div className="grid items-center gap-2 bg-surface-sunken px-4 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(180px,260px)_minmax(0,1fr)] sm:px-6">
          <StudentStepper direction="previous" student={previousStudent} cohortId={cohortId} tab={activeTab} state={returnState} />
          <label className="grid gap-1 text-center text-xs font-semibold tabular-nums text-ink-muted"><span>{studentIndex >= 0 ? `Student ${studentIndex + 1} of ${cohort.students.length}` : 'Historical enrollment'}</span><select aria-label={`Switch student in ${cohort.name}`} value={studentId} onChange={(event) => navigate(cohortStudentPath(cohortId, Number(event.target.value), activeTab), { state: returnState })} className="app-control w-full font-semibold">{cohort.students.map((student) => <option key={student.enrollment_id} value={student.user_id}>{student.full_name || student.email}</option>)}</select></label>
          <StudentStepper direction="next" student={nextStudent} cohortId={cohortId} tab={activeTab} state={returnState} />
        </div>
      </section>

      <nav aria-label="Student page sections" className="overflow-x-auto border-b border-line">
        <div className="flex min-w-max gap-1">
          {tabs.map(({ id, label, icon: Icon }) => (
            <NavLink key={id} to={cohortStudentPath(cohortId, studentId, id)} state={returnState} className={({ isActive }) => `inline-flex min-h-11 items-center gap-2 px-3 text-sm font-semibold transition-colors duration-150 ${isActive || activeTab === id && !params.tab ? 'tab-selected' : 'text-ink-secondary hover:bg-surface-sunken hover:text-ink'}`}>
              <Icon className="h-4 w-4" aria-hidden="true" />{label}
              {id === 'work' && ungraded !== undefined && ungraded > 0 && <CountBadge count={ungraded!} />}
              {id === 'support' && openHelp !== undefined && openHelp > 0 && <CountBadge count={openHelp!} tone="warning" />}
              {id === 'support' && Boolean(progress.status?.active_intervention_count) && <CountBadge count={progress.status!.active_intervention_count} />}
            </NavLink>
          ))}
        </div>
      </nav>

      {activeTab === 'overview' && <OverviewTab aside={<RelatedPanel rows={related.related ? relatedRows(related.related, { viewer, returnTo: `${location.pathname}${location.search}`, actions: { message: () => void openDirectMessage() } }) : []} loading={related.loading} error={related.error} onRetry={related.retry} returnLabel={progress.user.full_name} />} sections={{ submissions: submissionsSection, help: helpSection, recordings: recordingsSection, videos: videosSection }} progress={progress} submissions={submissions} helpRequests={helpRequests} cohortId={cohortId} studentId={studentId} />}
      {activeTab === 'activity' && <ActivityTimeline userId={studentId} cohortId={cohortId} />}
      {activeTab === 'work' && <SectionBoundary section={submissionsSection} label="Submissions"><WorkTab submissions={submissions} cohortId={cohortId} studentId={studentId} returnTo={location.pathname} /></SectionBoundary>}
      {activeTab === 'learning' && <><StudentLearningPlan cohortId={cohortId} key={progress.enrollment.id} enrollmentId={progress.enrollment.id} onSaved={refresh} /><LearningTab recordingsSection={recordingsSection} videosSection={videosSection} recordings={recordings} lessonVideos={lessonVideos} progress={progress} cohortId={cohortId} studentId={studentId} returnTo={location.pathname} /></>}
      {activeTab === 'support' && <SupportTab sections={{ help: helpSection, interventions: interventionsSection, recovery: recoverySection }} requests={helpRequests} interventions={interventions} recoveryPlans={recoveryPlans} cohortId={cohortId} studentId={studentId} onSaved={(plan) => recoverySection.update((plans) => plans.map((item) => item.id === plan.id ? plan : item))} />}
      {activeTab === 'communication' && <StudentCommunication cohortId={cohortId} studentId={studentId} studentName={progress.user.full_name} opening={openingMessage} onOpen={() => void openDirectMessage()} />}
      {activeTab === 'access' && <StudentAccess progress={progress} cohort={cohort} onSaved={refresh} />}
    </div></ReturnOrigin>
  )
}

function OverviewTab({ aside, sections, progress, submissions, helpRequests, cohortId, studentId }: { aside?: ReactNode; sections: { submissions: Section<Submission[]>; help: Section<HelpRequest[]>; recordings: Section<StudentRecordingProgress[]>; videos: Section<StudentLessonVideoProgress[]> }; progress: StudentProgressResponse; submissions: Submission[]; helpRequests: HelpRequest[]; cohortId: number; studentId: number }) {
  const ungraded = progress.status?.ungraded_count
  const redo = progress.status?.redo_count
  const openHelp = progress.status?.help_request_count
  const learningPath = cohortStudentPath(cohortId, studentId, 'learning')
  const workPath = cohortStudentPath(cohortId, studentId, 'work')
  const location = useLocation()
  const currentPath = `${location.pathname}${location.search}`
  const queueParams = new URLSearchParams({ cohort_id: String(cohortId), student_id: String(studentId), return_to: currentPath })
  const supportPath = `/admin/support?${queueParams}&view=active`
  const media = progress.media_summary
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
        <MetricCard to={learningPath} icon={GraduationCap} label="Learning progress" value={`${progress.overall_progress.percentage}%`} detail={lessonsLabel(progress.overall_progress)} tone="neutral" />
        <MetricCard to={`/admin/grading?${queueParams}&filter=ungraded`} icon={FileCheck2} label="Work waiting" value={ungraded === undefined ? 'Unavailable' : String(ungraded)} detail="Waiting for review" tone={ungraded ? 'pending' : 'neutral'} />
        <MetricCard to={`${workPath}?filter=redo`} icon={RotateCcw} label="Redo open" value={redo === undefined ? 'Unavailable' : String(redo)} detail={redo ? 'Redo requested' : 'No redo requests'} tone={redo ? 'warning' : 'neutral'} />
        <MetricCard to={supportPath} icon={CircleHelp} label="Open support" value={openHelp === undefined ? 'Unavailable' : String(openHelp)} detail="Help requests" tone={openHelp ? 'warning' : 'neutral'} />
        <SectionBoundary section={sections.recordings} label="Recordings"><MetricCard to={`${learningPath}#recordings`} icon={Video} label="Recordings completed" value={media ? `${media.recordings_completed}/${media.recordings_total}` : 'Unavailable'} detail="Class recordings" tone="neutral" /></SectionBoundary>
        <SectionBoundary section={sections.videos} label="Lesson videos"><MetricCard to={`${learningPath}#lesson-videos`} icon={Video} label="Lesson videos completed" value={media ? `${media.lesson_videos_completed}/${media.lesson_videos_total}` : 'Unavailable'} detail="Assigned lesson videos" tone="neutral" /></SectionBoundary>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.8fr)]">
        <section className="app-surface p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-bold text-ink">Learning at a glance</h2><Link className="app-link text-sm" to={cohortStudentPath(cohortId, studentId, 'learning')}>All modules</Link></div>
          <div className="mt-5"><ProgressBar value={progress.overall_progress.percentage} size="md" /></div>
          <div className="mt-5 space-y-3">{progress.modules.map((mod) => <div key={mod.id} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px_auto] sm:items-center"><p className="truncate text-sm font-semibold text-ink" title={mod.name}><RecordLink record={{ type: 'module', id: mod.id, cohortId }} variant="plain" touchTarget truncate>{mod.name}</RecordLink></p><ProgressBar value={mod.progress_percentage} size="sm" /><span className="text-xs font-semibold tabular-nums text-ink-muted">{lessonsLabel(mod)}</span></div>)}</div>
        </section>
        <div className="space-y-3">{aside}{(sections.submissions.status !== 'success' || sections.help.status !== 'success') && <p className="text-sm text-ink-muted">Recent events are incomplete while work or help is unavailable.</p>}<ComposedTimeline incomplete={sections.submissions.status !== 'success' || sections.help.status !== 'success'} progress={progress} submissions={submissions} helpRequests={helpRequests} cohortId={cohortId} studentId={studentId} /></div>
      </div>
    </div>
  )
}

function ComposedTimeline({ incomplete, progress, submissions, helpRequests, cohortId, studentId }: { incomplete: boolean; progress: StudentProgressResponse; submissions: Submission[]; helpRequests: HelpRequest[]; cohortId: number; studentId: number }) {
  const workspacePath = cohortStudentPath(cohortId, studentId, 'overview')
  // A submitted step also has a completed progress record; the submission row
  // already says so, so it isn't listed twice (U-0.5).
  const submittedBlocks = new Set(submissions.map((submission) => submission.content_block_id))
  const events = [
    ...progress.recent_activity.filter((activity) => !submittedBlocks.has(activity.content_block_id)).map((activity) => ({ id: `progress-${activity.content_block_id}-${activity.completed_at}`, at: activity.completed_at, title: activity.block_title || 'Learning checkpoint', detail: 'Completed learning checkpoint', path: cohortStudentPath(cohortId, studentId, 'learning'), icon: CheckCircle2, tone: 'success' as const })),
    ...submissions.map((submission) => ({ id: `submission-${submission.id}`, at: submission.created_at, title: submission.content_block_title, detail: submission.grade === null ? 'Waiting for review' : submission.grade === 'R' ? 'Redo requested' : `Graded ${submission.grade}`, path: submissionPath(submission.id, { cohortId, userId: studentId, returnTo: workspacePath }), icon: FileCheck2, tone: submission.grade === 'R' ? 'warning' as const : submission.grade === null ? 'pending' as const : 'neutral' as const })),
    ...helpRequests.map((request) => ({ id: `help-${request.id}`, at: request.created_at, title: request.context_label, detail: request.status === 'resolved' ? 'Support request resolved' : `Asked for ${request.urgency === 'urgent' ? 'urgent ' : ''}help`, path: helpRequestPath(request.id, workspacePath), icon: LifeBuoy, tone: request.urgency === 'urgent' ? 'danger' as const : 'warning' as const })),
  ].filter((event) => event.at).sort((a, b) => new Date(b.at!).getTime() - new Date(a.at!).getTime()).slice(0, 8)
  const tones = { success: 'bg-success-soft text-success-ink', neutral: 'bg-surface-sunken text-ink-secondary', pending: 'bg-surface-sunken text-ink-secondary', warning: 'bg-warning-soft text-warning-ink', danger: 'bg-danger-soft text-danger-ink' }
  return <section className="app-surface p-5 sm:p-6"><h2 className="text-lg font-bold text-ink">Connected activity</h2><p className="mt-1 text-xs text-ink-muted">Learning, submissions, and support in one timeline.</p>{events.length ? <ol className="mt-4 space-y-1">{events.map((event) => <li key={event.id}><Link to={event.path} className="group pressable flex min-h-11 gap-3 rounded-xl px-1 py-2 hover:bg-surface-sunken"><span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${tones[event.tone]}`}><event.icon className="h-4 w-4" aria-hidden="true" /></span><div className="min-w-0"><p className="truncate text-sm font-semibold text-ink group-hover:underline" title={event.title ?? undefined}>{event.title}</p><p className="text-xs tabular-nums text-ink-muted">{event.detail} · {formatShortDateTime(event.at)}</p></div></Link></li>)}</ol> : <p className="mt-4 text-sm text-ink-muted">{incomplete ? 'Some activity sources are unavailable. Retry above to see the full history.' : 'No connected activity yet.'}</p>}</section>
}

function WorkTab({ submissions, cohortId, studentId, returnTo }: { submissions: Submission[]; cohortId: number; studentId: number; returnTo: string }) {
  const [params] = useSearchParams()
  const latestIds = getLatestSubmissionIds(submissions)
  const filter = params.get('filter')
  const visible = ['ungraded', 'redo'].includes(filter || '') ? submissions.filter(item => latestIds.has(item.id) && (filter === 'redo' ? item.grade === 'R' : item.grade === null)) : submissions
  const exactReturn = `${returnTo}${params.size ? `?${params.toString()}` : ''}`
  if (!visible.length) return <EmptyState icon={FileCheck2} title={filter ? "No matching work" : "No submitted work yet"} description="Work this student submits in this curriculum will appear here." action={<LinkButton variant="secondary" to={returnTo}>All submitted work</LinkButton>} />
  return <section className="app-surface overflow-hidden"><div className="border-b border-line px-5 py-4 sm:px-6"><h2 className="text-lg font-bold text-ink">All submitted work</h2><p className="mt-1 text-sm text-ink-muted">Open a submission. Back returns you to this page.</p><Link className="app-link inline-flex min-h-11 items-center text-sm" to={returnTo}>All submitted work</Link></div><div className="divide-y divide-line">{visible.map((submission) => <Link key={submission.id} to={submissionPath(submission.id, { cohortId, userId: studentId, returnTo: exactReturn })} className="group pressable grid min-h-11 gap-3 px-5 py-4 hover:bg-surface-sunken sm:grid-cols-[minmax(0,1fr)_180px_auto] sm:items-center sm:px-6"><div className="min-w-0"><p className="font-semibold text-ink [overflow-wrap:anywhere]">{submission.content_block_title}</p><p className="text-sm text-ink-muted [overflow-wrap:anywhere]">{submission.module_name} · {submission.lesson_title}</p></div><div><SubmissionStatus submission={submission} /><p className="mt-1 text-xs tabular-nums text-ink-muted">{formatShortDateTime(submission.created_at)}</p></div><ChevronRight className="h-4 w-4 text-ink-muted transition-colors duration-150 group-hover:text-ink" aria-hidden="true" /></Link>)}</div></section>
}

function LearningTab({ recordingsSection, videosSection, recordings, lessonVideos, progress, cohortId, studentId, returnTo }: { recordingsSection: Section<StudentRecordingProgress[]>; videosSection: Section<StudentLessonVideoProgress[]>; recordings: StudentRecordingProgress[]; lessonVideos: StudentLessonVideoProgress[]; progress: StudentProgressResponse; cohortId: number; studentId: number; returnTo: string }) {
  return <div className="space-y-6">
    <section tabIndex={-1} id="recordings" className="app-surface scroll-mt-24 p-5"><h2 className="font-bold text-ink">Class recordings</h2><SectionBoundary section={recordingsSection} label="Recordings">{recordings.length ? recordings.map(recording => <Link key={recording.recording_id} to={`/recordings?cohort_id=${cohortId}&recording=${recording.recording_id}`} className="app-link block min-h-11 py-3">{recording.recording_title} · {recording.completed ? 'Complete' : 'In progress'}</Link>) : <p className="mt-3 text-sm text-ink-muted">No class recordings yet.</p>}</SectionBoundary></section>
    <section tabIndex={-1} id="lesson-videos" className="app-surface scroll-mt-24 p-5"><h2 className="font-bold text-ink">Lesson videos</h2><SectionBoundary section={videosSection} label="Lesson videos">{lessonVideos.length ? lessonVideos.map(video => { const lesson = progress.modules.flatMap(module => module.lessons).find(lesson => lesson.blocks.some(block => block.id === video.content_block_id)); return <p key={video.content_block_id} className="py-2 text-sm text-ink-secondary">{lesson ? <RecordLink record={{ type: 'lesson', id: lesson.id, cohortId, anchor: `block-${video.content_block_id}`, view: 'learn' }} touchTarget>{video.title}</RecordLink> : video.title} · {video.completed ? 'Complete' : 'In progress'}</p> }) : <p className="mt-3 text-sm text-ink-muted">No lesson videos yet.</p>}</SectionBoundary></section>
    <StudentObjectiveEvidence cohortId={cohortId} studentId={studentId} returnTo={returnTo} />
    <div className="space-y-4">{progress.modules.map((mod) => <details key={mod.id} className="app-surface overflow-hidden" open={mod.progress_percentage > 0 && mod.progress_percentage < 100}><summary className="min-h-16 cursor-pointer px-5 py-4 sm:px-6"><div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px_auto] sm:items-center"><div className="min-w-0"><h2 className="text-base font-semibold text-ink [overflow-wrap:anywhere]">{mod.name}</h2><p className="text-xs tabular-nums text-ink-muted">{lessonsLabel(mod)}</p></div><ProgressBar value={mod.progress_percentage} size="sm" /><span className="text-sm font-semibold tabular-nums text-ink-secondary">{mod.progress_percentage}%</span></div></summary><div className="divide-y divide-line border-t border-line">{mod.lessons.map((lesson) => <div key={lesson.id} className="px-5 py-4 sm:px-6"><div className="flex flex-wrap items-center justify-between gap-2"><div className="min-w-0"><p className="font-semibold text-ink [overflow-wrap:anywhere]"><RecordLink record={{ type: 'lesson', id: lesson.id, cohortId }} variant="plain" touchTarget>{lesson.title}</RecordLink></p><p className="text-xs tabular-nums text-ink-muted">{lesson.assigned === false ? 'Not currently assigned · Saved evidence' : `${lesson.completed_blocks}/${lesson.total_blocks} checkpoints · ${lesson.available ? 'Available' : 'Locked'}`}</p></div>{lesson.learner_status ? <LessonStatusBadge status={lesson.learner_status} /> : lesson.completed && <Badge tone="success" icon={<CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}>Complete</Badge>}</div><div className="mt-3 grid gap-2 sm:grid-cols-2">{lesson.blocks.map((block) => block.submission ? <Link key={block.id} to={submissionPath(block.submission.id, { cohortId, userId: studentId, returnTo })} className="pressable flex min-h-11 items-center justify-between gap-2 rounded-xl border border-line px-3 py-2 text-sm hover:border-line-strong hover:bg-surface-sunken"><span className="min-w-0 truncate font-semibold text-ink" title={block.title}>{block.title}</span><SubmissionStatus submission={{ grade: block.submission.grade } as Submission} /></Link> : <div key={block.id} className="flex min-h-11 items-center justify-between gap-2 rounded-xl bg-surface-sunken px-3 py-2 text-sm"><span className="min-w-0 truncate font-semibold text-ink-secondary" title={block.title}>{block.title}</span><span className="shrink-0 text-xs font-semibold capitalize text-ink-muted">{block.status.replace('_', ' ')}</span></div>)}</div></div>)}</div></details>)}</div>
  </div>
}

function StudentObjectiveEvidence({ cohortId, studentId, returnTo }: { cohortId: number; studentId: number; returnTo: string }) {
  const [searchParams] = useSearchParams()
  const selectedObjectiveId = Number(searchParams.get('objective')) || null
  const evidenceReturnTo = selectedObjectiveId ? `${returnTo}?objective=${selectedObjectiveId}` : returnTo
  const [insights, setInsights] = useState<LearningInsights | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const result = await api.getLearningInsights(cohortId, studentId)
    if (result.data) setInsights(result.data.learning_insights)
    else setError(result.error || 'Could not load objective evidence.')
    setLoading(false)
  }, [cohortId, studentId])

  useEffect(() => { void load() }, [load])
  if (loading) return <section className="app-surface p-5"><p className="text-sm font-semibold text-ink-muted">Loading objective evidence…</p></section>
  if (!insights) return <section className="app-surface p-5"><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-ink-secondary">{error || 'Learning objectives couldn’t load.'}</p><Button variant="secondary" onClick={() => void load()}><RefreshCw className="h-4 w-4" aria-hidden="true" />Try again</Button></div></section>

  return <section className="app-surface overflow-hidden"><div className="border-b border-line px-5 py-4 sm:px-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold text-ink-muted">Learning objectives</p><h2 className="mt-1 text-lg font-bold text-ink">Progress on each objective</h2><p className="mt-1 text-sm text-ink-muted">Rubric ratings and graded work can show an objective is met. Checkpoint answers alone count as developing. Completed lessons and watch time don’t count.</p></div><Link to={cohortPath(cohortId, 'insights')} className="app-link inline-flex min-h-11 items-center gap-1 text-sm">Whole cohort <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link></div></div><div className="divide-y divide-line">{insights.objectives.map((objective) => {
    const student = objective.students[0]
    return <details key={objective.id} open={selectedObjectiveId === objective.id || student.status === 'needs_revision'} className="group scroll-mt-24"><summary className="min-h-11 cursor-pointer list-none px-5 py-4 transition-colors duration-150 hover:bg-surface-sunken sm:px-6"><div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2"><span className="shrink-0 rounded-lg bg-surface-sunken px-2 py-1 font-mono text-xs font-semibold text-ink-secondary">{objective.code}</span><h3 className="text-base font-semibold text-ink">{objective.title}</h3></div><p className="mt-1 text-sm text-ink-muted">{objective.success_criteria}</p></div><EvidenceStatus status={student.status} /></div></summary><div className="border-t border-line bg-surface-sunken px-5 py-4 sm:px-6">{student.evidence.length ? <div className="grid gap-2">{student.evidence.map((evidence) => evidence.submission_id ? <Link key={evidence.id} to={submissionPath(evidence.submission_id, { cohortId, userId: studentId, returnTo: evidenceReturnTo })} className="pressable grid min-h-14 gap-2 rounded-xl border border-line bg-surface-raised px-3 py-2 hover:border-line-strong sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center"><StudentEvidenceIcon kind={evidence.kind} /><div className="min-w-0"><p className="text-sm font-semibold text-ink">{evidence.label}</p><p className="text-xs tabular-nums text-ink-muted">{humanize(evidence.kind, EVIDENCE_KIND_LABELS)} · {evidence.value} · {formatShortDateTime(evidence.occurred_at)}</p></div><div className="flex items-center gap-2">{evidence.github_checks?.failed ? <Badge tone="danger">{evidence.github_checks.failed} failed check{evidence.github_checks.failed === 1 ? '' : 's'}</Badge> : null}<ArrowRight className="h-4 w-4 text-ink-muted" aria-hidden="true" /></div></Link> : <div key={evidence.id} className="grid min-h-14 gap-2 rounded-xl border border-line bg-surface-raised px-3 py-2 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center"><StudentEvidenceIcon kind={evidence.kind} /><div className="min-w-0"><p className="text-sm font-semibold text-ink">{evidence.label}</p><p className="text-xs tabular-nums text-ink-muted">{evidence.value} · {evidence.attempt_count} attempt{evidence.attempt_count === 1 ? '' : 's'} · {formatShortDateTime(evidence.occurred_at)}</p></div></div>)}</div> : <p className="text-sm text-ink-muted">No rubric ratings, graded work or checkpoint answers for this objective yet.</p>}</div></details>
  })}</div></section>
}

function EvidenceStatus({ status }: { status: LearningEvidenceStatus }) { const labels = { demonstrated: 'Demonstrated', developing: 'Developing', needs_revision: 'Needs revision', not_evidenced: 'Not evidenced' }; const tones: Record<LearningEvidenceStatus, BadgeTone> = { demonstrated: 'success', developing: 'pending', needs_revision: 'warning', not_evidenced: 'neutral' }; return <Badge tone={tones[status]}>{labels[status]}</Badge> }
function StudentEvidenceIcon({ kind }: { kind: string }) { const Icon = kind === 'knowledge_check' ? CircleDashed : kind === 'rubric_criterion' ? Target : GitBranch; return <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-sunken text-ink-secondary"><Icon className="h-4 w-4" aria-hidden="true" /></span> }

function SupportTab({ sections, requests, interventions, recoveryPlans, cohortId, studentId, onSaved }: { sections: { help: Section<HelpRequest[]>; interventions: Section<Intervention[]>; recovery: Section<RecoveryPlan[]> }; requests: HelpRequest[]; interventions: Intervention[]; recoveryPlans: RecoveryPlan[]; cohortId: number; studentId: number; onSaved: (plan: RecoveryPlan) => void }) {
  const returnTo = cohortStudentPath(cohortId, studentId, 'support')
  const [params] = useSearchParams()
  const selectedPlan = Number(params.get('plan_id'))
  const plans = selectedPlan ? recoveryPlans.filter((plan) => plan.id === selectedPlan) : recoveryPlans
  if (Object.values(sections).every((section) => section.status === 'success') && !selectedPlan && !requests.length && !interventions.length && !recoveryPlans.length) return <EmptyState icon={LifeBuoy} title="No support history" description="Help requests, follow-up plans and return plans for this student in this cohort will appear here." action={<LinkButton to={`/admin/support?cohort_id=${cohortId}`} variant="secondary"><ClipboardCheck className="h-4 w-4" aria-hidden="true" />Open Support</LinkButton>} />
  return <div className="space-y-6">
    <SectionBoundary section={sections.interventions} label="Follow-up plans"><section className="app-surface overflow-hidden"><div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6"><div className="min-w-0"><h2 className="text-lg font-bold text-ink">{TERMS.followUpPlans}</h2><p className="mt-1 text-sm text-ink-muted">Owners, next steps, follow-ups, notes and outcomes. Only staff see these.</p></div><Link className="app-link inline-flex min-h-11 shrink-0 items-center text-sm" to={`/admin/support?cohort_id=${cohortId}`}>Open Support</Link></div>{interventions.length ? <div className="divide-y divide-line">{interventions.map((item) => <Link to={interventionPath(item.id, returnTo)} key={item.id} className={`group pressable grid min-h-11 gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_160px_auto] sm:items-center sm:px-6 ${item.follow_up_due ? 'bg-warning-soft hover:bg-warning-soft' : 'hover:bg-surface-sunken'}`}><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-ink group-hover:underline">{followUpLabel(item.trigger_type)}</p><Badge>{followUpLabel(item.status)}</Badge></div><p className="mt-1 line-clamp-2 text-sm text-ink-secondary">{item.action_summary || 'No next step yet.'}</p></div><div>{item.follow_up_due ? <Badge tone="warning">Follow-up due</Badge> : <p className="text-xs font-semibold text-ink-muted">Next follow-up</p>}<p className="mt-1 text-xs font-semibold tabular-nums text-ink-secondary">{formatShortDateTime(item.next_follow_up_at)}</p></div><ChevronRight className="h-4 w-4 text-ink-muted group-hover:text-ink" aria-hidden="true" /></Link>)}</div> : <p className="px-6 py-5 text-sm text-ink-muted">No follow-up plans for this student in this cohort.</p>}</section></SectionBoundary>
    <SectionBoundary section={sections.recovery} label="Return plans">
    {selectedPlan > 0 && !plans.length && <p role="alert" className="app-surface p-5 text-sm text-danger-ink">This return plan isn't available for this student.</p>}
    {plans.map((plan) => <section key={plan.id} className={`rounded-2xl border p-5 shadow-raised sm:p-6 ${plan.check_in_due ? 'border-warning-line bg-warning-soft' : 'border-line bg-surface-raised'}`}><div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><p className="text-xs font-semibold text-ink-muted">{TERMS.returnPlan}</p><h2 className="mt-1 text-lg font-bold text-ink">{plan.target_pace}</h2></div><Badge>{followUpLabel(plan.status)}</Badge></div><div className="mt-4 grid gap-4 sm:grid-cols-2"><div><p className="text-xs font-semibold text-ink-muted">Required work</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink-secondary">{plan.required_scope}</p></div><div><p className="text-xs font-semibold text-ink-muted">Next follow-up</p><p className={`mt-1 text-sm font-semibold tabular-nums ${plan.check_in_due ? 'text-warning-ink' : 'text-ink-secondary'}`}>{plan.check_in_due ? 'Due now · ' : ''}{formatShortDateTime(plan.next_check_in_at)}</p><p className="mt-1 text-xs text-ink-muted">Owner: {plan.owner.full_name}</p></div></div>{plan.intervention_id && <Link to={interventionPath(plan.intervention_id, returnTo)} className="app-link mt-4 inline-flex min-h-11 items-center gap-1 text-sm">Open follow-up plan <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>}<RecoveryPlanActions plan={plan} onSaved={onSaved} /></section>)}
    </SectionBoundary>
    <SectionBoundary section={sections.help} label="Help requests"><section className="app-surface overflow-hidden"><div className="border-b border-line px-5 py-4 sm:px-6"><h2 className="text-lg font-bold text-ink">Help requests</h2></div>{requests.length ? <div className="divide-y divide-line">{requests.map((request) => <Link to={helpRequestPath(request.id, returnTo)} key={request.id} className="group pressable grid min-h-11 gap-4 px-5 py-4 hover:bg-surface-sunken sm:grid-cols-[minmax(0,1fr)_auto] sm:px-6"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-ink [overflow-wrap:anywhere] group-hover:underline">{request.context_label}</p><Badge tone={request.urgency === 'urgent' ? 'danger' : 'neutral'}>{humanize(request.urgency)}</Badge><Badge tone={request.status === 'resolved' ? 'success' : request.status === 'open' ? 'pending' : 'neutral'}>{humanize(request.status)}</Badge></div><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink-secondary [overflow-wrap:anywhere]">{request.message}</p>{request.staff_response && <div className="mt-3 rounded-xl border border-success-line bg-success-soft p-3 text-sm text-success-ink"><span className="font-semibold">Staff response:</span> {markdownExcerpt(request.staff_response, 280)}</div>}</div><div className="text-xs font-semibold tabular-nums text-ink-muted">{formatShortDateTime(request.created_at)}</div></Link>)}</div> : <p className="px-6 py-5 text-sm text-ink-muted">No help requests.</p>}</section></SectionBoundary>
  </div>
}

function MetricCard({ to, icon: Icon, label, value, detail, tone }: { to: string; icon: typeof UserRound; label: string; value: string; detail: string; tone: 'neutral' | 'success' | 'pending' | 'warning' }) {
  const tones = { neutral: 'bg-surface-sunken text-ink-secondary', success: 'bg-success-soft text-success-ink', pending: 'bg-surface-sunken text-ink-secondary', warning: 'bg-warning-soft text-warning-ink' }
  return <Link to={to} className="app-surface block min-h-11 p-4 hover:border-line-strong hover:bg-surface-hover sm:p-5"><span className={`flex h-10 w-10 items-center justify-center rounded-xl ${tones[tone]}`}><Icon className="h-5 w-5" aria-hidden="true" /></span><p className="mt-4 text-3xl font-bold tabular-nums text-ink">{value}</p><p className="mt-1 text-sm font-semibold text-ink-secondary">{label}</p><p className="mt-1 text-xs tabular-nums text-ink-muted">{detail}</p></Link>
}

function SubmissionStatus({ submission }: { submission: Submission }) {
  if (submission.grade === null) return <Badge tone="pending" icon={<Clock3 className="h-3.5 w-3.5" aria-hidden="true" />}>Waiting for review</Badge>
  if (submission.grade === 'R') return <Badge tone="warning" icon={<RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />}>Redo</Badge>
  return <Badge tone="success" icon={<CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}>Grade {submission.grade}</Badge>
}

function StatusBadge({ status }: { status: string }) {
  return <Badge tone={status === 'active' ? 'success' : 'neutral'}>{humanize(status)}</Badge>
}

function CountBadge({ count, tone = 'neutral' }: { count: number; tone?: 'neutral' | 'warning' }) {
  return <span className={`rounded-full border px-1.5 text-xs font-semibold tabular-nums ${tone === 'warning' ? 'border-warning-line bg-warning-soft text-warning-ink' : 'border-line bg-surface-sunken text-ink-secondary'}`}>{count}</span>
}

function StudentStepper({ direction, student, cohortId, tab, state }: { direction: 'previous' | 'next'; student: CohortDetail['students'][number] | null; cohortId: number; tab: StudentWorkspaceTab; state?: ReturnContext }) {
  const Icon = direction === 'previous' ? ChevronLeft : ChevronRight
  if (!student) return <span className="hidden h-11 w-28 sm:block" />
  return <Link to={cohortStudentPath(cohortId, student.user_id, tab)} state={state} title={student.full_name || student.email} className={`inline-flex min-h-11 max-w-48 items-center gap-1 rounded-xl px-2 text-xs font-semibold text-ink-secondary transition-colors duration-150 hover:bg-surface-raised hover:text-ink ${direction === 'next' ? 'sm:justify-self-end' : ''}`}>{direction === 'previous' && <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />}<span className="truncate">{student.full_name || student.email}</span>{direction === 'next' && <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />}</Link>
}
