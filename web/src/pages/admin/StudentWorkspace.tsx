import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  ClipboardCheck,
  ExternalLink,
  FileCheck2,
  GraduationCap,
  KeyRound,
  LifeBuoy,
  MessageSquareText,
  RefreshCw,
  RotateCcw,
  UserRound,
  Video,
} from 'lucide-react'
import { api } from '../../lib/api'
import { cohortPath, cohortStudentPath, helpRequestPath, submissionPath, type StudentWorkspaceTab } from '../../lib/routes'
import { formatShortDateTime } from '../../lib/format'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../contexts/ToastContext'
import { EmptyState } from '../../components/shared/EmptyState'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
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
} from '../../types/api'

const tabs: Array<{ id: StudentWorkspaceTab; label: string; icon: typeof UserRound }> = [
  { id: 'overview', label: 'Overview', icon: UserRound },
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
  submissions: Submission[]
  helpRequests: HelpRequest[]
  recordings: StudentRecordingProgress[]
  lessonVideos: StudentLessonVideoProgress[]
  interventions: Intervention[]
  recoveryPlans: RecoveryPlan[]
}

export function StudentWorkspace() {
  const params = useParams<{ cohortId: string; id: string; tab?: string }>()
  const cohortId = Number(params.cohortId)
  const studentId = Number(params.id)
  const activeTab = tabIds.has(params.tab as StudentWorkspaceTab) ? params.tab as StudentWorkspaceTab : 'overview'
  const navigate = useNavigate()
  const toast = useToast()
  const location = useLocation()
  const [data, setData] = useState<WorkspaceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openingMessage, setOpeningMessage] = useState(false)

  const load = useCallback(async () => {
    if (!Number.isInteger(cohortId) || !Number.isInteger(studentId)) {
      setError('This student workspace link is invalid.')
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    const [progressResult, cohortResult, submissionsResult, helpResult, recordingsResult, lessonVideosResult] = await Promise.all([
      api.getStudentProgress(studentId, cohortId),
      api.getCohort(cohortId),
      api.getSubmissions({ user_id: String(studentId) }),
      api.getHelpRequests({ cohort_id: cohortId, student_id: studentId }),
      api.getStudentWatchProgress(studentId, cohortId),
      api.getStudentLessonVideoProgress(studentId, cohortId),
    ])
    if (!progressResult.data || !cohortResult.data) {
      setError(progressResult.error || cohortResult.error || 'Could not load this student workspace.')
      setLoading(false)
      return
    }
    const blockIds = new Set(progressResult.data.modules.flatMap((mod) => mod.lessons.flatMap((lesson) => lesson.blocks.map((block) => block.id))))
    const [interventionsResult, recoveryPlansResult] = await Promise.all([
      api.getInterventions({ enrollment_id: progressResult.data.enrollment.id }),
      api.getRecoveryPlans({ enrollment_id: progressResult.data.enrollment.id }),
    ])
    setData({
      progress: progressResult.data,
      cohort: cohortResult.data.cohort,
      submissions: (submissionsResult.data?.submissions || []).filter((submission) => blockIds.has(submission.content_block_id)),
      helpRequests: helpResult.data?.help_requests || [],
      recordings: recordingsResult.data?.watch_progresses || [],
      lessonVideos: lessonVideosResult.data?.lesson_videos || [],
      interventions: interventionsResult.data?.interventions || [],
      recoveryPlans: recoveryPlansResult.data?.recovery_plans || [],
    })
    setLoading(false)
  }, [cohortId, studentId])

  useEffect(() => { void load() }, [load])

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

  const { progress, cohort, submissions, helpRequests, recordings, lessonVideos, interventions, recoveryPlans } = data
  const studentIndex = cohort.students.findIndex((student) => student.user_id === studentId)
  const previousStudent = studentIndex > 0 ? cohort.students[studentIndex - 1] : null
  const nextStudent = studentIndex >= 0 && studentIndex < cohort.students.length - 1 ? cohort.students[studentIndex + 1] : null
  const ungraded = submissions.filter((submission) => submission.grade === null)
  const openHelp = helpRequests.filter((request) => request.status === 'open' || request.status === 'acknowledged')
  const latestSubmission = ungraded[0] || submissions[0]
  const initials = progress.user.full_name.split(/\s+/).map((name) => name[0]).join('').slice(0, 2).toUpperCase()
  const evidenceScope = progress.learning_evidence_scope
  const sharedEvidence = Boolean(evidenceScope?.shared_across_enrollments)

  return (
    <div className="app-page-wide space-y-6">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm font-semibold text-slate-500">
        <Link to="/admin/students" className="app-link inline-flex min-h-11 items-center gap-1 px-1"><ArrowLeft className="h-4 w-4" />Students</Link>
        <ChevronRight className="h-4 w-4 text-slate-300" />
        <Link to={cohortPath(cohortId)} className="app-link inline-flex min-h-11 items-center px-1">{cohort.name}</Link>
        <ChevronRight className="h-4 w-4 text-slate-300" />
        <span className="px-1 text-slate-700">{progress.user.full_name}</span>
      </nav>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <div className="flex min-w-0 items-start gap-4">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-primary-50 text-lg font-extrabold text-primary-700">
              {progress.user.avatar_url ? <img src={progress.user.avatar_url} alt="" className="h-full w-full object-cover" /> : initials}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-2xl font-extrabold tracking-tight text-slate-950 sm:text-3xl">{progress.user.full_name}</h1>
                <StatusBadge status={progress.enrollment.status} />
              </div>
              <p className="mt-1 truncate text-sm text-slate-500">{progress.user.email}</p>
              <p className="mt-2 text-sm font-bold text-slate-700">{cohort.name} <span className="font-medium text-slate-400">· {cohort.curriculum_name}</span></p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void openDirectMessage()} disabled={openingMessage}><MessageSquareText className="h-4 w-4" />{openingMessage ? 'Opening…' : sharedEvidence ? `Message in ${cohort.name}` : 'Message'}</Button>
            {latestSubmission && <LinkButton to={submissionPath(latestSubmission.id, { cohortId, userId: studentId, returnTo: location.pathname })}><FileCheck2 className="h-4 w-4" />{ungraded.length ? 'Grade next' : 'View latest work'}</LinkButton>}
            <LinkButton to={`/admin/cohorts/${cohortId}/student-view?student_id=${studentId}`} secondary><ExternalLink className="h-4 w-4" />Preview as student</LinkButton>
          </div>
        </div>

        <div className="grid items-center gap-2 border-t border-slate-100 bg-slate-50/70 px-4 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(180px,260px)_minmax(0,1fr)] sm:px-6">
          <StudentStepper direction="previous" student={previousStudent} cohortId={cohortId} tab={activeTab} />
          <label className="grid gap-1 text-center text-[10px] font-extrabold uppercase tracking-wide text-slate-400"><span>{studentIndex >= 0 ? `Student ${studentIndex + 1} of ${cohort.students.length}` : 'Historical enrollment'}</span><select aria-label={`Switch student in ${cohort.name}`} value={studentId} onChange={(event) => navigate(cohortStudentPath(cohortId, Number(event.target.value), activeTab))} className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold normal-case tracking-normal text-slate-800 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100">{cohort.students.map((student) => <option key={student.enrollment_id} value={student.user_id}>{student.full_name || student.email}</option>)}</select></label>
          <StudentStepper direction="next" student={nextStudent} cohortId={cohortId} tab={activeTab} />
        </div>
      </section>

      <nav aria-label="Student workspace sections" className="overflow-x-auto border-b border-slate-200">
        <div className="flex min-w-max gap-1">
          {tabs.map(({ id, label, icon: Icon }) => (
            <NavLink key={id} to={cohortStudentPath(cohortId, studentId, id)} className={({ isActive }) => `inline-flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm font-bold transition ${isActive || activeTab === id && !params.tab ? 'border-primary-600 text-primary-700' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-900'}`}>
              <Icon className="h-4 w-4" />{label}
              {id === 'work' && ungraded.length > 0 && <CountBadge count={ungraded.length} />}
              {id === 'support' && openHelp.length > 0 && <CountBadge count={openHelp.length} tone="red" />}
              {id === 'support' && interventions.some((item) => !['resolved', 'canceled'].includes(item.status)) && <CountBadge count={interventions.filter((item) => !['resolved', 'canceled'].includes(item.status)).length} />}
            </NavLink>
          ))}
        </div>
      </nav>

      {sharedEvidence && evidenceScope && <div className="flex gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950"><BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" /><p><span className="font-extrabold">Curriculum evidence:</span> progress and submitted work follow this learner across {evidenceScope.enrollment_count} enrollments using {evidenceScope.curriculum_name}. Support, recordings, access, and messages on this page remain scoped to {cohort.name}.</p></div>}

      {activeTab === 'overview' && <OverviewTab progress={progress} submissions={submissions} helpRequests={helpRequests} recordings={recordings} lessonVideos={lessonVideos} cohortId={cohortId} studentId={studentId} />}
      {activeTab === 'work' && <WorkTab submissions={submissions} cohortId={cohortId} studentId={studentId} returnTo={location.pathname} />}
      {activeTab === 'learning' && <LearningTab progress={progress} cohortId={cohortId} studentId={studentId} returnTo={location.pathname} />}
      {activeTab === 'support' && <SupportTab requests={helpRequests} interventions={interventions} recoveryPlans={recoveryPlans} cohortId={cohortId} studentId={studentId} />}
      {activeTab === 'communication' && <CommunicationTab studentName={progress.user.full_name} opening={openingMessage} onOpen={() => void openDirectMessage()} />}
      {activeTab === 'access' && <AccessTab progress={progress} />}
    </div>
  )
}

