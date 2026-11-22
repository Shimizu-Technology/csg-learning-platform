import { CourseCompletionStatus } from '../../components/student/CourseCompletionCards'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowRight, CalendarDays, CheckCircle2, ChevronDown, CircleHelp, Clock, ExternalLink, Hourglass, Lock, MessageCircle, RefreshCw, RotateCcw, WifiOff } from 'lucide-react'
import { PreviewLink as Link } from '../../contexts/PreviewNavigationContext'
import { useAuthContext } from '../../contexts/AuthContext'
import { useCohortContext } from '../../contexts/CohortContext'
import { api } from '../../lib/api'
import { takeDashboardRequest } from '../../lib/dashboardRequest'
import { brand, SUPPORT_EMAIL } from '../../lib/brand'
import { formatHeaderDate, formatShortDate, formatShortDateTime, formatTime } from '../../lib/format'
import { shortAgo } from '../../lib/recordRelated'
import { reviewTiming } from '../../lib/reviewCopy'
import { conversationPath } from '../../lib/routes'
import { TERMS } from '../../lib/glossary'
import { sanitizeUrl } from '../../lib/sanitizeUrl'
import { useLearnerPaths } from '../../lib/useRecordPath'
import { markdownExcerpt } from '../../lib/plainText'
import { useMessageInstructor } from '../../lib/useMessageInstructor'
import { EmptyState } from '../../components/shared/EmptyState'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { MarkdownText } from '../../components/shared/MarkdownRenderer'
import { RecordLink } from '../../components/shared/RecordLink'
import { FirstRunWelcome } from '../../components/student/FirstRunWelcome'
import { PersonalPaceCard } from '../../components/student/PersonalPaceCard'
import { GradeChip } from '../../components/student/GradeChip'
import { Badge } from '../../components/ui/Badge'
import { AnchorButton, Button, LinkButton, buttonClasses } from '../../components/ui/Button'
import { Collapse } from '../../components/ui/Motion'
import type { DashboardData, MyWorkItem, PersonalPace, StudentToday, StudentTodayNeedsYou } from '../../types/api'
import { Dashboard } from './Dashboard'

/*
 * Today, redesigned (W8 PR 8.2; mockup 07-student-today.html). One next action,
 * then what needs the learner, what waits on an instructor, recent grades and,
 * beside them, the next live session, this week and their instructor. Every
 * status, count and "next" is the server's (`dashboard.student_today`, from
 * LearnerProgress); this page only shows them. Lists show five rows with
 * "Show all". Shown when the cohort's new student experience switch is on;
 * `Dashboard` is Today when it is off, and the fallback for any payload
 * without `student_today`.
 */

const LIST_LIMIT = 5

export function StudentTodayPage() {
  const { user } = useAuthContext()
  const { selectedCohortId } = useCohortContext()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const request = useRef(0)

  const load = useCallback(() => {
    const current = ++request.current
    // A new cohort's load never shows the last cohort's Today, even if it fails.
    setData(null)
    setSaved(false)
    setLoading(true)
    setError(null)
    takeDashboardRequest(selectedCohortId).then((result) => {
      if (current !== request.current) return
      if (result.data) {
        setData(result.data.dashboard)
        setSaved(Boolean(result.fromCache))
      } else setError(result.error || 'Unable to load Today right now.')
    }).catch((reason: unknown) => {
      if (current === request.current) setError(reason instanceof Error ? reason.message : 'Unable to load Today right now.')
    }).finally(() => { if (current === request.current) setLoading(false) })
  }, [selectedCohortId])

  useEffect(() => { load() }, [load])

  if (user?.is_staff) return <Dashboard />
  if (data?.cohort && selectedCohortId && data.cohort.id !== selectedCohortId) return <LoadingSpinner message="Loading Today…" />
  if (loading && !data) return <LoadingSpinner message="Loading Today…" />
  if (error && !data) {
    return <EmptyState headingLevel={1} icon={WifiOff} title="Could not load Today" description={error}
      action={<Button variant="secondary" onClick={load}><RefreshCw className="h-4 w-4" aria-hidden="true" />Try again</Button>} />
  }
  // Not enrolled, a pending purchase, or a payload from before the redesign: today's page handles it.
  if (!data?.enrolled || !data.student_today) return <Dashboard />
  const patchToday = (update: (today: StudentToday) => StudentToday) => setData((value) => value?.cohort?.id === data.cohort?.id && value?.user.id === data.user.id && value.student_today ? { ...value, student_today: update(value.student_today) } : value)
  return <TodayView data={data} today={data.student_today} saved={saved}
    onDismissStartHere={() => setData((value) => value?.cohort?.id === data.cohort?.id && value?.user.id === data.user.id ? { ...value, start_here: false, student_today: value.student_today ? { ...value.student_today, first_run: false } : value.student_today } : value)}
    onPaceSaved={(pace) => patchToday((today) => ({ ...today, personal_pace: pace, pace: { behind: pace.status === 'behind', weeks_behind: pace.weeks_behind, overdue_count: today.pace?.overdue_count ?? 0 } }))} />
}

