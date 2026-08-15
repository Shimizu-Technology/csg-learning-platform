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
import { cohortPath, cohortStudentPath, submissionPath, type StudentWorkspaceTab } from '../../lib/routes'
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
    setData({
      progress: progressResult.data,
      cohort: cohortResult.data.cohort,
      submissions: (submissionsResult.data?.submissions || []).filter((submission) => blockIds.has(submission.content_block_id)),
      helpRequests: helpResult.data?.help_requests || [],
      recordings: recordingsResult.data?.watch_progresses || [],
      lessonVideos: lessonVideosResult.data?.lesson_videos || [],
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

  const { progress, cohort, submissions, helpRequests, recordings, lessonVideos } = data
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
            <LinkButton to={`/admin/cohorts/${cohortId}/student-view`} secondary><ExternalLink className="h-4 w-4" />Preview cohort</LinkButton>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/70 px-4 py-2 sm:px-6">
          <StudentStepper direction="previous" student={previousStudent} cohortId={cohortId} tab={activeTab} />
          <p className="text-xs font-bold tabular-nums text-slate-400">{studentIndex >= 0 ? `${studentIndex + 1} of ${cohort.students.length}` : 'Historical enrollment'}</p>
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
            </NavLink>
          ))}
        </div>
      </nav>

      {sharedEvidence && evidenceScope && <div className="flex gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950"><BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" /><p><span className="font-extrabold">Curriculum evidence:</span> progress and submitted work follow this learner across {evidenceScope.enrollment_count} enrollments using {evidenceScope.curriculum_name}. Support, recordings, access, and messages on this page remain scoped to {cohort.name}.</p></div>}

      {activeTab === 'overview' && <OverviewTab progress={progress} submissions={submissions} helpRequests={helpRequests} recordings={recordings} lessonVideos={lessonVideos} cohortId={cohortId} studentId={studentId} />}
      {activeTab === 'work' && <WorkTab submissions={submissions} cohortId={cohortId} studentId={studentId} returnTo={location.pathname} />}
      {activeTab === 'learning' && <LearningTab progress={progress} cohortId={cohortId} studentId={studentId} returnTo={location.pathname} />}
      {activeTab === 'support' && <SupportTab requests={helpRequests} />}
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
        <section className="app-surface p-5 sm:p-6">
          <h2 className="text-lg font-extrabold text-slate-950">Recent activity</h2>
          {progress.recent_activity.length ? <div className="mt-4 space-y-4">{progress.recent_activity.slice(0, 5).map((activity) => <div key={`${activity.content_block_id}-${activity.completed_at}`} className="flex gap-3"><span className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-green-50 text-green-700"><CheckCircle2 className="h-4 w-4" /></span><div><p className="text-sm font-bold text-slate-800">{activity.block_title}</p><p className="text-xs text-slate-500">Completed {formatShortDateTime(activity.completed_at)}</p></div></div>)}</div> : <p className="mt-4 text-sm text-slate-500">No completed learning activity yet.</p>}
        </section>
      </div>
    </div>
  )
}

function WorkTab({ submissions, cohortId, studentId, returnTo }: { submissions: Submission[]; cohortId: number; studentId: number; returnTo: string }) {
  if (!submissions.length) return <EmptyState icon={FileCheck2} title="No submitted work yet" description="Submissions for this curriculum will appear here as connected records." />
  return <section className="app-surface overflow-hidden"><div className="border-b border-slate-100 px-5 py-4 sm:px-6"><h2 className="text-lg font-extrabold text-slate-950">All submitted work</h2><p className="mt-1 text-sm text-slate-500">Open any curriculum submission while retaining this selected workspace context.</p></div><div className="divide-y divide-slate-100">{submissions.map((submission) => <Link key={submission.id} to={submissionPath(submission.id, { cohortId, userId: studentId, returnTo })} className="group grid gap-3 px-5 py-4 transition hover:bg-slate-50 sm:grid-cols-[minmax(0,1fr)_180px_auto] sm:items-center sm:px-6"><div><p className="font-extrabold text-slate-900">{submission.content_block_title}</p><p className="text-sm text-slate-500">{submission.module_name} · {submission.lesson_title}</p></div><div><SubmissionStatus submission={submission} /><p className="mt-1 text-xs text-slate-400">{formatShortDateTime(submission.created_at)}</p></div><ChevronRight className="h-4 w-4 text-slate-300 transition group-hover:translate-x-1 group-hover:text-primary-600" /></Link>)}</div></section>
}

function LearningTab({ progress, cohortId, studentId, returnTo }: { progress: StudentProgressResponse; cohortId: number; studentId: number; returnTo: string }) {
  return <div className="space-y-4">{progress.modules.map((mod) => <details key={mod.id} className="app-surface overflow-hidden" open={mod.progress_percentage > 0 && mod.progress_percentage < 100}><summary className="min-h-16 cursor-pointer px-5 py-4 sm:px-6"><div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px_auto] sm:items-center"><div><h2 className="font-extrabold text-slate-950">{mod.name}</h2><p className="text-xs text-slate-500">{mod.completed_blocks} of {mod.total_blocks} checkpoints</p></div><ProgressBar value={mod.progress_percentage} size="sm" /><span className="text-sm font-extrabold text-slate-700">{mod.progress_percentage}%</span></div></summary><div className="divide-y divide-slate-100 border-t border-slate-100">{mod.lessons.map((lesson) => <div key={lesson.id} className="px-5 py-4 sm:px-6"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-bold text-slate-900">{lesson.title}</p><p className="text-xs text-slate-500">{lesson.completed_blocks}/{lesson.total_blocks} checkpoints · {lesson.available ? 'Available' : 'Locked'}</p></div>{lesson.completed && <span className="inline-flex items-center gap-1 text-xs font-bold text-green-700"><CheckCircle2 className="h-4 w-4" />Complete</span>}</div><div className="mt-3 grid gap-2 sm:grid-cols-2">{lesson.blocks.map((block) => block.submission ? <Link key={block.id} to={submissionPath(block.submission.id, { cohortId, userId: studentId, returnTo })} className="flex min-h-11 items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-sm hover:border-primary-300 hover:bg-primary-50"><span className="truncate font-semibold text-slate-700">{block.title}</span><SubmissionStatus submission={{ grade: block.submission.grade } as Submission} /></Link> : <div key={block.id} className="flex min-h-11 items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm"><span className="truncate font-semibold text-slate-700">{block.title}</span><span className="text-xs font-bold capitalize text-slate-400">{block.status.replace('_', ' ')}</span></div>)}</div></div>)}</div></details>)}</div>
}

function SupportTab({ requests }: { requests: HelpRequest[] }) {
  if (!requests.length) return <EmptyState icon={LifeBuoy} title="No support requests" description="Contextual help requests for this student and cohort will collect here." />
  return <section className="app-surface overflow-hidden"><div className="divide-y divide-slate-100">{requests.map((request) => <div key={request.id} className="grid gap-4 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:px-6"><div><div className="flex flex-wrap items-center gap-2"><p className="font-extrabold text-slate-950">{request.context_label}</p><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold capitalize ${request.urgency === 'urgent' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>{request.urgency}</span><span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold capitalize text-amber-800">{request.status}</span></div><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{request.message}</p>{request.staff_response && <div className="mt-3 rounded-xl bg-green-50 p-3 text-sm text-green-900"><span className="font-bold">Staff response:</span> {request.staff_response}</div>}</div><div className="text-xs font-semibold text-slate-400">{formatShortDateTime(request.created_at)}</div></div>)}</div></section>
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
