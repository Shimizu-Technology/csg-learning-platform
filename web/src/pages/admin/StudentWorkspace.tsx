import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
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
import { StudentAccess } from '../../components/admin/StudentAccess'
import { requireSection, SectionBoundary, useSection, type Section } from '../../lib/useSection'
import { RecoveryPlanActions } from '../../components/admin/RecoveryPlanActions'
import { api } from '../../lib/api'
import { cohortPath, cohortStudentPath, helpRequestPath, interventionPath, submissionPath, type StudentWorkspaceTab } from '../../lib/routes'
import { formatShortDateTime } from '../../lib/format'
import { forwardReturnState, RESTORE_LIST_STATE, useReturnContext, type ReturnContext } from '../../lib/navigationContext'
import { Button, LinkButton } from '../../components/ui/Button'
import { Avatar } from '../../components/ui/Avatar'
import { Badge, type BadgeTone } from '../../components/ui/Badge'
import { useToast } from '../../contexts/ToastContext'
import { EmptyState } from '../../components/shared/EmptyState'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { ActivityTimeline } from '../../components/shared/ActivityTimeline'
import { ProgressBar } from '../../components/shared/ProgressBar'
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
  // Forward the resolved context (router state or the remembered one) when moving between students and tabs.
  const returnState = forwardReturnState(location.state) || (returnContext === STUDENTS_RETURN ? undefined : returnContext)
  const [data, setData] = useState<WorkspaceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openingMessage, setOpeningMessage] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const loadGenerationRef = useRef(0)

  const load = useCallback(async (showLoading = true) => {
    const generation = ++loadGenerationRef.current
    if (!Number.isInteger(cohortId) || !Number.isInteger(studentId)) {
      setError('This student workspace link is invalid.')
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
      setData({ progress: requireSection(progressResult), cohort: requireSection(cohortResult).cohort })
      setRefreshError(null)
    } catch {
      if (generation !== loadGenerationRef.current) return
      if (showLoading) setError('Could not load this student workspace.')
      else setRefreshError("Changes saved, but this workspace couldn't refresh. The details below may be out of date.")
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

  async function openDirectMessage() {
    if (!data) return
    setOpeningMessage(true)
    const result = await api.createDirectConversation({ cohort_id: cohortId, user_ids: [studentId] })
    setOpeningMessage(false)
    if (result.data) navigate(`/messages/dm/${result.data.direct_conversation.id}`)
    else toast.error(result.error || 'Could not open a direct message.')
  }

  if (loading) return <LoadingSpinner message="Loading connected student workspace…" />
  if (!data || error) {
    return (
      <div className="app-page">
        <EmptyState icon={UserRound} title="Could not open this student workspace" description={error || 'The enrollment could not be found.'} action={<Button onClick={() => void load()}><RefreshCw className="h-4 w-4" />Try again</Button>} />
      </div>
    )
  }

  const { progress, cohort } = data
  const blockIds = new Set(progress.modules.flatMap((mod) => mod.lessons.flatMap((lesson) => lesson.blocks.map((block) => block.id))))
  const submissions = (submissionsSection.data || []).filter((item) => blockIds.has(item.content_block_id))
  const helpRequests = helpSection.data || []
  const recordings = recordingsSection.data || []
  const lessonVideos = videosSection.data || []
  const interventions = interventionsSection.data || []
  const recoveryPlans = recoverySection.data || []
  const studentIndex = cohort.students.findIndex((student) => student.user_id === studentId)
  const previousStudent = studentIndex > 0 ? cohort.students[studentIndex - 1] : null
  const nextStudent = studentIndex >= 0 && studentIndex < cohort.students.length - 1 ? cohort.students[studentIndex + 1] : null
  const ungraded = submissions.filter((submission) => submission.grade === null)
  const openHelp = helpRequests.filter((request) => request.status === 'open' || request.status === 'acknowledged')
  const latestSubmission = ungraded[0] || submissions[0]

  return (
    <div className="app-page-wide space-y-6">
      {refreshError && <div role="alert" className="app-surface flex flex-wrap items-center justify-between gap-3 border-warning-200 p-4 text-sm text-warning-800"><p>{refreshError}</p><Button variant="secondary" aria-label="Retry workspace refresh" disabled={refreshing} onClick={() => void load(false)}>{refreshing ? 'Refreshing…' : 'Retry'}</Button></div>}
      <nav aria-label="Breadcrumb" className="flex min-w-0 flex-wrap items-center gap-1 text-sm font-semibold text-ink-muted">
        <Link to={returnContext.returnTo} state={RESTORE_LIST_STATE} className="app-link inline-flex min-h-11 items-center gap-1 px-1"><ArrowLeft className="h-4 w-4" aria-hidden="true" />{returnContext.returnLabel}</Link>
        <ChevronRight className="h-4 w-4 text-ink-muted" aria-hidden="true" />
        <Link to={cohortPath(cohortId)} className="app-link inline-flex min-h-11 max-w-full items-center px-1"><span className="truncate" title={cohort.name}>{cohort.name}</span></Link>
        <ChevronRight className="h-4 w-4 text-ink-muted" aria-hidden="true" />
        <span className="min-w-0 max-w-full truncate px-1 text-ink-secondary" title={progress.user.full_name}>{progress.user.full_name}</span>
      </nav>

      <section className="app-surface overflow-hidden">
        <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <div className="flex min-w-0 items-start gap-4">
            <Avatar name={progress.user.full_name} src={progress.user.avatar_url} size="lg" />
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h1 className="app-title min-w-0 max-w-full truncate" title={progress.user.full_name}>{progress.user.full_name}</h1>
                <StatusBadge status={progress.enrollment.status} />
              </div>
              <p className="mt-1 truncate text-sm text-ink-muted" title={progress.user.email}>{progress.user.email}</p>
              <p className="mt-2 text-sm font-semibold text-ink-secondary [overflow-wrap:anywhere]">{cohort.name} <span className="font-medium text-ink-muted">· {cohort.curriculum_name}</span></p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant={latestSubmission && ungraded.length ? 'secondary' : 'primary'} onClick={() => void openDirectMessage()} disabled={openingMessage}><MessageSquareText className="h-4 w-4" aria-hidden="true" />{openingMessage ? 'Opening…' : 'Message'}</Button>
            {latestSubmission && <LinkButton to={submissionPath(latestSubmission.id, { cohortId, userId: studentId, returnTo: location.pathname })} variant={ungraded.length ? 'primary' : 'secondary'}><FileCheck2 className="h-4 w-4" aria-hidden="true" />{ungraded.length ? 'Grade next' : 'View latest work'}</LinkButton>}
            <LinkButton to={`/admin/cohorts/${cohortId}/student-view?student_id=${studentId}`} variant="secondary"><ExternalLink className="h-4 w-4" aria-hidden="true" />Preview as student</LinkButton>
          </div>
        </div>

        <div className="grid items-center gap-2 border-t border-line bg-surface-sunken px-4 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(180px,260px)_minmax(0,1fr)] sm:px-6">
          <StudentStepper direction="previous" student={previousStudent} cohortId={cohortId} tab={activeTab} state={returnState} />
          <label className="grid gap-1 text-center text-xs font-semibold tabular-nums text-ink-muted"><span>{studentIndex >= 0 ? `Student ${studentIndex + 1} of ${cohort.students.length}` : 'Historical enrollment'}</span><select aria-label={`Switch student in ${cohort.name}`} value={studentId} onChange={(event) => navigate(cohortStudentPath(cohortId, Number(event.target.value), activeTab), { state: returnState })} className="app-control w-full font-semibold">{cohort.students.map((student) => <option key={student.enrollment_id} value={student.user_id}>{student.full_name || student.email}</option>)}</select></label>
          <StudentStepper direction="next" student={nextStudent} cohortId={cohortId} tab={activeTab} state={returnState} />
        </div>
      </section>

      <nav aria-label="Student workspace sections" className="overflow-x-auto border-b border-line">
        <div className="flex min-w-max gap-1">
          {tabs.map(({ id, label, icon: Icon }) => (
            <NavLink key={id} to={cohortStudentPath(cohortId, studentId, id)} state={returnState} className={({ isActive }) => `inline-flex min-h-11 items-center gap-2 px-3 text-sm font-semibold transition-colors duration-150 ${isActive || activeTab === id && !params.tab ? 'tab-selected' : 'text-ink-secondary hover:bg-surface-sunken hover:text-ink'}`}>
              <Icon className="h-4 w-4" aria-hidden="true" />{label}
              {id === 'work' && ungraded.length > 0 && <CountBadge count={ungraded.length} />}
              {id === 'support' && openHelp.length > 0 && <CountBadge count={openHelp.length} tone="warning" />}
              {id === 'support' && interventions.some((item) => !['resolved', 'canceled'].includes(item.status)) && <CountBadge count={interventions.filter((item) => !['resolved', 'canceled'].includes(item.status)).length} />}
            </NavLink>
          ))}
        </div>
      </nav>

      {activeTab === 'overview' && <OverviewTab sections={{ submissions: submissionsSection, help: helpSection, recordings: recordingsSection, videos: videosSection }} progress={progress} submissions={submissions} helpRequests={helpRequests} recordings={recordings} lessonVideos={lessonVideos} cohortId={cohortId} studentId={studentId} />}
      {activeTab === 'activity' && <ActivityTimeline userId={studentId} cohortId={cohortId} />}
      {activeTab === 'work' && <SectionBoundary section={submissionsSection} label="Submissions"><WorkTab submissions={submissions} cohortId={cohortId} studentId={studentId} returnTo={location.pathname} /></SectionBoundary>}
      {activeTab === 'learning' && <LearningTab progress={progress} cohortId={cohortId} studentId={studentId} returnTo={location.pathname} />}
      {activeTab === 'support' && <SupportTab sections={{ help: helpSection, interventions: interventionsSection, recovery: recoverySection }} requests={helpRequests} interventions={interventions} recoveryPlans={recoveryPlans} cohortId={cohortId} studentId={studentId} onSaved={(plan) => recoverySection.update((plans) => plans.map((item) => item.id === plan.id ? plan : item))} />}
      {activeTab === 'communication' && <CommunicationTab studentName={progress.user.full_name} opening={openingMessage} onOpen={() => void openDirectMessage()} />}
      {activeTab === 'access' && <StudentAccess progress={progress} cohort={cohort} onSaved={refresh} />}
    </div>
  )
}

function OverviewTab({ sections, progress, submissions, helpRequests, recordings, lessonVideos, cohortId, studentId }: { sections: { submissions: Section<Submission[]>; help: Section<HelpRequest[]>; recordings: Section<StudentRecordingProgress[]>; videos: Section<StudentLessonVideoProgress[]> }; progress: StudentProgressResponse; submissions: Submission[]; helpRequests: HelpRequest[]; recordings: StudentRecordingProgress[]; lessonVideos: StudentLessonVideoProgress[]; cohortId: number; studentId: number }) {
  const ungraded = submissions.filter((submission) => submission.grade === null).length
  const redo = submissions.filter((submission) => submission.grade === 'R').length
  const openHelp = helpRequests.filter((request) => ['open', 'acknowledged'].includes(request.status)).length
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard icon={GraduationCap} label="Learning progress" value={`${progress.overall_progress.percentage}%`} detail={`${progress.overall_progress.completed} of ${progress.overall_progress.total} checkpoints`} tone="neutral" />
        <SectionBoundary section={sections.submissions} label="Submissions"><MetricCard icon={FileCheck2} label="Work waiting" value={String(ungraded)} detail={redo ? `${redo} redo requested` : 'No redo requests'} tone={ungraded ? 'pending' : 'success'} /></SectionBoundary>
        <SectionBoundary section={sections.help} label="Help requests"><MetricCard icon={CircleHelp} label="Open support" value={String(openHelp)} detail={`${helpRequests.length} total requests`} tone={openHelp ? 'warning' : 'success'} /></SectionBoundary>
        <SectionBoundary section={sections.recordings} label="Recordings"><MetricCard icon={Video} label="Recordings completed" value={`${recordings.filter((video) => video.completed).length}/${recordings.length}`} detail="Class recordings" tone="neutral" /></SectionBoundary>
        <SectionBoundary section={sections.videos} label="Lesson videos"><MetricCard icon={Video} label="Lesson videos completed" value={`${lessonVideos.filter((video) => video.completed).length}/${lessonVideos.length}`} detail="Lesson videos" tone="neutral" /></SectionBoundary>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.8fr)]">
        <section className="app-surface p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-bold text-ink">Learning at a glance</h2><Link className="app-link text-sm" to={cohortStudentPath(cohortId, studentId, 'learning')}>Open learning</Link></div>
          <div className="mt-5"><ProgressBar value={progress.overall_progress.percentage} size="md" /></div>
          <div className="mt-5 space-y-3">{progress.modules.map((mod) => <div key={mod.id} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px_auto] sm:items-center"><p className="truncate text-sm font-semibold text-ink" title={mod.name}>{mod.name}</p><ProgressBar value={mod.progress_percentage} size="sm" /><span className="text-xs font-semibold tabular-nums text-ink-muted">{mod.completed_blocks}/{mod.total_blocks}</span></div>)}</div>
        </section>
        <div className="space-y-3">{(sections.submissions.status !== 'success' || sections.help.status !== 'success') && <p className="text-sm text-ink-muted">Recent events are incomplete while work or help is unavailable.</p>}<ComposedTimeline incomplete={sections.submissions.status !== 'success' || sections.help.status !== 'success'} progress={progress} submissions={submissions} helpRequests={helpRequests} cohortId={cohortId} studentId={studentId} /></div>
      </div>
    </div>
  )
}