function TodayView({ data, today, saved, onDismissStartHere, onPaceSaved }: { data: DashboardData; today: StudentToday; saved: boolean; onDismissStartHere: () => void; onPaceSaved: (pace: PersonalPace) => void }) {
  const cohortId = data.cohort?.id ?? null
  const paths = useLearnerPaths(cohortId)
  const messenger = useMessageInstructor(cohortId)
  const { cohorts } = useCohortContext()
  const otherCourses = (cohorts ?? []).filter((item) => item.id !== cohortId && item.cohort_type !== 'alumni' && item.enrollment_status === 'active')
  const firstRun = today.first_run === true
  const pace = today.personal_pace
  const paceChosen = pace?.plan_source === 'learner_pace' && pace.weeks !== null
  const paceCard = pace && !today.read_only ? (
    <PersonalPaceCard pace={pace} totalLessons={today.counts?.total_lessons ?? null} lessonPath={(id) => paths.lesson(id)} onSaved={onPaceSaved}
      contactName={today.contact?.full_name.split(' ')[0]}
      onAsk={today.contact ? () => void messenger.open(today.contact!.id, { label: 'Changing my pace', path: cohortId ? `/materials?cohort_id=${cohortId}` : '/materials' }) : undefined} />
  ) : null
  const firstName = data.user.full_name.split(' ')[0]
  const learnPath = cohortId ? `/materials?cohort_id=${cohortId}` : '/materials'
  const myWorkPath = (tab?: string) => `/my-work${cohortQuery(cohortId, tab ? { tab } : {})}`
  const context = [
    today.paused ? 'Paused' : null,
    today.course_week ? `Week ${today.course_week.current} of ${today.course_week.total}` : null,
    formatHeaderDate(),
  ].filter(Boolean).join(' · ')

  return (
    <div className="app-page max-w-6xl" data-today="v2">
      {saved && <p className="rounded-2xl border border-warning-line bg-warning-soft px-4 py-3 text-sm text-warning-ink">Showing saved data while your connection catches up.</p>}
      <header data-page-header="">
        <h1 className="app-title [overflow-wrap:anywhere]">{today.paused ? `Hi, ${firstName}` : firstRun ? `Welcome, ${firstName}` : `${greeting()}, ${firstName}`}</h1>
        <p className="app-description mt-1 tabular-nums" data-page-context="">
          {data.cohort && <RecordLink record={{ type: 'cohort', id: data.cohort.id }} variant="plain" returnLabel="Today" className="font-semibold text-ink-secondary">{data.cohort.name}</RecordLink>}
          {context && <> · {context}</>}
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="min-w-0 space-y-5">
          {/* A pace not chosen yet is the first thing to do (W9.1); once chosen it follows the next action. */}
          {paceCard && !paceChosen && paceCard}
          {!saved && <CourseCompletionStatus completion={today.course_completion} />}
          {firstRun
            ? <FirstRunWelcome key={cohortId} data={data} today={today} lessonPath={today.next_lesson ? paths.lesson(today.next_lesson.id) : null} learnPath={learnPath} onDismiss={onDismissStartHere} />
            : <Hero data={data} today={today} paths={paths} learnPath={learnPath} myWorkPath={myWorkPath} messenger={messenger} />}
          {paceCard && paceChosen && paceCard}
          {today.mode === 'library' && otherCourses.length > 0 && <section className="app-surface p-5" aria-label="Your other courses"><h2 className="font-semibold text-ink">Your other courses</h2><p className="mt-1 text-sm text-ink-secondary">Check Today for your next lesson and work waiting for you.</p><ul>{otherCourses.map((item) => <li key={item.id}><Link to={`/dashboard?cohort_id=${item.id}`} className="app-link inline-flex min-h-11 items-center">Today in {item.name}<ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" /></Link></li>)}</ul></section>}
          <NeedsYou today={today} cohortId={cohortId} paths={paths} />
          <Questions today={today} />
          <Waiting today={today} paths={paths} myWorkPath={myWorkPath} />
          <RecentlyGraded today={today} paths={paths} myWorkPath={myWorkPath} />
        </div>
        <aside className="min-w-0 space-y-5" aria-label="This week and your instructor">
          {today.next_session && <NextSession session={today.next_session} />}
          {today.this_week && today.this_week.total > 0 && (
            <section className="app-surface p-5" aria-labelledby="today-week">
              <h2 id="today-week" className="text-base font-semibold text-ink">This week</h2>
              <p className="mt-2 text-2xl font-bold tabular-nums text-ink">{today.this_week.completed} of {today.this_week.total}</p>
              <p className="text-sm text-ink-muted">Required lessons this week · closes {formatShortDate(today.this_week.ends_on, '', { withYear: false, weekday: true })}</p>
              <Link to={learnPath} className="app-link mt-2 inline-flex min-h-11 items-center gap-1 text-sm">Open this week in Learn<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
            </section>
          )}
          <Support data={data} today={today} messenger={messenger} />
          {data.capabilities?.features?.private_meetings !== false && data.private_meetings_enabled && !today.read_only && (
            <Link to={cohortId ? `/meetings?cohort_id=${cohortId}` : '/meetings'} className="pressable flex min-h-14 items-center gap-3 rounded-2xl border border-line bg-surface-raised px-4 py-3 shadow-raised hover:border-line-strong">
              <CalendarDays className="h-5 w-5 shrink-0 text-ink-secondary" aria-hidden="true" />
              <span className="min-w-0 flex-1"><span className="block font-semibold text-ink">Your meetings</span><span className="block text-sm text-ink-muted">Book or see your one-to-one times</span></span>
              <ArrowRight className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
            </Link>
          )}
          {data.capabilities?.features?.announcements !== false && (data.cohort?.announcements?.length ?? 0) > 0 && (
            <section className="app-surface p-5" aria-labelledby="today-updates">
              <div className="flex items-center justify-between gap-3">
                <h2 id="today-updates" className="text-base font-semibold text-ink">Updates</h2>
                <Link to={cohortId ? `/announcements?cohort_id=${cohortId}` : '/announcements'} className="app-link inline-flex min-h-11 items-center text-sm">View all</Link>
              </div>
              <ul className="mt-1 divide-y divide-line">
                {data.cohort!.announcements!.slice(0, 3).map((announcement, index) => (
                  <li key={announcement.id ?? index} className="py-2">
                    {announcement.id
                      ? <RecordLink record={{ type: 'announcement', id: announcement.id, cohortId: announcement.cohort_id ?? cohortId }} returnLabel="Today" variant="unstyled" touchTarget className="text-sm font-semibold text-ink hover:underline">{announcement.title || 'Update'}</RecordLink>
                      : <p className="text-sm font-semibold text-ink">{announcement.title || 'Update'}</p>}
                    <p className="text-xs tabular-nums text-ink-muted">{announcement.author?.full_name || brand.schoolAbbreviation} · {formatShortDate(announcement.published_at, '', { withYear: false })}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  )
}

type Paths = ReturnType<typeof useLearnerPaths>
type Messenger = ReturnType<typeof useMessageInstructor>

/** The one next action (S-11): a single primary button, whatever the learner's state. */
function Hero({ data, today, paths, learnPath, myWorkPath, messenger }: { data: DashboardData; today: StudentToday; paths: Paths; learnPath: string; myWorkPath: (tab?: string) => string; messenger: Messenger }) {
  // Messages go to someone the learner can reach now (the server's contact); nobody, no button.
  const contact = today.contact
  const next = today.next_lesson
  const counts = today.counts
  const progress = counts && counts.total_lessons > 0 ? <span className="tabular-nums">{counts.completed_lessons} of {counts.total_lessons} lessons</span> : null

  if (today.paused || (today.read_only && today.mode !== 'library')) {
    const pausedSince = data.paused_since ? formatShortDate(data.paused_since, '', { withYear: false }) : null
    return (
      <article className="app-surface p-5 sm:p-6" data-region="next-action" aria-labelledby="today-hero">
        {today.paused && <Badge tone="neutral" icon={<Lock className="h-3.5 w-3.5" aria-hidden="true" />}>{pausedSince ? `Paused since ${pausedSince}` : 'Paused'}</Badge>}
        <h2 id="today-hero" className="mt-3 text-xl font-bold text-ink [overflow-wrap:anywhere]">{today.paused
          ? data.cohort ? <>Your enrollment in <RecordLink record={{ type: 'cohort', id: data.cohort.id }} variant="plain" returnLabel="Today">{data.cohort.name}</RecordLink> is paused</> : 'Your enrollment is paused'
          : 'Past course · review only'}</h2>
        <p className="mt-2 text-sm leading-6 text-ink-secondary">
          {counts && counts.completed_lessons > 0
            ? <>Your work is saved: <span className="tabular-nums">{counts.completed_lessons}</span> {counts.completed_lessons === 1 ? 'lesson' : 'lessons'} completed and every submission and piece of feedback.</>
            : 'Your work is saved, including every submission and piece of feedback.'} You can still open past lessons and read your feedback.
          {today.paused && ' Submitting work, new lessons and class chat are off while you’re paused.'}
        </p>
        {today.paused && <p className="mt-2 text-sm leading-6 text-ink-secondary">To resume, message the {brand.schoolAbbreviation} team. We’ll pick a restart week with you.</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          {today.paused
            ? contact
              ? <Button onClick={() => void messenger.open(contact.id)} disabled={messenger.opening}><MessageCircle className="h-4 w-4" aria-hidden="true" />Message {brand.schoolAbbreviation} staff</Button>
              : <AnchorButton variant="primary" href={`mailto:${SUPPORT_EMAIL}`}><MessageCircle className="h-4 w-4" aria-hidden="true" />Contact {brand.schoolAbbreviation}</AnchorButton>
            : <LinkButton to={learnPath}>Open Learn<ArrowRight className="h-4 w-4" aria-hidden="true" /></LinkButton>}
          <LinkButton variant="secondary" to={myWorkPath('graded')}>View your past work</LinkButton>
        </div>
        {next && (
          <div className="mt-5 border-t border-line pt-4">
            <p className="text-xs font-semibold text-ink-muted">Where you left off</p>
            <Link to={paths.lesson(next.id)} className="pressable mt-1 flex min-h-11 items-center gap-3 rounded-xl py-1">
              <span className="min-w-0 flex-1"><span className="block font-semibold text-ink [overflow-wrap:anywhere]">{next.title}</span><span className="block text-sm text-ink-muted">{lessonPlace(next)} · read only{today.paused ? ' while paused' : ''}</span></span>
              <ArrowRight className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
            </Link>
          </div>
        )}
        {today.reviews_count > 0 && <p className="mt-3 text-sm text-ink-muted"><span className="tabular-nums">{today.reviews_count}</span> {today.reviews_count === 1 ? 'review' : 'reviews'} of your work stay open to read in My work.</p>}
      </article>
    )
  }

  if (today.mode === 'library') {
    const first = today.recently_added[0]
    return (
      <article className="app-surface p-5 sm:p-6" data-region="next-action" aria-labelledby="today-hero">
        <h2 id="today-hero" className="text-xl font-bold text-ink">{brand.schoolAbbreviation} Alumni library</h2>
        <p className="mt-1 text-sm text-ink-secondary">Browse lessons and recordings at your own pace.</p>
        <div className="mt-4"><LinkButton to={learnPath}>Open the library<ArrowRight className="h-4 w-4" aria-hidden="true" /></LinkButton></div>
        {today.continue_watching && <Link to={today.continue_watching.path} className="app-link mt-3 flex min-h-11 items-center [overflow-wrap:anywhere]">Continue watching: {today.continue_watching.title}</Link>}
        {first && (
          <div className="mt-5 border-t border-line pt-3">
            <h3 className="text-sm font-semibold text-ink-muted">Recently added</h3>
            <ul>{today.recently_added.map((lesson) => <li key={lesson.id}><Link to={paths.lesson(lesson.id)} className="app-link flex min-h-11 items-center [overflow-wrap:anywhere]">{lesson.title}</Link></li>)}</ul>
          </div>
        )}
      </article>
    )
  }

  const plan = today.catch_up_plan
  const behind = today.pace?.behind ? today.pace.weeks_behind : 0
  const contactName = contact?.full_name.split(' ')[0]
  const behindLine = behind > 0 ? `You’re about ${behind} ${behind === 1 ? 'week' : 'weeks'} behind.` : null

  if (plan && plan.items.length > 0) {
    // Continue goes to the server's next step (LearnerProgress#next_lesson, in plan
    // order): open work the learner can act on, never a redo in a closed week.
    const continueTo = next
    const agreed = plan.agreed_by ? `${plan.agreed_by.full_name.split(' ')[0]} agreed this plan with you on ${formatShortDate(plan.agreed_at, '', { withYear: false, weekday: true })}.` : `Agreed with your instructor on ${formatShortDate(plan.agreed_at, '', { withYear: false, weekday: true })}.`
    return (
      <article className="app-surface p-5 sm:p-6" data-region="next-action" aria-labelledby="today-hero">
        <p className="text-xs font-semibold text-ink-muted">Catch-up plan{plan.agreed_by ? ` · agreed with ${plan.agreed_by.full_name.split(' ')[0]}` : ''}</p>
        <h2 id="today-hero" className="mt-1 text-xl font-bold leading-7 text-ink">
          {behindLine} {plan.target_date ? `Your plan gets you caught up by ${formatShortDate(plan.target_date, '', { withYear: false, weekday: true })}.` : plan.title}
        </h2>
        <p className="mt-1 text-sm text-ink-secondary">Required lessons only; optional ones can wait. {agreed}</p>
        <PlanList plan={plan} paths={paths} />
        <div className="mt-4 flex flex-wrap gap-2">
          {continueTo && <LinkButton to={paths.lesson(continueTo.id)} aria-label={`Continue with ${continueTo.title}`}>Continue your plan<ArrowRight className="h-4 w-4" aria-hidden="true" /></LinkButton>}
          {contact && !today.read_only && <Button variant="secondary" disabled={messenger.opening} onClick={() => void messenger.open(contact.id, { label: `My catch-up plan: ${plan.title}`, path: learnPath })}>Ask {contactName} to change it</Button>}
        </div>
      </article>
    )
  }

  if (next) {
    return (
      <article className="app-surface p-5 sm:p-6" data-region="next-action" aria-labelledby="today-hero">
        {behindLine ? <Badge tone="warning" icon={<Clock className="h-3.5 w-3.5" aria-hidden="true" />}>{behindLine}</Badge> : <p className="text-xs font-semibold text-ink-muted">Next up</p>}
        <h2 id="today-hero" className="mt-2 text-xl font-bold leading-7 text-ink [overflow-wrap:anywhere] sm:text-2xl">{next.title}</h2>
        <p className="mt-1 text-sm text-ink-secondary">{lessonPlace(next)}{progress && <> · {progress}</>}</p>
        {next.submission_window?.submissions_close_at && <p className="mt-2 text-sm text-ink-secondary">Submission deadline: {formatShortDateTime(next.submission_window.submissions_close_at, undefined, 'Pacific/Guam')} (Guam)</p>}
        {behindLine && <p className="mt-2 text-sm leading-6 text-ink-secondary">{next.status === 'redo' ? 'Start with your redo, then' : 'Start here, then'} keep going with the required lessons in Learn.{today.can_ask_for_plan && contactName ? ` ${contactName} can agree a catch-up plan with you.` : ''}</p>}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <LinkButton to={paths.lesson(next.id)} size="lg">Continue<ArrowRight className="h-4 w-4" aria-hidden="true" /></LinkButton>
          {behindLine && today.can_ask_for_plan && contact
            ? <Button variant="secondary" disabled={messenger.opening} onClick={() => void messenger.open(contact.id, { label: 'A catch-up plan', path: learnPath })}>Ask {contactName} for a catch-up plan</Button>
            : <Link to={learnPath} className="app-link inline-flex min-h-11 items-center px-2 text-sm">See the course outline</Link>}
        </div>
      </article>
    )
  }

  const nothingOpen = !counts || counts.total_lessons === 0
  return (
    <article className="app-surface p-5 sm:p-6" data-region="next-action" aria-labelledby="today-hero">
      {nothingOpen ? (
        <>
          <p className="flex items-center gap-2 text-xs font-semibold text-ink-muted"><Hourglass className="h-4 w-4" aria-hidden="true" />Not open yet</p>
          <h2 id="today-hero" className="mt-2 text-xl font-bold text-ink">Your course isn’t open yet</h2>
          <p className="mt-1 text-sm text-ink-secondary">Your lessons will appear here as soon as your instructor opens them.</p>
        </>
      ) : today.waiting.count > 0 ? (
        <>
          <Badge tone="pending" icon={<Clock className="h-3.5 w-3.5" aria-hidden="true" />}>Waiting for review</Badge>
          <h2 id="today-hero" className="mt-2 text-xl font-bold text-ink">Everything open is submitted</h2>
          <p className="mt-1 text-sm text-ink-secondary">{reviewerLine(today)}. Feedback will show up on the lesson and in My work.</p>
        </>
      ) : (
        <>
          <Badge tone="success" icon={<CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}>Caught up</Badge>
          <h2 id="today-hero" className="mt-2 text-xl font-bold text-ink">You’re caught up</h2>
          <p className="mt-1 text-sm text-ink-secondary">New lessons will appear here when they open.{progress && <> You’ve done {progress}.</>}</p>
        </>
      )}
      <div className="mt-4"><LinkButton variant="secondary" to={learnPath}>Open Learn<ArrowRight className="h-4 w-4" aria-hidden="true" /></LinkButton></div>
    </article>
  )
}

/** The plan's lessons, five at a time, with the rest revealed in place (U-5.1). */
function PlanList({ plan, paths }: { plan: NonNullable<StudentToday['catch_up_plan']>; paths: Paths }) {
  const [expanded, setExpanded] = useState(false)
  const row = (item: NonNullable<StudentToday['catch_up_plan']>['items'][number]) => (
    <li key={item.lesson_id}>
      {item.available
        ? <Link to={paths.lesson(item.lesson_id)} className="pressable flex min-h-12 items-center gap-3 px-4 py-2 hover:bg-surface-hover"><PlanRow item={item} /></Link>
        : <div className="flex min-h-12 items-center gap-3 px-4 py-2 opacity-80"><PlanRow item={item} /></div>}
    </li>
  )
  const rest = plan.items.slice(LIST_LIMIT)
  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-line">
      <ol className="divide-y divide-line" data-plan-items="">{plan.items.slice(0, LIST_LIMIT).map(row)}</ol>
      {rest.length > 0 && (
        <>
          <Collapse open={expanded} id="today-plan-more"><ol className="divide-y divide-line border-t border-line" data-plan-items="">{rest.map(row)}</ol></Collapse>
          <button type="button" aria-expanded={expanded} aria-controls="today-plan-more" onClick={() => setExpanded((value) => !value)} className={`${buttonClasses({ variant: 'quiet', size: 'sm' })} m-1`}>
            <ChevronDown className={`h-4 w-4 transition-transform duration-200 ease-[var(--ease-out)] motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
            {expanded ? 'Show fewer' : <>Show all <span className="tabular-nums">{plan.remaining_count}</span></>}
          </button>
        </>
      )}
    </div>
  )
}

function PlanRow({ item }: { item: NonNullable<StudentToday['catch_up_plan']>['items'][number] }) {
  return (
    <>
      <span className="w-12 shrink-0 text-xs font-semibold tabular-nums text-ink-muted">{item.due_on ? formatShortDate(item.due_on, '', { withYear: false }) : ''}</span>
      <span className="min-w-0 flex-1 text-sm font-semibold text-ink [overflow-wrap:anywhere]">{item.title}</span>
      {item.status === 'redo' && <Badge tone="warning">Redo</Badge>}
      {!item.available && <Lock className="h-4 w-4 shrink-0 text-ink-muted" aria-label="Not open yet" />}
    </>
  )
}

/** "Needs you" (U-5.2): a redo with its feedback quoted, an unread help answer, an unread instructor message. */
function NeedsYou({ today, cohortId, paths }: { today: StudentToday; cohortId: number | null; paths: Paths }) {
  const items = today.needs_you.items
  if (items.length === 0) return null
  return (
    <CappedSection id="today-needs" title="Needs you" count={today.needs_you.count} items={items} tone="brand"
      render={(item) => <NeedsYouRow item={item} cohortId={cohortId} paths={paths} readOnly={today.read_only} />}
      itemKey={(item) => item.kind === 'redo' ? `redo-${item.submission_id}` : item.kind === 'help_answer' ? `help-${item.help_request_id}` : `message-${item.message_id}`} />
  )
}

function NeedsYouRow({ item, cohortId, paths, readOnly }: { item: StudentTodayNeedsYou; cohortId: number | null; paths: Paths; readOnly: boolean }) {
  if (item.kind === 'redo') {
    const when = item.graded_at ? shortAgo(item.graded_at) : null
    return (
      <div className="py-4" data-needs-you="redo">
        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink"><RotateCcw className="h-4 w-4 text-warning-ink" aria-hidden="true" />Redo requested: <RecordLink record={{ type: 'lesson', id: item.lesson_id, cohortId, view: 'learn' }} variant="plain" returnLabel="Today">{item.lesson_title}</RecordLink></p>
        <p className="mt-0.5 text-xs text-ink-muted">{[item.block_title !== item.lesson_title ? item.block_title : null, item.grader?.full_name, when && `${when} ago`.replace('now ago', 'just now')].filter(Boolean).join(' · ')}</p>
        {item.feedback && <blockquote className="mt-2 line-clamp-4 border-l-2 border-warning-line pl-3 text-sm leading-6 text-ink-secondary [overflow-wrap:anywhere]"><MarkdownText content={item.feedback} /></blockquote>}
        {item.submissions_closed && <p className="mt-1 text-xs text-ink-muted">Submissions are closed for this week.</p>}
        <div className="mt-3"><LinkButton variant="secondary" size="sm" to={paths.redo(item.lesson_id, item.content_block_id)}>{item.can_resubmit && !readOnly ? 'Open feedback and resubmit' : 'Read feedback'}<ArrowRight className="h-4 w-4" aria-hidden="true" /></LinkButton></div>
      </div>
    )
  }
  if (item.kind === 'help_answer') {
    const name = item.replied_by?.full_name.split(' ')[0] ?? 'Your instructor'
    return (
      <div className="py-4" data-needs-you="help_answer">
        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink"><CircleHelp className="h-4 w-4 text-info-ink" aria-hidden="true" />{name} answered your question</p>
        <p className="mt-0.5 text-xs text-ink-muted">On {item.context_label}{item.replied_at && <> · <span className="tabular-nums">{shortAgo(item.replied_at)}</span></>}</p>
        {item.excerpt && <p className="mt-2 line-clamp-2 text-sm text-ink-secondary [overflow-wrap:anywhere]">“{item.excerpt}”</p>}
        <div className="mt-3"><LinkButton variant="secondary" size="sm" to={item.path} onClick={() => { void api.markNotificationRead(item.notification_id).catch(() => {}) }}>View response<ArrowRight className="h-4 w-4" aria-hidden="true" /></LinkButton></div>
      </div>
    )
  }
  return (
    <div className="py-4" data-needs-you="message">
      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink"><MessageCircle className="h-4 w-4 text-ink-secondary" aria-hidden="true" />New message from {item.author.full_name}</p>
      <p className="mt-0.5 text-xs tabular-nums text-ink-muted">{shortAgo(item.sent_at)}</p>
      {item.excerpt && <p className="mt-2 line-clamp-2 text-sm text-ink-secondary [overflow-wrap:anywhere]">“{item.excerpt}”</p>}
      <div className="mt-3"><LinkButton variant="secondary" size="sm" to={conversationPath({ type: 'dm', id: item.direct_conversation_id }, { cohortId, messageId: item.message_id })}>Reply<ArrowRight className="h-4 w-4" aria-hidden="true" /></LinkButton></div>
    </div>
  )
}

/** Help requests still waiting for a first reply (L-1.3). Gone when help requests are off. */
function Questions({ today }: { today: StudentToday }) {
  if (today.questions.count === 0) return null
  return (
    <CappedSection id="today-questions" title="Your questions" count={today.questions.count} items={today.questions.items} itemKey={(item) => item.id}
      render={(item) => (
        <Link to={item.path} className="pressable flex min-h-14 items-center gap-3 py-3">
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-ink">Your question is waiting for a reply</span>
            <span className="mt-0.5 block text-xs text-ink-muted [overflow-wrap:anywhere]">“{item.message}” · {item.context_label} · asked <span className="tabular-nums">{shortAgo(item.created_at)}</span> ago</span>
          </span>
          <span className="shrink-0 text-sm font-semibold text-ink-secondary">View question</span>
        </Link>
      )} />
  )
}

function Waiting({ today, paths, myWorkPath }: { today: StudentToday; paths: Paths; myWorkPath: (tab?: string) => string }) {
  if (today.waiting.count === 0) return null
  const more = today.waiting.count - today.waiting.items.length
  return (
    <section className="app-surface" aria-labelledby="today-waiting">
      <SectionHead id="today-waiting" title="Waiting on your instructor" count={today.waiting.count} action={<Link to={myWorkPath('waiting')} className="app-link inline-flex min-h-11 items-center gap-1 text-sm">My work<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>} />
      <ul className="divide-y divide-line px-4 sm:px-5">
        {today.waiting.items.map((item, index) => {
          const age = shortAgo(item.submitted_at)
          return (
            <li key={item.submission_id}>
              <Link to={paths.redo(item.lesson_id, item.content_block_id)} className="pressable flex min-h-14 items-center gap-3 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-ink [overflow-wrap:anywhere]">{item.lesson_title}</span>
                  <span className="mt-0.5 block text-xs text-ink-muted">
                    Submitted <span className="tabular-nums">{age === 'now' ? 'just now' : `${age} ago`}</span>
                    {index === 0 && !item.expected_review_on ? ` · ${reviewerLine(today)}` : ''}
                  </span>
                  {item.expected_review_on && <span className="mt-0.5 block text-xs font-semibold text-ink-secondary">Feedback expected by <time dateTime={item.expected_review_on}>{formatShortDate(item.expected_review_on, '', { withYear: false, weekday: true })}</time></span>}
                </span>
                <Badge tone="pending">Waiting</Badge>
              </Link>
            </li>
          )
        })}
      </ul>
      {more > 0 && <Link to={myWorkPath('waiting')} className="app-link flex min-h-11 items-center px-4 pb-3 text-sm sm:px-5">Show all <span className="ml-1 tabular-nums">{today.waiting.count}</span></Link>}
    </section>
  )
}

function RecentlyGraded({ today, paths, myWorkPath }: { today: StudentToday; paths: Paths; myWorkPath: (tab?: string) => string }) {
  if (today.recently_graded.length === 0) return null
  return (
    <section className="app-surface" aria-labelledby="today-graded">
      <SectionHead id="today-graded" title="Recently graded" action={<Link to={myWorkPath('graded')} className="app-link inline-flex min-h-11 items-center gap-1 text-sm">My work<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>} />
      <ul className="divide-y divide-line px-4 sm:px-5">
        {today.recently_graded.map((item) => (
          <li key={item.submission_id}>
            <Link to={paths.redo(item.lesson_id, item.content_block_id)} className="pressable flex min-h-14 items-start gap-3 py-3">
              <GradeChip grade={item.grade} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-ink [overflow-wrap:anywhere]">{item.lesson_title}</span>
                <span className="mt-0.5 line-clamp-2 block text-xs text-ink-muted [overflow-wrap:anywhere]">{gradedLine(item)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

function NextSession({ session }: { session: NonNullable<StudentToday['next_session']> }) {
  const url = sanitizeUrl(session.meeting_url)
  return (
    <section className="app-surface p-5" aria-labelledby="today-session" data-region="next-session">
      <h2 id="today-session" className="text-base font-semibold text-ink">{session.optional_check_in ? TERMS.optionalCheckIn : session.event_kind === 'live_class' ? 'Next live class' : 'Office hours'}</h2>
      <p className="mt-2 font-semibold tabular-nums text-ink">{formatShortDate(session.starts_at, 'TBD', { withYear: false, weekday: true, timeZone: session.timezone })} · {formatTime(session.starts_at, 'TBD', session.timezone)}</p>
      <p className="text-sm text-ink-secondary [overflow-wrap:anywhere]">{session.title}</p>
      {session.description && <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{session.description}</p>}
      {url && <AnchorButton href={url} target="_blank" rel="noopener noreferrer" variant="primary" className="mt-3">Join<ExternalLink className="h-4 w-4" aria-hidden="true" /></AnchorButton>}
    </section>
  )
}

/** One support message for the course (U-5.5): who to ask, or that support has ended and who to contact instead. */
function Support({ data, today, messenger }: { data: DashboardData; today: StudentToday; messenger: Messenger }) {
  const instructor = today.reviewer
  const contact = today.contact
  if (today.mode === 'library') return null
  const ended = today.support.ended
  const canMessage = Boolean(contact) && !ended && !today.read_only
  return (
    <section className="app-surface p-5" aria-labelledby="today-instructor">
      <h2 id="today-instructor" className="text-base font-semibold text-ink">Your instructor</h2>
      {instructor && (
        <div className="mt-3 flex items-center gap-3">
          <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-sm font-bold text-ink-secondary">{initials(instructor.full_name)}</span>
          <div className="min-w-0"><p className="font-semibold text-ink [overflow-wrap:anywhere]">{instructor.full_name}</p><p className="text-xs text-ink-muted">Reviews your work · {reviewTiming(data.review_response_time)}</p></div>
        </div>
      )}
      <p className="mt-3 text-sm text-ink-secondary">
        {ended
          ? `Your ${TERMS.helpPeriod.toLowerCase()} ended${today.support.ends_on ? ` on ${formatShortDate(today.support.ends_on)}` : ''}. Your lessons stay open.`
          : today.support.mode === 'guided_help'
            ? 'Stuck on a lesson? Use Ask for help on that lesson, or send a message.'
            : today.support.mode === 'course_question'
              ? `Questions about a lesson go to ${instructor?.full_name.split(' ')[0] ?? 'your instructor'}${today.support.ends_on ? ` until ${formatShortDate(today.support.ends_on)}` : ''}.`
              : canMessage ? 'Send a message any time.' : `For help, contact ${brand.schoolAbbreviation}.`}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {canMessage
          ? <Button variant="secondary" size={today.first_run ? 'md' : 'sm'} disabled={messenger.opening} onClick={() => void messenger.open(contact!.id)}><MessageCircle className="h-4 w-4" aria-hidden="true" />{today.first_run ? 'Ask a question' : `Message ${contact!.full_name.split(' ')[0]}`}</Button>
          : <AnchorButton variant="secondary" size={today.first_run ? 'md' : 'sm'} href={`mailto:${SUPPORT_EMAIL}`}>Contact {brand.schoolAbbreviation}</AnchorButton>}
      </div>
    </section>
  )
}

/** A card of rows that shows five and reveals the rest in place (U-5.1). */
function CappedSection<T>({ id, title, count, items, render, itemKey, tone }: { id: string; title: string; count: number; items: T[]; render: (item: T) => ReactNode; itemKey: (item: T) => string | number; tone?: 'brand' }) {
  const [expanded, setExpanded] = useState(false)
  const first = items.slice(0, LIST_LIMIT)
  const rest = items.slice(LIST_LIMIT)
  return (
    <section className="app-surface" aria-labelledby={id} data-region={id}>
      <SectionHead id={id} title={title} count={count} tone={tone} />
      <ul className="divide-y divide-line px-4 sm:px-5">{first.map((item) => <li key={itemKey(item)}>{render(item)}</li>)}</ul>
      {rest.length > 0 && (
        <>
          <Collapse open={expanded} id={`${id}-more`}><ul className="divide-y divide-line border-t border-line px-4 sm:px-5">{rest.map((item) => <li key={itemKey(item)}>{render(item)}</li>)}</ul></Collapse>
          <button type="button" aria-expanded={expanded} aria-controls={`${id}-more`} onClick={() => setExpanded((value) => !value)} className={`${buttonClasses({ variant: 'quiet', size: 'sm' })} mx-2 mb-2`}>
            <ChevronDown className={`h-4 w-4 transition-transform duration-200 ease-[var(--ease-out)] motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
            {expanded ? 'Show fewer' : <>Show all <span className="tabular-nums">{count}</span></>}
          </button>
        </>
      )}
    </section>
  )
}

function SectionHead({ id, title, count, action, tone }: { id: string; title: string; count?: number; action?: ReactNode; tone?: 'brand' }) {
  return (
    <div className="flex min-h-14 items-center gap-2 border-b border-line px-4 sm:px-5">
      <h2 id={id} className="text-base font-semibold text-ink">{title}</h2>
      {count !== undefined && <Badge tone={tone ?? 'neutral'}><span className="tabular-nums">{count}</span></Badge>}
      <span className="flex-1" />
      {action}
    </div>
  )
}

function gradedLine(item: MyWorkItem) {
  const who = item.grader?.full_name.split(' ')[0]
  const when = item.graded_at ? formatShortDate(item.graded_at, '', { withYear: false, weekday: true }) : null
  const by = [who, when].filter(Boolean).join(', ')
  return item.feedback ? `“${markdownExcerpt(item.feedback)}”${by ? ` · ${by}` : ''}` : by ? `Reviewed by ${by}` : 'Reviewed'
}

/** "Audreana usually reviews within 2 days" (S-8, decision 5). */
function reviewerLine(today: StudentToday) {
  const timing = reviewTiming(today.review_response_time)
  const name = today.reviewer?.full_name.split(' ')[0]
  return name ? `${name} ${timing.replace(/^usually\s+/i, 'usually reviews ')}` : `Your instructor will review it, ${timing}`
}

function lessonPlace(lesson: NonNullable<StudentToday['next_lesson']>) {
  return [lesson.module_name, lesson.week ? `Week ${lesson.week}` : null, `Lesson ${lesson.position} of ${lesson.module_lesson_count}`].filter(Boolean).join(' · ')
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')
}

function greeting(at = new Date()) {
  const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23' }).format(at))
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
}

function cohortQuery(cohortId: number | null, extra: Record<string, string> = {}) {
  const search = new URLSearchParams({ ...(cohortId ? { cohort_id: String(cohortId) } : {}), ...extra }).toString()
  return search ? `?${search}` : ''
}