function OverviewTab({ progress, submissions, helpRequests, recordings, lessonVideos, cohortId, studentId }: { progress: StudentProgressResponse; submissions: Submission[]; helpRequests: HelpRequest[]; recordings: StudentRecordingProgress[]; lessonVideos: StudentLessonVideoProgress[]; cohortId: number; studentId: number }) {
  const ungraded = submissions.filter((submission) => submission.grade === null).length
  const redo = submissions.filter((submission) => submission.grade === 'R').length
  const openHelp = helpRequests.filter((request) => ['open', 'acknowledged'].includes(request.status)).length
  const watched = [...recordings, ...lessonVideos].filter((video) => video.completed).length
  const totalVideos = recordings.length + lessonVideos.length
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={GraduationCap} label="Learning progress" value={`${progress.overall_progress.percentage}%`} detail={`${progress.overall_progress.completed} of ${progress.overall_progress.total} checkpoints`} tone="primary" />
        <MetricCard icon={FileCheck2} label="Work waiting" value={String(ungraded)} detail={redo ? `${redo} redo requested` : 'No redo requests'} tone={ungraded ? 'amber' : 'green'} />
        <MetricCard icon={CircleHelp} label="Open support" value={String(openHelp)} detail={`${helpRequests.length} total requests`} tone={openHelp ? 'red' : 'green'} />
        <MetricCard icon={Video} label="Videos completed" value={`${watched}/${totalVideos}`} detail="Recordings and lesson videos" tone="slate" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.8fr)]">
        <section className="app-surface p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-extrabold text-slate-950">Learning at a glance</h2><Link className="app-link text-sm" to={cohortStudentPath(cohortId, studentId, 'learning')}>Open learning</Link></div>
          <div className="mt-5"><ProgressBar value={progress.overall_progress.percentage} size="md" /></div>
          <div className="mt-5 space-y-3">{progress.modules.map((mod) => <div key={mod.id} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px_auto] sm:items-center"><p className="truncate text-sm font-bold text-slate-800">{mod.name}</p><ProgressBar value={mod.progress_percentage} size="sm" /><span className="text-xs font-bold tabular-nums text-slate-500">{mod.completed_blocks}/{mod.total_blocks}</span></div>)}</div>
        </section>
        <ComposedTimeline progress={progress} submissions={submissions} helpRequests={helpRequests} cohortId={cohortId} studentId={studentId} />
      </div>
    </div>
  )
}

