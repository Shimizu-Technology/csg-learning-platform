import type { ReturnContext } from '../../../lib/navigationContext'
import {
  CheckCircle2,
  CircleHelp,
  FileCheck2,
  GraduationCap,
  LifeBuoy,
  RotateCcw,
  UserRound,
  Video,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { ProgressBar } from '../../../components/shared/ProgressBar'
import { RecordLink } from '../../../components/shared/RecordLink'
import { PreviewLink as Link } from '../../../contexts/PreviewNavigationContext'
import { formatShortDateTime } from '../../../lib/format'
import { lessonsLabel } from '../../../lib/progressLabel'
import { cohortStudentPath, helpRequestPath, submissionPath } from '../../../lib/routes'
import { SectionBoundary, type Section } from '../../../lib/useSection'
import type {
  HelpRequest,
  StudentLessonVideoProgress,
  StudentProgressResponse,
  StudentRecordingProgress,
  Submission,
} from '../../../types/api'

export function OverviewTab({
  aside,
  returnState,
  sections,
  progress,
  submissions,
  helpRequests,
  cohortId,
  studentId,
}: {
  aside?: ReactNode
  returnState?: ReturnContext
  sections: {
    submissions: Section<Submission[]>
    help: Section<HelpRequest[]>
    recordings: Section<StudentRecordingProgress[]>
    videos: Section<StudentLessonVideoProgress[]>
  }
  progress: StudentProgressResponse
  submissions: Submission[]
  helpRequests: HelpRequest[]
  cohortId: number
  studentId: number
}) {
  const ungraded = progress.status?.ungraded_count
  const redo = progress.status?.redo_count
  const openHelp = progress.status?.help_request_count
  const learningPath = cohortStudentPath(cohortId, studentId, 'learning')
  const workPath = cohortStudentPath(cohortId, studentId, 'work')
  const location = useLocation()
  const currentPath = `${location.pathname}${location.search}`
  const queueParams = new URLSearchParams({
    cohort_id: String(cohortId),
    student_id: String(studentId),
    return_to: currentPath,
  })
  const supportPath = `/admin/support?${queueParams}&view=active`
  const media = progress.media_summary
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
        <MetricCard
          to={learningPath}
          state={returnState}
          icon={GraduationCap}
          label="Learning progress"
          value={`${progress.overall_progress.percentage}%`}
          detail={lessonsLabel(progress.overall_progress)}
          tone="neutral"
        />
        <MetricCard
          to={`/admin/grading?${queueParams}&filter=ungraded`}
          icon={FileCheck2}
          label="Work waiting"
          value={ungraded === undefined ? 'Unavailable' : String(ungraded)}
          detail="Waiting for review"
          tone={ungraded ? 'pending' : 'neutral'}
        />
        <MetricCard
          to={`${workPath}?filter=redo`}
          icon={RotateCcw}
          label="Redo open"
          value={redo === undefined ? 'Unavailable' : String(redo)}
          detail={redo ? 'Redo requested' : 'No redo requests'}
          tone={redo ? 'warning' : 'neutral'}
        />
        <MetricCard
          to={supportPath}
          icon={CircleHelp}
          label="Open support"
          value={openHelp === undefined ? 'Unavailable' : String(openHelp)}
          detail="Help requests"
          tone={openHelp ? 'warning' : 'neutral'}
        />
        <SectionBoundary section={sections.recordings} label="Recordings">
          <MetricCard
            to={`${learningPath}#recordings`}
            state={returnState}
            icon={Video}
            label="Recordings completed"
            value={media ? `${media.recordings_completed}/${media.recordings_total}` : 'Unavailable'}
            detail="Class recordings"
            tone="neutral"
          />
        </SectionBoundary>
        <SectionBoundary section={sections.videos} label="Lesson videos">
          <MetricCard
            to={`${learningPath}#lesson-videos`}
            state={returnState}
            icon={Video}
            label="Lesson videos completed"
            value={media ? `${media.lesson_videos_completed}/${media.lesson_videos_total}` : 'Unavailable'}
            detail="Assigned lesson videos"
            tone="neutral"
          />
        </SectionBoundary>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.8fr)]">
        <section className="app-surface p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-ink">Learning at a glance</h2>
            <Link
              className="app-link text-sm"
              to={cohortStudentPath(cohortId, studentId, 'learning')}
              state={returnState}
            >
              All modules
            </Link>
          </div>
          <div className="mt-5">
            <ProgressBar value={progress.overall_progress.percentage} size="md" />
          </div>
          <div className="mt-5 space-y-3">
            {progress.modules.map((mod) => (
              <div key={mod.id} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px_auto] sm:items-center">
                <p className="truncate text-sm font-semibold text-ink" title={mod.name}>
                  <RecordLink record={{ type: 'module', id: mod.id, cohortId }} variant="plain" touchTarget truncate>
                    {mod.name}
                  </RecordLink>
                </p>
                <ProgressBar value={mod.progress_percentage} size="sm" />
                <span className="text-xs font-semibold tabular-nums text-ink-muted">{lessonsLabel(mod)}</span>
              </div>
            ))}
          </div>
        </section>
        <div className="space-y-3">
          {aside}
          {(sections.submissions.status !== 'success' || sections.help.status !== 'success') && (
            <p className="text-sm text-ink-muted">Recent events are incomplete while work or help is unavailable.</p>
          )}
          <ComposedTimeline
            incomplete={sections.submissions.status !== 'success' || sections.help.status !== 'success'}
            progress={progress}
            submissions={submissions}
            helpRequests={helpRequests}
            cohortId={cohortId}
            studentId={studentId}
          />
        </div>
      </div>
    </div>
  )
}

