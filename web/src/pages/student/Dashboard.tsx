import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, BookOpen, Clock, Lock, CalendarDays, CheckCircle2, RotateCcw, RefreshCw, WifiOff, Link2, ExternalLink, MessageCircle, Hourglass, Pin } from 'lucide-react'
import { api } from '../../lib/api'
import { useAuthContext } from '../../contexts/AuthContext'
import { useCohortContext } from '../../contexts/CohortContext'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { EmptyState } from '../../components/shared/EmptyState'
import { formatShortDate, formatShortDateTime } from '../../lib/format'
import { sanitizeUrl } from '../../lib/sanitizeUrl'
import { WeeklyPlanCard } from '../../components/student/WeeklyPlan'
import { markdownExcerpt } from '../../lib/plainText'
import { AnchorButton, Button, LinkButton } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import type { DashboardData, WeeklyPlan } from '../../types/api'

function formatDate(dateStr: string | null | undefined): string {
  return formatShortDate(dateStr, 'TBD', { withYear: false })
}

interface DashboardProps {
  previewData?: DashboardData
  previewWeeklyPlan?: WeeklyPlan | null
  previewBanner?: ReactNode
  disableStaffRedirect?: boolean
}

export function Dashboard({ previewData, previewWeeklyPlan, previewBanner, disableStaffRedirect = false }: DashboardProps = {}) {
  const { user, enrollments } = useAuthContext()
  const { selectedCohortId } = useCohortContext()
  const selectedEnrollment = enrollments.find((entry) => entry.cohort.id === selectedCohortId)
  const navigate = useNavigate()
  const [data, setData] = useState<DashboardData | null>(previewData || null)
  const [loading, setLoading] = useState(!previewData)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showingSavedData, setShowingSavedData] = useState(false)
  const [weeklyPlan, setWeeklyPlan] = useState<WeeklyPlan | null>(previewWeeklyPlan || null)
  const [weeklyPlanLoaded, setWeeklyPlanLoaded] = useState(Boolean(previewData))
  const dashboardRequest = useRef(0)

  useEffect(() => {
    if (!previewData) return
    setWeeklyPlan(previewWeeklyPlan ?? null)
    setWeeklyPlanLoaded(true)
  }, [previewData, previewWeeklyPlan])

  const announcementTimestamp = (dateStr?: string | null) => {
    if (!dateStr) return 0
    return new Date(dateStr).getTime()
  }

  const loadDashboard = useCallback(() => {
    const request = ++dashboardRequest.current
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
    setData(null)
    setLoadError(null)
    setShowingSavedData(false)

    api.getDashboard(selectedCohortId ?? undefined)
      .then((res) => {
        if (request !== dashboardRequest.current) return
        if (res.data) {
          setData(res.data.dashboard)
          setShowingSavedData(Boolean(res.fromCache))
          setLoadError(res.fromCache ? res.error : null)
          return
        }

        setLoadError(res.error || 'Unable to load your dashboard right now.')
      })
      .catch((error: unknown) => {
        if (request !== dashboardRequest.current) return
        setLoadError(error instanceof Error ? error.message : 'Unable to load your dashboard right now.')
      })
      .finally(() => { if (request === dashboardRequest.current) setLoading(false) })
  }, [disableStaffRedirect, navigate, previewData, selectedCohortId, user])

  useEffect(() => {
    loadDashboard()
  }, [loadDashboard])

  useEffect(() => {
    if (!user || previewData || user.is_staff) return
    if (selectedEnrollment?.cohort.course_delivery === 'self_paced') {
      setWeeklyPlan(null)
      setWeeklyPlanLoaded(true)
      return
    }
    let active = true
    setWeeklyPlan(null)
    setWeeklyPlanLoaded(false)
    api.getWeeklyPlan(selectedCohortId ?? undefined).then((res) => {
      if (active && res.data?.weekly_plan) setWeeklyPlan(res.data.weekly_plan)
    }).finally(() => { if (active) setWeeklyPlanLoaded(true) })
    return () => { active = false }
  }, [previewData, selectedCohortId, selectedEnrollment?.cohort.course_delivery, user])

  const retryAction = (
    <Button variant="secondary" onClick={loadDashboard}>
      <RefreshCw className="h-4 w-4" aria-hidden="true" />
      Try again
    </Button>
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

    const lessonCount = modules.reduce((sum, mod) => sum + mod.lessons.length, 0)
    const awaitingReviewCount = modules.reduce((sum, mod) => sum + mod.lessons.filter((lesson) => lesson.completed && lesson.review_status === 'awaiting_review').length, 0)

    return {
      courseNotOpen: modules.length === 0 || lessonCount === 0,
      awaitingReviewCount,
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
  const showWeeklyFallback = weeklyPlanLoaded && !weeklyPlan?.enrolled
  const courseNotOpen = derived.courseNotOpen

  const cohortQuery = selectedCohortId ? `?cohort_id=${selectedCohortId}` : ''
  const redoItems = data.action_items?.filter((item) => item.type === 'redo') || []
  const firstRedo = redoItems[0] || null
  const firstName = data.user.full_name.split(' ')[0]
  const percentage = Math.round(progress?.percentage || 0)

  return (
    <div className="app-page max-w-5xl">
      {previewBanner}
      {showingSavedData && (
        <div className="rounded-2xl border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-800">
          Showing saved dashboard data while your connection catches up.
        </div>
      )}

      {/* One hero: who you are, where you stand, and the single next action. */}
      <section aria-labelledby="dashboard-title" className="app-surface p-5 sm:p-6">
        <h1 id="dashboard-title" className="text-2xl font-bold tracking-[-0.02em] text-ink sm:text-3xl">
          Welcome back, {firstName}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          {data.cohort?.name}
          {!courseNotOpen && progress && (
            <> · <span className="tabular-nums">{progress.completed} of {progress.total} {progress.total === 1 ? 'block' : 'blocks'} done ({percentage}%)</span></>
          )}
        </p>
        {!courseNotOpen && progress && (
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-label="Course progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage} aria-valuetext={`${percentage}% of the course done`}>
            <div className="h-full origin-left rounded-full bg-ruby-600" style={{ transform: `scaleX(${Math.min(Math.max(percentage, 0), 100) / 100})` }} />
          </div>
        )}

        <div className="mt-5" data-region="next-action">
          {courseNotOpen ? (
            <NextAction
              icon={<Hourglass className="h-5 w-5 text-ink-muted" aria-hidden="true" />}
              title="Your course isn’t open yet"
              detail="Your lessons will appear here as soon as your instructor opens them. If you expected to start already, message your instructor."
              action={<LinkButton to="/messages" variant="secondary"><MessageCircle className="h-4 w-4" aria-hidden="true" />Message your instructor</LinkButton>}
            />
          ) : firstRedo ? (
            <NextAction
              label={<Badge tone="warning" icon={<RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />}>Redo requested</Badge>}
              title={firstRedo.content_block_title || firstRedo.lesson_title}
              detail={firstRedo.content_block_title && firstRedo.content_block_title !== firstRedo.lesson_title ? firstRedo.lesson_title : undefined}
              excerpt={firstRedo.feedback ? markdownExcerpt(firstRedo.feedback) : undefined}
              note={redoItems.length > 1 ? `${redoItems.length - 1} more ${redoItems.length - 1 === 1 ? 'redo is' : 'redos are'} listed below.` : undefined}
              action={<LinkButton to={`/lessons/${firstRedo.lesson_id}${cohortQuery}#redo`}>Read feedback and resubmit<ArrowRight className="h-4 w-4" aria-hidden="true" /></LinkButton>}
            />
          ) : derived.nextAvailableLesson ? (
            <NextAction
              label={<span className="text-xs font-semibold text-ink-muted">Next up</span>}
              title={derived.nextAvailableLesson.title}
              detail={derived.nextAvailableLesson.moduleName}
              action={<LinkButton to={`/lessons/${derived.nextAvailableLesson.id}${cohortQuery}`}>Continue learning<ArrowRight className="h-4 w-4" aria-hidden="true" /></LinkButton>}
            />
          ) : derived.awaitingReviewCount > 0 ? (
            <NextAction
              label={<Badge tone="pending" icon={<Clock className="h-3.5 w-3.5" aria-hidden="true" />}>Awaiting review</Badge>}
              title="Everything open is submitted"
              detail={`Your instructor is reviewing ${derived.awaitingReviewCount === 1 ? 'one piece of work' : `${derived.awaitingReviewCount} pieces of work`}. Feedback will show up on the lesson and here.`}
            />
          ) : derived.nextLockedLesson ? (
            <NextAction
              label={<span className="text-xs font-semibold text-ink-muted">Upcoming</span>}
              title={derived.nextLockedLesson.title}
              detail={`${derived.nextLockedLesson.moduleName} · unlocks ${formatDate(derived.nextLockedLesson.unlock_date)}`}
            />
          ) : (
            <NextAction
              label={<Badge tone="success" icon={<CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}>Caught up</Badge>}
              title="You’re caught up"
              detail="New lessons will appear here when they open."
            />
          )}
        </div>
      </section>

      {weeklyPlan?.enrolled && !courseNotOpen && <WeeklyPlanCard plan={weeklyPlan} hideFirstRedo={Boolean(firstRedo)} />}

      {data.private_meetings_enabled && (
        <Link to="/meetings" className="pressable group flex min-h-16 items-center justify-between gap-4 rounded-2xl border border-line bg-surface-raised px-4 py-3 shadow-raised hover:border-line-strong sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-sunken text-ink-secondary"><CalendarDays className="h-5 w-5" aria-hidden="true" /></span>
            <div className="min-w-0"><p className="font-semibold text-ink">Your private meetings</p><p className="text-sm text-ink-muted">See your weekly one-to-one schedule and available times.</p></div>
          </div>
          <ArrowRight className="h-5 w-5 shrink-0 text-ink-muted transition-transform duration-[180ms] group-hover:translate-x-0.5" aria-hidden="true" />
        </Link>
      )}

      {(showWeeklyFallback || weeklyPlan?.mode === 'library') && redoItems.length > 1 && (
        <section className="app-surface p-4 sm:p-5">
          <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
            <RotateCcw className="h-4 w-4 text-warning-800" aria-hidden="true" />
            Other feedback to act on
          </h2>
          <ul className="mt-2 divide-y divide-line">
            {redoItems.slice(1).map((item) => (
              <li key={item.submission_id}>
                <Link to={`/lessons/${item.lesson_id}${cohortQuery}#redo`} className="pressable group flex min-h-14 items-center justify-between gap-3 rounded-lg py-3">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-ink">{item.content_block_title || item.lesson_title}</span>
                    {item.feedback && <span className="mt-0.5 line-clamp-2 block text-sm text-ink-muted">{markdownExcerpt(item.feedback)}</span>}
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {showWeeklyFallback && (derived.nextSubmissionDeadline || derived.closedSubmissionWindowCount > 0) && (
        <div className="app-surface p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
                <Lock className="h-4 w-4 text-ink-muted" aria-hidden="true" />
                Submission windows
              </h3>
              {derived.nextSubmissionDeadline ? (
                <p className="mt-1 text-sm text-ink-secondary">
                  Next close: <span className="font-medium text-ink">{derived.nextSubmissionDeadline.title}</span> closes <span className="tabular-nums">{formatShortDateTime(derived.nextSubmissionDeadline.submission_window?.submissions_close_at)}</span>.
                </p>
              ) : (
                <p className="mt-1 text-sm text-ink-secondary">No upcoming submission close times right now.</p>
              )}
            </div>
            {derived.closedSubmissionWindowCount > 0 && (
              <Badge tone="neutral" icon={<Lock className="h-3.5 w-3.5" aria-hidden="true" />}>
                {derived.closedSubmissionWindowCount} closed window{derived.closedSubmissionWindowCount !== 1 ? 's' : ''}
              </Badge>
            )}
          </div>
        </div>
      )}

      {showWeeklyFallback && data.office_hours && data.office_hours.length > 0 && (
        <div className="app-surface space-y-3 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Clock className="h-4 w-4 text-ink-muted" aria-hidden="true" />
            Live schedule
          </h3>
          <div className="rounded-xl border border-line bg-surface-sunken p-4">
            <p className="text-xs font-semibold text-ink-muted">Next session</p>
            <p className="mt-1 text-base font-semibold text-ink">{data.office_hours[0].title}</p>
            <p className="mt-0.5 text-sm tabular-nums text-ink-secondary">{formatShortDateTime(data.office_hours[0].starts_at, 'TBD', data.office_hours[0].timezone)}</p>
            {data.office_hours[0].description && <p className="mt-2 text-sm text-ink-secondary">{data.office_hours[0].description}</p>}
            <AnchorButton
              href={sanitizeUrl(data.office_hours[0].meeting_url)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3"
            >
              Join session
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </AnchorButton>
          </div>
          {data.office_hours.length > 1 && (
            <div className="grid gap-2 sm:grid-cols-2">
              {data.office_hours.slice(1, 3).map((session) => (
                <a
                  key={`${session.office_hour_id}-${session.starts_at}`}
                  href={sanitizeUrl(session.meeting_url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="pressable rounded-xl border border-line bg-surface-raised px-4 py-3 hover:border-line-strong"
                >
                  <p className="text-sm font-medium text-ink">{session.title}</p>
                  <p className="mt-0.5 text-xs tabular-nums text-ink-muted">{formatShortDateTime(session.starts_at, 'TBD', session.timezone)}</p>
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {data.cohort?.announcements && data.cohort.announcements.length > 0 && (
        <section className="app-surface space-y-3 p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-ink">Class notices</h2>
            <Link to="/announcements" className="app-link inline-flex min-h-11 items-center px-1 text-sm">
              View all
            </Link>
          </div>
          {data.cohort.announcements
            .slice()
            .sort((a, b) => Number(b.pinned) - Number(a.pinned) || announcementTimestamp(b.published_at) - announcementTimestamp(a.published_at))
            .map((announcement, idx) => (
              <Link key={`${announcement.published_at}-${idx}`} to={`/announcements/${announcement.id}`} className="pressable block rounded-xl border border-line bg-surface-raised px-4 py-3 hover:border-line-strong hover:bg-surface-sunken">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-ink">{announcement.title || 'Announcement'}</p>
                  {announcement.pinned && <Badge tone="info" icon={<Pin className="h-3 w-3" aria-hidden="true" />}>Pinned</Badge>}
                </div>
                <p className="mt-1 text-xs text-ink-muted">
                  {announcement.author?.full_name || announcement.cohort_name || 'CSG'} · <span className="tabular-nums">{formatDate(announcement.published_at)}</span>
                </p>
                {announcement.body && <p className="mt-1 line-clamp-3 text-sm text-ink-secondary">{markdownExcerpt(announcement.body)}</p>}
              </Link>
            ))}
        </section>
      )}

      {data.resources && data.resources.length > 0 && (
        <section className="app-surface space-y-3 p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
              <Link2 className="h-4 w-4 text-ink-muted" aria-hidden="true" />
              Class resources
            </h2>
            <Link to="/resources" className="app-link inline-flex min-h-11 items-center px-1 text-sm">
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
                className="pressable flex min-h-14 items-start justify-between gap-3 rounded-xl border border-line bg-surface-raised px-4 py-3 hover:border-line-strong hover:bg-surface-sunken"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-ink">{resource.title}</span>
                  {resource.description && (
                    <span className="mt-0.5 line-clamp-1 block text-xs text-ink-muted">{resource.description}</span>
                  )}
                </span>
                <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
              </a>
            ))}
          </div>
        </section>
      )}

      {!courseNotOpen && data.modules && data.modules.length > 0 && (
        <section aria-labelledby="learning-path-title" className="space-y-3">
          <h2 id="learning-path-title" className="text-lg font-semibold text-ink">Your course</h2>
          <ul className="app-surface divide-y divide-line overflow-hidden">
            {data.modules.map((mod) => {
              const lockedCount = mod.lessons.filter((l) => !l.available).length
              const complete = mod.available && mod.total_blocks > 0 && mod.completed_blocks === mod.total_blocks
              const content = (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-ink">{mod.name}</span>
                      {!mod.available && <Badge tone="neutral" icon={<Lock className="h-3 w-3" aria-hidden="true" />}>Locked</Badge>}
                      {complete && <Badge tone="success" icon={<CheckCircle2 className="h-3 w-3" aria-hidden="true" />}>Complete</Badge>}
                    </span>
                    <span className="mt-0.5 block text-sm text-ink-muted">
                      <span className="tabular-nums">{mod.completed_blocks} of {mod.total_blocks}</span> blocks done
                      {lockedCount > 0 && <> · <span className="tabular-nums">{lockedCount}</span> locked</>}
                      {!mod.available && mod.unlock_date ? ` · unlocks ${formatDate(mod.unlock_date)}` : ''}
                    </span>
                  </span>
                  {mod.available && <ArrowRight className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />}
                </>
              )
              return (
                <li key={mod.id}>
                  {mod.available ? (
                    <Link to={`/modules/${mod.id}${cohortQuery}`} className="pressable flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-surface-sunken sm:px-5">
                      {content}
                    </Link>
                  ) : (
                    <div className="flex min-h-16 items-center gap-3 px-4 py-3 text-ink-muted sm:px-5">{content}</div>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}

interface NextActionProps {
  label?: ReactNode
  icon?: ReactNode
  title: string
  detail?: string
  excerpt?: string
  note?: string
  action?: ReactNode
}

/** The dashboard's single next step, on a light well inside the hero. */
function NextAction({ label, icon, title, detail, excerpt, note, action }: NextActionProps) {
  return (
    <div className="rounded-2xl border border-line bg-surface-sunken p-4 sm:p-5">
      {label && <div className="mb-2">{label}</div>}
      <p className="flex items-start gap-2 text-lg font-semibold leading-7 text-ink">{icon}<span className="min-w-0 [overflow-wrap:anywhere]">{title}</span></p>
      {detail && <p className="mt-0.5 text-sm text-ink-secondary">{detail}</p>}
      {excerpt && <p className="mt-2 line-clamp-3 border-l-2 border-warning-300 pl-3 text-sm leading-6 text-ink-secondary">{excerpt}</p>}
      {note && <p className="mt-2 text-xs text-ink-muted">{note}</p>}
      {action && <div className="mt-4 flex flex-wrap gap-2">{action}</div>}
    </div>
  )
}

function unlockTime(dateStr: string | null | undefined) {
  return dateStr ? new Date(dateStr).getTime() : Number.POSITIVE_INFINITY
}

export function DashboardRoute() {
  return <Dashboard />
}