function ComposedTimeline({ progress, submissions, helpRequests, cohortId, studentId }: { progress: StudentProgressResponse; submissions: Submission[]; helpRequests: HelpRequest[]; cohortId: number; studentId: number }) {
  const workspacePath = cohortStudentPath(cohortId, studentId, 'overview')
  const events = [
    ...progress.recent_activity.map((activity) => ({ id: `progress-${activity.content_block_id}-${activity.completed_at}`, at: activity.completed_at, title: activity.block_title || 'Learning checkpoint', detail: 'Completed learning checkpoint', path: cohortStudentPath(cohortId, studentId, 'learning'), icon: CheckCircle2, tone: 'green' as const })),
    ...submissions.map((submission) => ({ id: `submission-${submission.id}`, at: submission.created_at, title: submission.content_block_title, detail: submission.grade === null ? 'Submitted for review' : submission.grade === 'R' ? 'Redo requested' : `Graded ${submission.grade}`, path: submissionPath(submission.id, { cohortId, userId: studentId, returnTo: workspacePath }), icon: FileCheck2, tone: submission.grade === 'R' ? 'red' as const : 'primary' as const })),
    ...helpRequests.map((request) => ({ id: `help-${request.id}`, at: request.created_at, title: request.context_label, detail: request.status === 'resolved' ? 'Support request resolved' : `Asked for ${request.urgency === 'urgent' ? 'urgent ' : ''}help`, path: helpRequestPath(request.id, workspacePath), icon: LifeBuoy, tone: request.urgency === 'urgent' ? 'red' as const : 'amber' as const })),
  ].filter((event) => event.at).sort((a, b) => new Date(b.at!).getTime() - new Date(a.at!).getTime()).slice(0, 8)
  const tones = { green: 'bg-green-50 text-green-700', primary: 'bg-primary-50 text-primary-700', red: 'bg-red-50 text-red-700', amber: 'bg-amber-50 text-amber-800' }
  return <section className="app-surface p-5 sm:p-6"><h2 className="text-lg font-extrabold text-slate-950">Connected activity</h2><p className="mt-1 text-xs text-slate-500">Learning, submissions, and support in one timeline.</p>{events.length ? <ol className="mt-4 space-y-1">{events.map((event) => <li key={event.id}><Link to={event.path} className="group flex min-h-11 gap-3 rounded-xl px-1 py-2 hover:bg-slate-50"><span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${tones[event.tone]}`}><event.icon className="h-4 w-4" /></span><div className="min-w-0"><p className="truncate text-sm font-bold text-slate-800 group-hover:text-primary-700">{event.title}</p><p className="text-xs text-slate-500">{event.detail} · {formatShortDateTime(event.at)}</p></div></Link></li>)}</ol> : <p className="mt-4 text-sm text-slate-500">No connected activity yet.</p>}</section>
}

function WorkTab({ submissions, cohortId, studentId, returnTo }: { submissions: Submission[]; cohortId: number; studentId: number; returnTo: string }) {
  if (!submissions.length) return <EmptyState icon={FileCheck2} title="No submitted work yet" description="Submissions for this curriculum will appear here as connected records." />
  return <section className="app-surface overflow-hidden"><div className="border-b border-slate-100 px-5 py-4 sm:px-6"><h2 className="text-lg font-extrabold text-slate-950">All submitted work</h2><p className="mt-1 text-sm text-slate-500">Open any curriculum submission while retaining this selected workspace context.</p></div><div className="divide-y divide-slate-100">{submissions.map((submission) => <Link key={submission.id} to={submissionPath(submission.id, { cohortId, userId: studentId, returnTo })} className="group grid gap-3 px-5 py-4 transition hover:bg-slate-50 sm:grid-cols-[minmax(0,1fr)_180px_auto] sm:items-center sm:px-6"><div><p className="font-extrabold text-slate-900">{submission.content_block_title}</p><p className="text-sm text-slate-500">{submission.module_name} · {submission.lesson_title}</p></div><div><SubmissionStatus submission={submission} /><p className="mt-1 text-xs text-slate-400">{formatShortDateTime(submission.created_at)}</p></div><ChevronRight className="h-4 w-4 text-slate-300 transition group-hover:translate-x-1 group-hover:text-primary-600" /></Link>)}</div></section>
}

function LearningTab({ progress, cohortId, studentId, returnTo }: { progress: StudentProgressResponse; cohortId: number; studentId: number; returnTo: string }) {
  return <div className="space-y-4">{progress.modules.map((mod) => <details key={mod.id} className="app-surface overflow-hidden" open={mod.progress_percentage > 0 && mod.progress_percentage < 100}><summary className="min-h-16 cursor-pointer px-5 py-4 sm:px-6"><div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px_auto] sm:items-center"><div><h2 className="font-extrabold text-slate-950">{mod.name}</h2><p className="text-xs text-slate-500">{mod.completed_blocks} of {mod.total_blocks} checkpoints</p></div><ProgressBar value={mod.progress_percentage} size="sm" /><span className="text-sm font-extrabold text-slate-700">{mod.progress_percentage}%</span></div></summary><div className="divide-y divide-slate-100 border-t border-slate-100">{mod.lessons.map((lesson) => <div key={lesson.id} className="px-5 py-4 sm:px-6"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-bold text-slate-900">{lesson.title}</p><p className="text-xs text-slate-500">{lesson.completed_blocks}/{lesson.total_blocks} checkpoints · {lesson.available ? 'Available' : 'Locked'}</p></div>{lesson.completed && <span className="inline-flex items-center gap-1 text-xs font-bold text-green-700"><CheckCircle2 className="h-4 w-4" />Complete</span>}</div><div className="mt-3 grid gap-2 sm:grid-cols-2">{lesson.blocks.map((block) => block.submission ? <Link key={block.id} to={submissionPath(block.submission.id, { cohortId, userId: studentId, returnTo })} className="flex min-h-11 items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-sm hover:border-primary-300 hover:bg-primary-50"><span className="truncate font-semibold text-slate-700">{block.title}</span><SubmissionStatus submission={{ grade: block.submission.grade } as Submission} /></Link> : <div key={block.id} className="flex min-h-11 items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm"><span className="truncate font-semibold text-slate-700">{block.title}</span><span className="text-xs font-bold capitalize text-slate-400">{block.status.replace('_', ' ')}</span></div>)}</div></div>)}</div></details>)}</div>
}

function SupportTab({ requests, interventions, recoveryPlans, cohortId, studentId }: { requests: HelpRequest[]; interventions: Intervention[]; recoveryPlans: RecoveryPlan[]; cohortId: number; studentId: number }) {
  const returnTo = cohortStudentPath(cohortId, studentId, 'support')
  if (!requests.length && !interventions.length && !recoveryPlans.length) return <EmptyState icon={LifeBuoy} title="No support history" description="Help requests, owned interventions, and recovery plans for this enrollment will collect here." action={<LinkButton to="/admin/support" secondary><ClipboardCheck className="h-4 w-4" />Open support queue</LinkButton>} />
  return <div className="space-y-6">
    <section className="app-surface overflow-hidden"><div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:px-6"><div><h2 className="text-lg font-extrabold text-slate-950">Owned interventions</h2><p className="mt-1 text-sm text-slate-500">Staff-only ownership, actions, follow-ups, notes, and outcomes.</p></div><Link className="app-link text-sm" to="/admin/support">Support queue</Link></div>{interventions.length ? <div className="divide-y divide-slate-100">{interventions.map((item) => <Link to={`/admin/interventions/${item.id}?return_to=${encodeURIComponent(returnTo)}`} key={item.id} className={`group grid gap-3 px-5 py-4 transition hover:bg-slate-50 sm:grid-cols-[minmax(0,1fr)_160px_auto] sm:items-center sm:px-6 ${item.follow_up_due ? 'bg-red-50/60' : ''}`}><div><div className="flex flex-wrap items-center gap-2"><p className="font-extrabold capitalize text-slate-950 group-hover:text-primary-700">{item.trigger_type.replaceAll('_', ' ')}</p><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold capitalize text-slate-700">{item.status.replaceAll('_', ' ')}</span></div><p className="mt-1 line-clamp-2 text-sm text-slate-600">{item.action_summary || 'No action summary yet.'}</p></div><div><p className={`text-xs font-extrabold ${item.follow_up_due ? 'text-red-700' : 'text-slate-400'}`}>{item.follow_up_due ? 'FOLLOW-UP DUE' : 'NEXT FOLLOW-UP'}</p><p className="mt-1 text-xs font-bold text-slate-600">{formatShortDateTime(item.next_follow_up_at)}</p></div><ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-primary-700" /></Link>)}</div> : <p className="px-6 py-5 text-sm text-slate-500">No interventions have been opened for this enrollment.</p>}</section>
    {recoveryPlans.map((plan) => <section key={plan.id} className={`rounded-2xl border p-5 sm:p-6 ${plan.check_in_due ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'}`}><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="app-eyebrow">Recovery plan</p><h2 className="mt-1 text-lg font-extrabold text-slate-950">{plan.target_pace}</h2></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-extrabold capitalize text-slate-700">{plan.status}</span></div><div className="mt-4 grid gap-4 sm:grid-cols-2"><div><p className="text-xs font-extrabold uppercase tracking-wide text-slate-400">Required scope</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">{plan.required_scope}</p></div><div><p className="text-xs font-extrabold uppercase tracking-wide text-slate-400">Check-in</p><p className={`mt-1 text-sm font-bold ${plan.check_in_due ? 'text-amber-800' : 'text-slate-700'}`}>{plan.check_in_due ? 'Due now · ' : ''}{formatShortDateTime(plan.next_check_in_at)}</p><p className="mt-1 text-xs text-slate-500">Owned by {plan.owner.full_name}</p></div></div>{plan.intervention_id && <Link to={`/admin/interventions/${plan.intervention_id}?return_to=${encodeURIComponent(returnTo)}`} className="app-link mt-4 inline-flex min-h-11 items-center gap-1 text-sm font-bold">Open plan history <ArrowRight className="h-4 w-4" /></Link>}</section>)}
    <section className="app-surface overflow-hidden"><div className="border-b border-slate-100 px-5 py-4 sm:px-6"><h2 className="text-lg font-extrabold text-slate-950">Help requests</h2></div>{requests.length ? <div className="divide-y divide-slate-100">{requests.map((request) => <Link to={helpRequestPath(request.id)} key={request.id} className="group grid gap-4 px-5 py-4 transition hover:bg-slate-50 sm:grid-cols-[minmax(0,1fr)_auto] sm:px-6"><div><div className="flex flex-wrap items-center gap-2"><p className="font-extrabold text-slate-950 group-hover:text-primary-700">{request.context_label}</p><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold capitalize ${request.urgency === 'urgent' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>{request.urgency}</span><span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold capitalize text-amber-800">{request.status}</span></div><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{request.message}</p>{request.staff_response && <div className="mt-3 rounded-xl bg-green-50 p-3 text-sm text-green-900"><span className="font-bold">Staff response:</span> {request.staff_response}</div>}</div><div className="text-xs font-semibold text-slate-400">{formatShortDateTime(request.created_at)}</div></Link>)}</div> : <p className="px-6 py-5 text-sm text-slate-500">No contextual help requests.</p>}</section>
  </div>
}

function CommunicationTab({ studentName, opening, onOpen }: { studentName: string; opening: boolean; onOpen: () => void }) {
  return <section className="app-surface p-6"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-50 text-primary-700"><MessageSquareText className="h-6 w-6" /></span><h2 className="mt-5 text-xl font-extrabold text-slate-950">Conversation with {studentName}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Open the cohort-scoped direct conversation. The message thread remains the communication record while this workspace remains the operational student record.</p><Button className="mt-5" onClick={onOpen} disabled={opening}><MessageSquareText className="h-4 w-4" />{opening ? 'Opening conversation…' : 'Open direct message'}</Button></section>
}

function AccessTab({ progress }: { progress: StudentProgressResponse }) {
  return <div className="grid gap-6 lg:grid-cols-2"><section className="app-surface p-5 sm:p-6"><h2 className="text-lg font-extrabold text-slate-950">Enrollment access</h2><dl className="mt-4 grid gap-4 text-sm"><InfoRow label="Enrollment status" value={progress.enrollment.status} /><InfoRow label="Cohort status" value={progress.cohort.status} /><InfoRow label="Last sign in" value={formatShortDateTime(progress.user.last_sign_in_at, 'Never')} /><InfoRow label="Last activity" value={formatShortDateTime(progress.user.last_seen_at, 'No activity yet')} /></dl></section><section className="app-surface p-5 sm:p-6"><h2 className="text-lg font-extrabold text-slate-950">Advanced controls</h2><p className="mt-2 text-sm leading-6 text-slate-600">Module and lesson overrides, enrollment changes, and restart controls remain in the existing administrative profile while they are migrated into connected records.</p><Link className="app-link mt-5 inline-flex min-h-11 items-center gap-2 text-sm font-bold" to={`/admin/students/${progress.user.id}?legacy=1&cohort_id=${progress.cohort.id}`}><KeyRound className="h-4 w-4" />Open advanced access controls <ArrowRight className="h-4 w-4" /></Link></section></div>
}

function MetricCard({ icon: Icon, label, value, detail, tone }: { icon: typeof UserRound; label: string; value: string; detail: string; tone: 'primary' | 'green' | 'amber' | 'red' | 'slate' }) {
  const tones = { primary: 'bg-primary-50 text-primary-700', green: 'bg-green-50 text-green-700', amber: 'bg-amber-50 text-amber-800', red: 'bg-red-50 text-red-700', slate: 'bg-slate-100 text-slate-600' }
  return <div className="app-surface p-4 sm:p-5"><span className={`flex h-10 w-10 items-center justify-center rounded-xl ${tones[tone]}`}><Icon className="h-5 w-5" /></span><p className="mt-4 text-3xl font-extrabold tabular-nums text-slate-950">{value}</p><p className="mt-1 text-sm font-bold text-slate-700">{label}</p><p className="mt-1 text-xs text-slate-500">{detail}</p></div>
}

function SubmissionStatus({ submission }: { submission: Submission }) {
  if (submission.grade === null) return <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-800"><Clock3 className="h-3.5 w-3.5" />Ungraded</span>
  if (submission.grade === 'R') return <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 text-xs font-bold text-red-700"><RotateCcw className="h-3.5 w-3.5" />Redo</span>
  return <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-1 text-xs font-bold text-green-700"><CheckCircle2 className="h-3.5 w-3.5" />Grade {submission.grade}</span>
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`rounded-full px-2.5 py-1 text-xs font-bold capitalize ${status === 'active' ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-600'}`}>{status}</span>
}

function CountBadge({ count, tone = 'primary' }: { count: number; tone?: 'primary' | 'red' }) {
  return <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-extrabold ${tone === 'red' ? 'bg-red-100 text-red-700' : 'bg-primary-100 text-primary-700'}`}>{count}</span>
}

function LinkButton({ to, secondary = false, children }: { to: string; secondary?: boolean; children: ReactNode }) {
  return <Link to={to} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2 ${secondary ? 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50' : 'bg-primary-600 text-white hover:bg-primary-700'}`}>{children}</Link>
}

function StudentStepper({ direction, student, cohortId, tab }: { direction: 'previous' | 'next'; student: CohortDetail['students'][number] | null; cohortId: number; tab: StudentWorkspaceTab }) {
  const Icon = direction === 'previous' ? ChevronLeft : ChevronRight
  if (!student) return <span className="h-11 w-28" />
  return <Link to={cohortStudentPath(cohortId, student.user_id, tab)} className="inline-flex min-h-11 max-w-48 items-center gap-1 rounded-xl px-2 text-xs font-bold text-slate-600 hover:bg-white hover:text-primary-700">{direction === 'previous' && <Icon className="h-4 w-4" />}<span className="truncate">{student.full_name || student.email}</span>{direction === 'next' && <Icon className="h-4 w-4" />}</Link>
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-3 last:border-0"><dt className="font-semibold text-slate-500">{label}</dt><dd className="text-right font-bold capitalize text-slate-900">{value}</dd></div>
}