export function ComposedTimeline({
  incomplete,
  progress,
  submissions,
  helpRequests,
  cohortId,
  studentId,
}: {
  incomplete: boolean
  progress: StudentProgressResponse
  submissions: Submission[]
  helpRequests: HelpRequest[]
  cohortId: number
  studentId: number
}) {
  const workspacePath = cohortStudentPath(cohortId, studentId, 'overview')
  // A submitted step also has a completed progress record; the submission row
  // already says so, so it isn't listed twice (U-0.5).
  const submittedBlocks = new Set(submissions.map((submission) => submission.content_block_id))
  const events = [
    ...progress.recent_activity
      .filter((activity) => !submittedBlocks.has(activity.content_block_id))
      .map((activity) => ({
        id: `progress-${activity.content_block_id}-${activity.completed_at}`,
        at: activity.completed_at,
        title: activity.block_title || 'Learning checkpoint',
        detail: 'Completed learning checkpoint',
        path: cohortStudentPath(cohortId, studentId, 'learning'),
        icon: CheckCircle2,
        tone: 'success' as const,
      })),
    ...submissions.map((submission) => ({
      id: `submission-${submission.id}`,
      at: submission.created_at,
      title: submission.content_block_title,
      detail:
        submission.grade === null
          ? 'Waiting for review'
          : submission.grade === 'R'
            ? 'Redo requested'
            : submission.grade === 'P'
              ? 'Passed'
              : `Graded ${submission.grade}`,
      path: submissionPath(submission.id, { cohortId, userId: studentId, returnTo: workspacePath }),
      icon: FileCheck2,
      tone:
        submission.grade === 'R'
          ? ('warning' as const)
          : submission.grade === null
            ? ('pending' as const)
            : ('neutral' as const),
    })),
    ...helpRequests.map((request) => ({
      id: `help-${request.id}`,
      at: request.created_at,
      title: request.context_label,
      detail:
        request.status === 'resolved'
          ? 'Support request resolved'
          : `Asked for ${request.urgency === 'urgent' ? 'urgent ' : ''}help`,
      path: helpRequestPath(request.id, workspacePath),
      icon: LifeBuoy,
      tone: request.urgency === 'urgent' ? ('danger' as const) : ('warning' as const),
    })),
  ]
    .filter((event) => event.at)
    .sort((a, b) => new Date(b.at!).getTime() - new Date(a.at!).getTime())
    .slice(0, 8)
  const tones = {
    success: 'bg-success-soft text-success-ink',
    neutral: 'bg-surface-sunken text-ink-secondary',
    pending: 'bg-surface-sunken text-ink-secondary',
    warning: 'bg-warning-soft text-warning-ink',
    danger: 'bg-danger-soft text-danger-ink',
  }
  return (
    <section className="app-surface p-5 sm:p-6">
      <h2 className="text-lg font-bold text-ink">Connected activity</h2>
      <p className="mt-1 text-xs text-ink-muted">Learning, submissions, and support in one timeline.</p>
      {events.length ? (
        <ol className="mt-4 space-y-1">
          {events.map((event) => (
            <li key={event.id}>
              <Link
                to={event.path}
                className="group pressable flex min-h-11 gap-3 rounded-xl px-1 py-2 hover:bg-surface-sunken"
              >
                <span
                  className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${tones[event.tone]}`}
                >
                  <event.icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p
                    className="truncate text-sm font-semibold text-ink group-hover:underline"
                    title={event.title ?? undefined}
                  >
                    {event.title}
                  </p>
                  <p className="text-xs tabular-nums text-ink-muted">
                    {event.detail} · {formatShortDateTime(event.at)}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-4 text-sm text-ink-muted">
          {incomplete
            ? 'Some activity sources are unavailable. Retry above to see the full history.'
            : 'No connected activity yet.'}
        </p>
      )}
    </section>
  )
}

export function MetricCard({
  to,
  state,
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  to: string
  state?: ReturnContext
  icon: typeof UserRound
  label: string
  value: string
  detail: string
  tone: 'neutral' | 'success' | 'pending' | 'warning'
}) {
  const tones = {
    neutral: 'bg-surface-sunken text-ink-secondary',
    success: 'bg-success-soft text-success-ink',
    pending: 'bg-surface-sunken text-ink-secondary',
    warning: 'bg-warning-soft text-warning-ink',
  }
  return (
    <Link
      to={to}
      state={state}
      className="app-surface block min-h-11 p-4 hover:border-line-strong hover:bg-surface-hover sm:p-5"
    >
      <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${tones[tone]}`}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <p className="mt-4 text-3xl font-bold tabular-nums text-ink">{value}</p>
      <p className="mt-1 text-sm font-semibold text-ink-secondary">{label}</p>
      <p className="mt-1 text-xs tabular-nums text-ink-muted">{detail}</p>
    </Link>
  )
}
