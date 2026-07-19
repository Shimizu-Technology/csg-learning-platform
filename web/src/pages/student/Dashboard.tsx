import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, BookOpen, Clock, Lock, PlayCircle, CalendarDays, CheckCircle2, RotateCcw, RefreshCw, WifiOff, Link2, ExternalLink } from 'lucide-react'
import { api } from '../../lib/api'
import { useAuthContext } from '../../contexts/AuthContext'
import { ProgressRing } from '../../components/shared/ProgressRing'
import { ProgressBar } from '../../components/shared/ProgressBar'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { EmptyState } from '../../components/shared/EmptyState'
import { formatShortDateTime } from '../../lib/format'
import { sanitizeUrl } from '../../lib/sanitizeUrl'
import type { DashboardData } from '../../types/api'

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return 'TBD'
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

interface DashboardProps {
  previewData?: DashboardData
  previewBanner?: ReactNode
  disableStaffRedirect?: boolean
}

export function Dashboard({ previewData, previewBanner, disableStaffRedirect = false }: DashboardProps = {}) {
  const { user } = useAuthContext()
  const navigate = useNavigate()
  const [data, setData] = useState<DashboardData | null>(previewData || null)
  const [loading, setLoading] = useState(!previewData)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showingSavedData, setShowingSavedData] = useState(false)

  const announcementTimestamp = (dateStr?: string | null) => {
    if (!dateStr) return 0
    return new Date(dateStr).getTime()
  }

  const loadDashboard = useCallback(() => {
    if (previewData) {
      setData(previewData)
      setLoading(false)
      return
    }

    if (user?.is_staff && !disableStaffRedirect) {
      navigate('/admin', { replace: true })
      return
    }

    setLoading(true)
    setLoadError(null)
    setShowingSavedData(false)

    api.getDashboard()
      .then((res) => {
        if (res.data) {
          setData(res.data.dashboard)
          setShowingSavedData(Boolean(res.fromCache))
          setLoadError(res.fromCache ? res.error : null)
          return
        }

        setLoadError(res.error || 'Unable to load your dashboard right now.')
      })
      .catch((error: unknown) => {
        setLoadError(error instanceof Error ? error.message : 'Unable to load your dashboard right now.')
      })
      .finally(() => setLoading(false))
  }, [disableStaffRedirect, navigate, previewData, user])

  useEffect(() => {
    loadDashboard()
  }, [loadDashboard])

  const retryAction = (
    <button
      type="button"
      onClick={loadDashboard}
      className="inline-flex items-center gap-2 rounded-lg bg-primary-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-600"
    >
      <RefreshCw className="h-4 w-4" />
      Try again
    </button>
  )

  const derived = useMemo(() => {
    const modules = data?.modules || []
    const availableLessons = modules.flatMap((mod) =>
      mod.lessons
        .filter((lesson) => lesson.available)
        .map((lesson) => ({ ...lesson, moduleId: mod.id, moduleName: mod.name }))
    )
    const incompleteAvailableLessons = availableLessons.filter((lesson) => !lesson.completed)

    const nextAvailableLesson = incompleteAvailableLessons[0] || null

    const lockedLessons = modules.flatMap((mod) =>
      mod.lessons
        .filter((lesson) => !lesson.available)
        .map((lesson) => ({ ...lesson, moduleId: mod.id, moduleName: mod.name }))
    )

    const nextLockedLesson = lockedLessons
      .sort((a, b) => unlockTime(a.unlock_date) - unlockTime(b.unlock_date))[0] || null

    const completedModules = modules.filter((mod) => mod.total_blocks > 0 && mod.completed_blocks === mod.total_blocks).length
    const activeModules = modules.filter((mod) => mod.available && mod.total_blocks > 0 && mod.completed_blocks < mod.total_blocks).length
    const lessonsWithWindows = modules.flatMap((mod) => mod.lessons.map((lesson) => ({ ...lesson, moduleId: mod.id, moduleName: mod.name })))
    const nextSubmissionDeadline = lessonsWithWindows
      .filter((lesson) => lesson.available && lesson.submission_window?.submissions_close_at && !lesson.submission_window.submissions_closed)
      .sort((a, b) => unlockTime(a.submission_window?.submissions_close_at) - unlockTime(b.submission_window?.submissions_close_at))[0] || null
    const closedSubmissionWindowCount = new Set(
      lessonsWithWindows
        .filter((lesson) => lesson.submission_window?.submissions_closed)
        .map((lesson) => `${lesson.moduleId}:${lesson.submission_window?.week_number}`)
    ).size

    return {
      nextAvailableLesson,
      nextLockedLesson,
      nextSubmissionDeadline,
      closedSubmissionWindowCount,
      completedModules,
      activeModules,
      availableLessonsCount: incompleteAvailableLessons.length,
    }
  }, [data])

  if (loading) return <LoadingSpinner message="Loading dashboard..." />

  if (loadError && !data) {
    return (
      <EmptyState
        icon={WifiOff}
        title="Could not load dashboard"
        description={loadError}
        action={retryAction}
      />
    )
  }

  if (!data?.enrolled) {
    return (
      <EmptyState
        icon={BookOpen}
        title="Not enrolled yet"
        description="You haven't been enrolled in a cohort yet. Contact your instructor for access."
      />
    )
  }

  const progress = data.overall_progress

  return (
    <div className="app-page max-w-5xl">
      {previewBanner}
      {showingSavedData && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Showing saved dashboard data while your connection catches up.
        </div>
      )}
      <section className="relative overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-[0_20px_60px_rgba(15,23,42,0.06)] sm:p-7">
        <span className="absolute inset-y-0 left-0 w-1.5 bg-primary-600" />
        <div className="flex flex-col gap-7 lg:flex-row lg:items-center">
          <div className="flex-1">
            <p className="app-eyebrow">Today</p>
            <h1 className="mt-2 text-3xl font-extrabold tracking-[-0.035em] text-slate-950 sm:text-4xl">
              Welcome back, {data.user.full_name.split(' ')[0]}
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-500 sm:text-base">
              {data.cohort?.name} · {progress?.completed || 0} of {progress?.total || 0} blocks completed
            </p>

            {derived.nextAvailableLesson ? (
              <div className="mt-6 rounded-2xl bg-slate-950 p-4 text-white sm:p-5">
                <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-primary-300">Continue your path</p>
                <p className="mt-1.5 text-lg font-extrabold tracking-tight text-white">{derived.nextAvailableLesson.title}</p>
                <p className="mt-0.5 text-sm text-slate-400">{derived.nextAvailableLesson.moduleName}</p>
                <Link
                  to={`/lessons/${derived.nextAvailableLesson.id}`}
                  className="group mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-primary-500"
                >
                  Continue learning
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </Link>
              </div>
            ) : derived.nextLockedLesson ? (
              <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-100/70 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Upcoming</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">{derived.nextLockedLesson.title}</p>
                <p className="text-sm text-slate-500">
                  {derived.nextLockedLesson.moduleName} · unlocks {formatDate(derived.nextLockedLesson.unlock_date)}
                </p>
              </div>
            ) : (
              <div className="mt-6 flex items-center gap-3 rounded-2xl border border-green-200 bg-green-50 p-4">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" />
                <p className="text-sm font-bold text-green-800">You’re fully caught up right now.</p>
              </div>
            )}
          </div>

          {progress && (
            <div className="flex shrink-0 flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
              <ProgressRing percentage={progress.percentage} size={90} label="Overall" />
              <div className="grid grid-cols-2 gap-2 text-center text-xs text-slate-500 w-full min-w-[180px]">
                <div className="rounded-xl bg-white border border-slate-200 px-3 py-2">
                  <p className="text-lg font-semibold text-slate-900">{derived.activeModules}</p>
                  <p>Active modules</p>
                </div>
                <div className="rounded-xl bg-white border border-slate-200 px-3 py-2">
                  <p className="text-lg font-semibold text-slate-900">{derived.completedModules}</p>
                  <p>Completed</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {data.action_items && data.action_items.length > 0 && (
        <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 sm:p-5">
          <h2 className="flex items-center gap-2 text-sm font-extrabold text-amber-900">
            <RotateCcw className="h-4 w-4" />
            Feedback needs your attention
          </h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {data.action_items.map((item, i) => (
              <li key={i}>
                <Link to={`/lessons/${item.lesson_id}`} className="group block h-full rounded-xl border border-amber-200 bg-white p-3.5 transition hover:-translate-y-0.5 hover:border-amber-300 hover:shadow-md hover:shadow-amber-900/5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-slate-950">{item.content_block_title}</p>
                      <p className="truncate text-xs text-slate-500">{item.lesson_title}</p>
                    </div>
                    <ArrowRight className="h-4 w-4 shrink-0 text-amber-600 transition-transform group-hover:translate-x-1" />
                  </div>
                  {item.feedback && <p className="mt-2 border-l-2 border-amber-300 pl-2 text-xs leading-5 text-slate-600">{item.feedback}</p>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(derived.nextSubmissionDeadline || derived.closedSubmissionWindowCount > 0) && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Lock className="h-4 w-4 text-primary-500" />
                Submission windows
              </h3>
              {derived.nextSubmissionDeadline ? (
                <p className="mt-1 text-sm text-slate-600">
                  Next close: <span className="font-medium text-slate-900">{derived.nextSubmissionDeadline.title}</span> closes {formatShortDateTime(derived.nextSubmissionDeadline.submission_window?.submissions_close_at)}.
                </p>
              ) : (
                <p className="mt-1 text-sm text-slate-600">No upcoming submission close times right now.</p>
              )}
            </div>
            {derived.closedSubmissionWindowCount > 0 && (
              <span className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">
                {derived.closedSubmissionWindowCount} closed window{derived.closedSubmissionWindowCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
      )}

      {data.office_hours && data.office_hours.length > 0 && (
        <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Clock className="h-4 w-4 text-primary-500" />
              Office Hours
            </h3>
          </div>
          <div className="rounded-xl border border-primary-200 bg-primary-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">Next session</p>
            <p className="mt-1 text-base font-semibold text-slate-900">{data.office_hours[0].title}</p>
            <p className="mt-0.5 text-sm text-slate-600">{formatShortDateTime(data.office_hours[0].starts_at, 'TBD', data.office_hours[0].timezone)}</p>
            {data.office_hours[0].description && <p className="mt-2 text-sm text-slate-600">{data.office_hours[0].description}</p>}
            <a
              href={sanitizeUrl(data.office_hours[0].meeting_url)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-2 rounded-lg bg-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-primary-600 transition-colors"
            >
              Join office hours
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>
          {data.office_hours.length > 1 && (
            <div className="grid gap-2 sm:grid-cols-2">
              {data.office_hours.slice(1, 3).map((session) => (
                <a
                  key={`${session.office_hour_id}-${session.starts_at}`}
                  href={sanitizeUrl(session.meeting_url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 hover:border-primary-200"
                >
                  <p className="text-sm font-medium text-slate-900">{session.title}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{formatShortDateTime(session.starts_at, 'TBD', session.timezone)}</p>
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {data.cohort?.announcements && data.cohort.announcements.length > 0 && (
        <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-900">Class Notices</h3>
            <Link to="/announcements" className="text-xs font-medium text-primary-600 hover:text-primary-700">
              View all
            </Link>
          </div>
          {data.cohort.announcements
            .slice()
            .sort((a, b) => Number(b.pinned) - Number(a.pinned) || announcementTimestamp(b.published_at) - announcementTimestamp(a.published_at))
            .map((announcement, idx) => (
              <Link key={`${announcement.published_at}-${idx}`} to={`/announcements/${announcement.id}`} className={`block rounded-xl border px-4 py-3 ${announcement.pinned ? 'border-primary-200 bg-primary-50' : 'border-slate-200 bg-slate-50'} hover:border-primary-200`}>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-slate-900">{announcement.title || 'Announcement'}</p>
                  {announcement.pinned && (
                    <span className="rounded-full bg-primary-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-700">Pinned</span>
                  )}
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {announcement.author?.full_name || announcement.cohort_name || 'CSG'} · {formatDate(announcement.published_at)}
                </p>
                {announcement.body && <p className="mt-1 text-sm text-slate-700 whitespace-pre-wrap">{announcement.body}</p>}
              </Link>
            ))}
        </div>
      )}

      {data.resources && data.resources.length > 0 && (
        <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Link2 className="h-4 w-4 text-primary-500" />
              Class Resources
            </h3>
            <Link to="/resources" className="text-xs font-medium text-primary-600 hover:text-primary-700">
              View all
            </Link>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {data.resources.slice(0, 4).map((resource) => (
              <a
                key={resource.id}
                href={sanitizeUrl(resource.url)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 hover:border-primary-200"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-slate-900">{resource.title}</span>
                  {resource.description && (
                    <span className="mt-0.5 line-clamp-1 block text-xs text-slate-500">{resource.description}</span>
                  )}
                </span>
                <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-2xl bg-white border border-slate-200 p-4">
          <div className="flex items-center gap-2 text-slate-500">
            <PlayCircle className="h-4 w-4" />
            <span className="text-sm font-medium">Ready now</span>
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-900">{derived.availableLessonsCount}</p>
          <p className="text-xs text-slate-500">Available incomplete lessons</p>
        </div>
        <div className="rounded-2xl bg-white border border-slate-200 p-4">
          <div className="flex items-center gap-2 text-slate-500">
            <Lock className="h-4 w-4" />
            <span className="text-sm font-medium">Next unlock</span>
          </div>
          <p className="mt-2 text-lg font-bold text-slate-900">{derived.nextLockedLesson ? formatDate(derived.nextLockedLesson.unlock_date) : '—'}</p>
          <p className="text-xs text-slate-500">{derived.nextLockedLesson?.title || 'No locked lessons queued'}</p>
        </div>
        <div className="rounded-2xl bg-white border border-slate-200 p-4">
          <div className="flex items-center gap-2 text-slate-500">
            <CalendarDays className="h-4 w-4" />
            <span className="text-sm font-medium">Cohort</span>
          </div>
          <p className="mt-2 text-lg font-bold text-slate-900">{data.cohort?.name}</p>
          <p className="text-xs text-slate-500">Started {formatDate(data.cohort?.start_date)}</p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="app-eyebrow">Your course</p>
            <h2 className="mt-1 text-xl font-extrabold tracking-tight text-slate-950">Learning path</h2>
          </div>
          <p className="hidden text-sm text-slate-500 sm:block">Follow the unlocked path and keep momentum.</p>
        </div>
        {data.modules?.map((mod) => {
          const upcomingLessons = mod.lessons.filter((l) => l.available && !l.completed).slice(0, 3)
          const lockedCount = mod.lessons.filter((l) => !l.available).length
          return (
            <Link
              key={mod.id}
              to={mod.available ? `/modules/${mod.id}` : '#'}
              onClick={(e) => {
                if (!mod.available) e.preventDefault()
              }}
              className={`block rounded-2xl border p-5 transition-all ${mod.available ? 'bg-white border-slate-200 hover:border-primary-200 hover:shadow-sm' : 'bg-slate-50 border-slate-200 opacity-80 cursor-not-allowed'}`}
            >
              <div className="flex items-center gap-4">
                <ProgressRing percentage={mod.progress_percentage} size={64} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-slate-900">{mod.name}</h3>
                    {!mod.available && (
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                        Locked
                      </span>
                    )}
                    {mod.available && mod.completed_blocks === mod.total_blocks && mod.total_blocks > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-green-700">
                        <CheckCircle2 className="h-3 w-3" />
                        Complete
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-500 capitalize mt-0.5">
                    {mod.module_type.replace('_', ' ')}
                    {!mod.available && mod.unlock_date ? ` · unlocks ${formatDate(mod.unlock_date)}` : ''}
                  </p>
                  <div className="mt-3">
                    <ProgressBar
                      value={mod.completed_blocks}
                      max={mod.total_blocks}
                      showPercentage={false}
                      size="sm"
                    />
                  </div>
                </div>
                <div className="text-sm text-slate-500 text-right">
                  <div>{mod.completed_blocks}/{mod.total_blocks}</div>
                  {lockedCount > 0 && <div className="text-xs text-slate-400 mt-1">{lockedCount} locked</div>}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {upcomingLessons.length > 0 ? (
                  upcomingLessons.map((lesson) => (
                    <span key={lesson.id} className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
                      <Clock className="h-3 w-3" />
                      {lesson.title.length > 30 ? `${lesson.title.slice(0, 30)}...` : lesson.title}
                    </span>
                  ))
                ) : mod.available ? (
                  <span className="inline-flex items-center gap-1 rounded-lg bg-green-50 px-2.5 py-1 text-xs text-green-700">
                    <CheckCircle2 className="h-3 w-3" />
                    Nothing pending in this module right now
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
                    <Lock className="h-3 w-3" />
                    Module not unlocked yet
                  </span>
                )}
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

function unlockTime(dateStr: string | null | undefined) {
  return dateStr ? new Date(dateStr).getTime() : Number.POSITIVE_INFINITY
}

export function DashboardRoute() {
  return <Dashboard />
}