function ComposedTimeline({ incomplete, progress, submissions, helpRequests, cohortId, studentId }: { incomplete: boolean; progress: StudentProgressResponse; submissions: Submission[]; helpRequests: HelpRequest[]; cohortId: number; studentId: number }) {
  const workspacePath = cohortStudentPath(cohortId, studentId, 'overview')
  const events = [
    ...progress.recent_activity.map((activity) => ({ id: `progress-${activity.content_block_id}-${activity.completed_at}`, at: activity.completed_at, title: activity.block_title || 'Learning checkpoint', detail: 'Completed learning checkpoint', path: cohortStudentPath(cohortId, studentId, 'learning'), icon: CheckCircle2, tone: 'success' as const })),
    ...submissions.map((submission) => ({ id: `submission-${submission.id}`, at: submission.created_at, title: submission.content_block_title, detail: submission.grade === null ? 'Submitted for review' : submission.grade === 'R' ? 'Redo requested' : `Graded ${submission.grade}`, path: submissionPath(submission.id, { cohortId, userId: studentId, returnTo: workspacePath }), icon: FileCheck2, tone: submission.grade === 'R' ? 'warning' as const : submission.grade === null ? 'pending' as const : 'neutral' as const })),
    ...helpRequests.map((request) => ({ id: `help-${request.id}`, at: request.created_at, title: request.context_label, detail: request.status === 'resolved' ? 'Support request resolved' : `Asked for ${request.urgency === 'urgent' ? 'urgent ' : ''}help`, path: helpRequestPath(request.id, workspacePath), icon: LifeBuoy, tone: request.urgency === 'urgent' ? 'danger' as const : 'warning' as const })),
  ].filter((event) => event.at).sort((a, b) => new Date(b.at!).getTime() - new Date(a.at!).getTime()).slice(0, 8)
  const tones = { success: 'bg-success-50 text-success-700', neutral: 'bg-surface-sunken text-ink-secondary', pending: 'bg-pending-50 text-pending-700', warning: 'bg-warning-50 text-warning-800', danger: 'bg-danger-50 text-danger-700' }
  return <section className="app-surface p-5 sm:p-6"><h2 className="text-lg font-bold text-ink">Connected activity</h2><p className="mt-1 text-xs text-ink-muted">Learning, submissions, and support in one timeline.</p>{events.length ? <ol className="mt-4 space-y-1">{events.map((event) => <li key={event.id}><Link to={event.path} className="group pressable flex min-h-11 gap-3 rounded-xl px-1 py-2 hover:bg-surface-sunken"><span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${tones[event.tone]}`}><event.icon className="h-4 w-4" aria-hidden="true" /></span><div className="min-w-0"><p className="truncate text-sm font-semibold text-ink group-hover:underline" title={event.title ?? undefined}>{event.title}</p><p className="text-xs tabular-nums text-ink-muted">{event.detail} · {formatShortDateTime(event.at)}</p></div></Link></li>)}</ol> : <p className="mt-4 text-sm text-ink-muted">{incomplete ? 'Some activity sources are unavailable. Retry above to see the full history.' : 'No connected activity yet.'}</p>}</section>
}

function WorkTab({ submissions, cohortId, studentId, returnTo }: { submissions: Submission[]; cohortId: number; studentId: number; returnTo: string }) {
  if (!submissions.length) return <EmptyState icon={FileCheck2} title="No submitted work yet" description="Submissions for this curriculum will appear here as connected records." />
  return <section className="app-surface overflow-hidden"><div className="border-b border-line px-5 py-4 sm:px-6"><h2 className="text-lg font-bold text-ink">All submitted work</h2><p className="mt-1 text-sm text-ink-muted">Open any curriculum submission while retaining this selected workspace context.</p></div><div className="divide-y divide-line">{submissions.map((submission) => <Link key={submission.id} to={submissionPath(submission.id, { cohortId, userId: studentId, returnTo })} className="group pressable grid min-h-11 gap-3 px-5 py-4 hover:bg-surface-sunken sm:grid-cols-[minmax(0,1fr)_180px_auto] sm:items-center sm:px-6"><div className="min-w-0"><p className="font-semibold text-ink [overflow-wrap:anywhere]">{submission.content_block_title}</p><p className="text-sm text-ink-muted [overflow-wrap:anywhere]">{submission.module_name} · {submission.lesson_title}</p></div><div><SubmissionStatus submission={submission} /><p className="mt-1 text-xs tabular-nums text-ink-muted">{formatShortDateTime(submission.created_at)}</p></div><ChevronRight className="h-4 w-4 text-ink-muted transition-colors duration-150 group-hover:text-ink" aria-hidden="true" /></Link>)}</div></section>
}

function LearningTab({ progress, cohortId, studentId, returnTo }: { progress: StudentProgressResponse; cohortId: number; studentId: number; returnTo: string }) {
  return <div className="space-y-6">
    <StudentObjectiveEvidence cohortId={cohortId} studentId={studentId} returnTo={returnTo} />
    <div className="space-y-4">{progress.modules.map((mod) => <details key={mod.id} className="app-surface overflow-hidden" open={mod.progress_percentage > 0 && mod.progress_percentage < 100}><summary className="min-h-16 cursor-pointer px-5 py-4 sm:px-6"><div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px_auto] sm:items-center"><div className="min-w-0"><h2 className="text-base font-semibold text-ink [overflow-wrap:anywhere]">{mod.name}</h2><p className="text-xs tabular-nums text-ink-muted">{mod.completed_blocks} of {mod.total_blocks} checkpoints</p></div><ProgressBar value={mod.progress_percentage} size="sm" /><span className="text-sm font-semibold tabular-nums text-ink-secondary">{mod.progress_percentage}%</span></div></summary><div className="divide-y divide-line border-t border-line">{mod.lessons.map((lesson) => <div key={lesson.id} className="px-5 py-4 sm:px-6"><div className="flex flex-wrap items-center justify-between gap-2"><div className="min-w-0"><p className="font-semibold text-ink [overflow-wrap:anywhere]">{lesson.title}</p><p className="text-xs tabular-nums text-ink-muted">{lesson.assigned === false ? 'Not currently assigned · Saved evidence' : `${lesson.completed_blocks}/${lesson.total_blocks} checkpoints · ${lesson.available ? 'Available' : 'Locked'}`}</p></div>{lesson.completed && <Badge tone="success" icon={<CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}>Complete</Badge>}</div><div className="mt-3 grid gap-2 sm:grid-cols-2">{lesson.blocks.map((block) => block.submission ? <Link key={block.id} to={submissionPath(block.submission.id, { cohortId, userId: studentId, returnTo })} className="pressable flex min-h-11 items-center justify-between gap-2 rounded-xl border border-line px-3 py-2 text-sm hover:border-line-strong hover:bg-surface-sunken"><span className="min-w-0 truncate font-semibold text-ink" title={block.title}>{block.title}</span><SubmissionStatus submission={{ grade: block.submission.grade } as Submission} /></Link> : <div key={block.id} className="flex min-h-11 items-center justify-between gap-2 rounded-xl bg-surface-sunken px-3 py-2 text-sm"><span className="min-w-0 truncate font-semibold text-ink-secondary" title={block.title}>{block.title}</span><span className="shrink-0 text-xs font-semibold capitalize text-ink-muted">{block.status.replace('_', ' ')}</span></div>)}</div></div>)}</div></details>)}</div>
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
  if (!insights) return <section className="app-surface p-5"><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-ink-secondary">{error || 'Objective evidence is unavailable.'}</p><Button variant="secondary" onClick={() => void load()}><RefreshCw className="h-4 w-4" aria-hidden="true" />Try again</Button></div></section>

  return <section className="app-surface overflow-hidden"><div className="border-b border-line px-5 py-4 sm:px-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold text-ink-muted">Objective evidence</p><h2 className="mt-1 text-lg font-bold text-ink">Explainable learning status</h2><p className="mt-1 text-sm text-ink-muted">Rubrics and graded work can demonstrate an objective; retrieval-only evidence remains developing. Completion and watch time are excluded.</p></div><Link to={`/admin/cohorts/${cohortId}?tab=insights`} className="app-link inline-flex min-h-11 items-center gap-1 text-sm">Cohort evidence <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link></div></div><div className="divide-y divide-line">{insights.objectives.map((objective) => {
    const student = objective.students[0]
    return <details key={objective.id} open={selectedObjectiveId === objective.id || student.status === 'needs_revision'} className="group scroll-mt-24"><summary className="min-h-11 cursor-pointer list-none px-5 py-4 transition-colors duration-150 hover:bg-surface-sunken sm:px-6"><div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2"><span className="shrink-0 rounded-lg bg-surface-sunken px-2 py-1 font-mono text-xs font-semibold text-ink-secondary">{objective.code}</span><h3 className="text-base font-semibold text-ink">{objective.title}</h3></div><p className="mt-1 text-sm text-ink-muted">{objective.success_criteria}</p></div><EvidenceStatus status={student.status} /></div></summary><div className="border-t border-line bg-surface-sunken px-5 py-4 sm:px-6">{student.evidence.length ? <div className="grid gap-2">{student.evidence.map((evidence) => evidence.submission_id ? <Link key={evidence.id} to={submissionPath(evidence.submission_id, { cohortId, userId: studentId, returnTo: evidenceReturnTo })} className="pressable grid min-h-14 gap-2 rounded-xl border border-line bg-surface-raised px-3 py-2 hover:border-line-strong sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center"><StudentEvidenceIcon kind={evidence.kind} /><div className="min-w-0"><p className="text-sm font-semibold text-ink">{evidence.label}</p><p className="text-xs capitalize tabular-nums text-ink-muted">{evidence.kind.replaceAll('_', ' ')} · {evidence.value} · {formatShortDateTime(evidence.occurred_at)}</p></div><div className="flex items-center gap-2">{evidence.github_checks?.failed ? <Badge tone="danger">{evidence.github_checks.failed} failed check{evidence.github_checks.failed === 1 ? '' : 's'}</Badge> : null}<ArrowRight className="h-4 w-4 text-ink-muted" aria-hidden="true" /></div></Link> : <div key={evidence.id} className="grid min-h-14 gap-2 rounded-xl border border-line bg-surface-raised px-3 py-2 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center"><StudentEvidenceIcon kind={evidence.kind} /><div className="min-w-0"><p className="text-sm font-semibold text-ink">{evidence.label}</p><p className="text-xs capitalize tabular-nums text-ink-muted">{evidence.value} · {evidence.attempt_count} attempt{evidence.attempt_count === 1 ? '' : 's'} · {formatShortDateTime(evidence.occurred_at)}</p></div></div>)}</div> : <p className="text-sm text-ink-muted">No rubric, graded submission, or retrieval evidence has been recorded for this objective.</p>}</div></details>
  })}</div></section>
}

function EvidenceStatus({ status }: { status: LearningEvidenceStatus }) { const labels = { demonstrated: 'Demonstrated', developing: 'Developing', needs_revision: 'Needs revision', not_evidenced: 'Not evidenced' }; const tones: Record<LearningEvidenceStatus, BadgeTone> = { demonstrated: 'success', developing: 'pending', needs_revision: 'warning', not_evidenced: 'neutral' }; return <Badge tone={tones[status]}>{labels[status]}</Badge> }
function StudentEvidenceIcon({ kind }: { kind: string }) { const Icon = kind === 'knowledge_check' ? CircleDashed : kind === 'rubric_criterion' ? Target : GitBranch; return <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-sunken text-ink-secondary"><Icon className="h-4 w-4" aria-hidden="true" /></span> }

function SupportTab({ sections, requests, interventions, recoveryPlans, cohortId, studentId, onSaved }: { sections: { help: Section<HelpRequest[]>; interventions: Section<Intervention[]>; recovery: Section<RecoveryPlan[]> }; requests: HelpRequest[]; interventions: Intervention[]; recoveryPlans: RecoveryPlan[]; cohortId: number; studentId: number; onSaved: (plan: RecoveryPlan) => void }) {
  const returnTo = cohortStudentPath(cohortId, studentId, 'support')
  const [params] = useSearchParams()
  const selectedPlan = Number(params.get('plan_id'))
  const plans = selectedPlan ? recoveryPlans.filter((plan) => plan.id === selectedPlan) : recoveryPlans
  if (Object.values(sections).every((section) => section.status === 'success') && !selectedPlan && !requests.length && !interventions.length && !recoveryPlans.length) return <EmptyState icon={LifeBuoy} title="No support history" description="Help requests, owned interventions, and recovery plans for this enrollment will collect here." action={<LinkButton to="/admin/support" variant="secondary"><ClipboardCheck className="h-4 w-4" aria-hidden="true" />Open support queue</LinkButton>} />
  return <div className="space-y-6">
    <SectionBoundary section={sections.interventions} label="Interventions"><section className="app-surface overflow-hidden"><div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6"><div className="min-w-0"><h2 className="text-lg font-bold text-ink">Owned interventions</h2><p className="mt-1 text-sm text-ink-muted">Staff-only ownership, actions, follow-ups, notes, and outcomes.</p></div><Link className="app-link shrink-0 text-sm" to="/admin/support">Support queue</Link></div>{interventions.length ? <div className="divide-y divide-line">{interventions.map((item) => <Link to={interventionPath(item.id, returnTo)} key={item.id} className={`group pressable grid min-h-11 gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_160px_auto] sm:items-center sm:px-6 ${item.follow_up_due ? 'bg-warning-50 hover:bg-warning-100' : 'hover:bg-surface-sunken'}`}><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold capitalize text-ink group-hover:underline">{item.trigger_type.replaceAll('_', ' ')}</p><Badge className="capitalize">{item.status.replaceAll('_', ' ')}</Badge></div><p className="mt-1 line-clamp-2 text-sm text-ink-secondary">{item.action_summary || 'No action summary yet.'}</p></div><div>{item.follow_up_due ? <Badge tone="warning">Follow-up due</Badge> : <p className="text-xs font-semibold text-ink-muted">Next follow-up</p>}<p className="mt-1 text-xs font-semibold tabular-nums text-ink-secondary">{formatShortDateTime(item.next_follow_up_at)}</p></div><ChevronRight className="h-4 w-4 text-ink-muted group-hover:text-ink" aria-hidden="true" /></Link>)}</div> : <p className="px-6 py-5 text-sm text-ink-muted">No interventions have been opened for this enrollment.</p>}</section></SectionBoundary>
    <SectionBoundary section={sections.recovery} label="Recovery plans">
    {selectedPlan > 0 && !plans.length && <p role="alert" className="app-surface p-5 text-sm text-danger-700">This recovery plan is unavailable for this enrollment.</p>}
    {plans.map((plan) => <section key={plan.id} className={`rounded-2xl border p-5 shadow-raised sm:p-6 ${plan.check_in_due ? 'border-warning-300 bg-warning-50' : 'border-line bg-surface-raised'}`}><div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><p className="text-xs font-semibold text-ink-muted">Recovery plan</p><h2 className="mt-1 text-lg font-bold text-ink">{plan.target_pace}</h2></div><Badge className="capitalize">{plan.status}</Badge></div><div className="mt-4 grid gap-4 sm:grid-cols-2"><div><p className="text-xs font-semibold text-ink-muted">Required scope</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink-secondary">{plan.required_scope}</p></div><div><p className="text-xs font-semibold text-ink-muted">Check-in</p><p className={`mt-1 text-sm font-semibold tabular-nums ${plan.check_in_due ? 'text-warning-800' : 'text-ink-secondary'}`}>{plan.check_in_due ? 'Due now · ' : ''}{formatShortDateTime(plan.next_check_in_at)}</p><p className="mt-1 text-xs text-ink-muted">Owned by {plan.owner.full_name}</p></div></div>{plan.intervention_id && <Link to={interventionPath(plan.intervention_id, returnTo)} className="app-link mt-4 inline-flex min-h-11 items-center gap-1 text-sm">Open plan history <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>}<RecoveryPlanActions plan={plan} onSaved={onSaved} /></section>)}
    </SectionBoundary>
    <SectionBoundary section={sections.help} label="Help requests"><section className="app-surface overflow-hidden"><div className="border-b border-line px-5 py-4 sm:px-6"><h2 className="text-lg font-bold text-ink">Help requests</h2></div>{requests.length ? <div className="divide-y divide-line">{requests.map((request) => <Link to={helpRequestPath(request.id, returnTo)} key={request.id} className="group pressable grid min-h-11 gap-4 px-5 py-4 hover:bg-surface-sunken sm:grid-cols-[minmax(0,1fr)_auto] sm:px-6"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-ink [overflow-wrap:anywhere] group-hover:underline">{request.context_label}</p><Badge tone={request.urgency === 'urgent' ? 'danger' : 'neutral'} className="capitalize">{request.urgency}</Badge><Badge tone={request.status === 'resolved' ? 'success' : request.status === 'open' ? 'pending' : 'neutral'} className="capitalize">{request.status}</Badge></div><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink-secondary [overflow-wrap:anywhere]">{request.message}</p>{request.staff_response && <div className="mt-3 rounded-xl border border-success-200 bg-success-50 p-3 text-sm text-success-800"><span className="font-semibold">Staff response:</span> {request.staff_response}</div>}</div><div className="text-xs font-semibold tabular-nums text-ink-muted">{formatShortDateTime(request.created_at)}</div></Link>)}</div> : <p className="px-6 py-5 text-sm text-ink-muted">No contextual help requests.</p>}</section></SectionBoundary>
  </div>
}

function CommunicationTab({ studentName, opening, onOpen }: { studentName: string; opening: boolean; onOpen: () => void }) {
  return <section className="app-surface p-6"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-sunken text-ink-secondary"><MessageSquareText className="h-6 w-6" aria-hidden="true" /></span><h2 className="mt-5 text-lg font-bold text-ink [overflow-wrap:anywhere]">Conversation with {studentName}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-ink-secondary">Open the cohort-scoped direct conversation. The message thread remains the communication record while this workspace remains the operational student record.</p><Button className="mt-5" onClick={onOpen} disabled={opening}><MessageSquareText className="h-4 w-4" aria-hidden="true" />{opening ? 'Opening conversation…' : 'Open direct message'}</Button></section>
}

function MetricCard({ icon: Icon, label, value, detail, tone }: { icon: typeof UserRound; label: string; value: string; detail: string; tone: 'neutral' | 'success' | 'pending' | 'warning' }) {
  const tones = { neutral: 'bg-surface-sunken text-ink-secondary', success: 'bg-success-50 text-success-700', pending: 'bg-pending-50 text-pending-700', warning: 'bg-warning-50 text-warning-800' }
  return <div className="app-surface p-4 sm:p-5"><span className={`flex h-10 w-10 items-center justify-center rounded-xl ${tones[tone]}`}><Icon className="h-5 w-5" aria-hidden="true" /></span><p className="mt-4 text-3xl font-bold tabular-nums text-ink">{value}</p><p className="mt-1 text-sm font-semibold text-ink-secondary">{label}</p><p className="mt-1 text-xs tabular-nums text-ink-muted">{detail}</p></div>
}

function SubmissionStatus({ submission }: { submission: Submission }) {
  if (submission.grade === null) return <Badge tone="pending" icon={<Clock3 className="h-3.5 w-3.5" aria-hidden="true" />}>Ungraded</Badge>
  if (submission.grade === 'R') return <Badge tone="warning" icon={<RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />}>Redo</Badge>
  return <Badge tone="success" icon={<CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}>Grade {submission.grade}</Badge>
}

function StatusBadge({ status }: { status: string }) {
  return <Badge tone={status === 'active' ? 'success' : 'neutral'} className="capitalize">{status}</Badge>
}

function CountBadge({ count, tone = 'neutral' }: { count: number; tone?: 'neutral' | 'warning' }) {
  return <span className={`rounded-full border px-1.5 text-xs font-semibold tabular-nums ${tone === 'warning' ? 'border-warning-200 bg-warning-50 text-warning-800' : 'border-line bg-surface-sunken text-ink-secondary'}`}>{count}</span>
}

function StudentStepper({ direction, student, cohortId, tab, state }: { direction: 'previous' | 'next'; student: CohortDetail['students'][number] | null; cohortId: number; tab: StudentWorkspaceTab; state?: ReturnContext }) {
  const Icon = direction === 'previous' ? ChevronLeft : ChevronRight
  if (!student) return <span className="hidden h-11 w-28 sm:block" />
  return <Link to={cohortStudentPath(cohortId, student.user_id, tab)} state={state} title={student.full_name || student.email} className={`inline-flex min-h-11 max-w-48 items-center gap-1 rounded-xl px-2 text-xs font-semibold text-ink-secondary transition-colors duration-150 hover:bg-surface-raised hover:text-ink ${direction === 'next' ? 'sm:justify-self-end' : ''}`}>{direction === 'previous' && <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />}<span className="truncate">{student.full_name || student.email}</span>{direction === 'next' && <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />}</Link>
}
