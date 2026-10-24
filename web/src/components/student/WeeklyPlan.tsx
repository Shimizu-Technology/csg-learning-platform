import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, BookOpen, CalendarClock, Check, Film, ListChecks, LockKeyhole, RotateCcw, Sparkles } from 'lucide-react'
import { PersonalLearningPlan } from './PersonalLearningPlan'
import { CourseSupport } from './CourseSupport'
import { LinkButton } from '../ui/Button'

import { captureProductEvent } from '../../lib/analytics'
import { formatShortDateTime } from '../../lib/format'
import { sanitizeUrl } from '../../lib/sanitizeUrl'
import { markdownExcerpt } from '../../lib/plainText'
import { LEARNER_STATUS, STATUS_TONE_CLASSES, weeklyItemStatus } from '../../lib/learningStatus'
import { StatusBadge, StatusIcon } from '../shared/StatusBadge'
import type { WeeklyPlan, WeeklyPlanLessonItem } from '../../types/api'

export function WeeklyPlanCard({ plan, hideFirstRedo = false }: { plan: WeeklyPlan; hideFirstRedo?: boolean }) {
  return <div className="space-y-5">{plan.enrolled && plan.personal_plan && <PersonalLearningPlan plan={plan.personal_plan} cohortId={plan.cohort?.id} showNextTask={false} />}<RegularWeeklyPlanCard plan={plan} hideFirstRedo={hideFirstRedo} /></div>
}

function RegularWeeklyPlanCard({ plan, hideFirstRedo = false }: { plan: WeeklyPlan; hideFirstRedo?: boolean }) {
  const capturedKey = useRef<string | null>(null)
  const summary = plan.summary
  const required = plan.required || []
  const optional = plan.optional || []
  const key = `${plan.cohort?.id}:${plan.week_number}`

  useEffect(() => {
    if (!plan.enrolled || !plan.cohort || !plan.week_number || !summary || capturedKey.current === key) return
    capturedKey.current = key
    captureProductEvent('weekly_plan_viewed', {
      cohort_id: plan.cohort.id,
      week_number: plan.week_number,
      role: 'student',
      required_count: summary.required_count,
    })
  }, [key, plan.cohort, plan.enrolled, plan.week_number, summary])

  if (!plan.enrolled) return null
  if (plan.personal_plan) return <PersonalPlanExtras plan={plan} hideFirstRedo={hideFirstRedo} />
  if (plan.plan_kind === 'self_paced') return <SelfPacedPlan plan={plan} hideFirstRedo={hideFirstRedo} />
  if (plan.mode === 'library' && plan.library_summary) return <LibraryPlan plan={plan} />
  if (!summary) return null
  const hasRequired = summary.required_count > 0
  const completion = hasRequired ? Math.round((summary.required_completed_count / summary.required_count) * 100) : 0
  const awaitingReview = required.filter((item) => weeklyItemStatus(item) === 'awaiting_review').length
  const cohortQuery = plan.cohort?.id ? `?cohort_id=${plan.cohort.id}` : ''
  // The dashboard hero already shows the first redo; list the rest here.
  const redos = (plan.redos || []).slice(hideFirstRedo ? 1 : 0)
  const openRedos = (plan.redos || []).filter((redo) => redo.state === 'open').length
  const weekComplete = hasRequired && summary.required_completed_count >= summary.required_count && openRedos === 0

  return (
    <section aria-labelledby="this-week-title" className="app-surface overflow-hidden">
      <div className="border-b border-line px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h2 id="this-week-title" className="text-xl font-bold tracking-tight text-ink">
              <span className="tabular-nums">Week {plan.week_number}</span> · This week
            </h2>
            <p className="mt-1 text-sm text-ink-muted"><span className="tabular-nums">{weekRange(plan.starts_on, plan.ends_on)}</span> · Required work stays listed even when you work ahead.</p>
          </div>
          {hasRequired && !weekComplete ? (
            <div className="w-full sm:w-60">
              <div className="flex items-center justify-between gap-3 text-sm text-ink-secondary"><span><span className="tabular-nums">{summary.required_completed_count} of {summary.required_count}</span> required done or submitted</span><span className="font-semibold tabular-nums text-ink">{completion}%</span></div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={completion} aria-label="Required work this week"><div className="h-full origin-left rounded-full bg-ruby-600 transition-transform duration-300 ease-out" style={{ transform: `scaleX(${completion / 100})` }} /></div>
              {awaitingReview > 0 && <p className="mt-1.5 text-xs text-ink-muted"><span className="tabular-nums">{awaitingReview}</span> awaiting your instructor's review</p>}
            </div>
          ) : !hasRequired ? (
            <p className="text-sm text-ink-muted">No required work is scheduled this week.</p>
          ) : null}
        </div>
        {weekComplete && plan.week_number && <WeekComplete cohortId={plan.cohort?.id} weekNumber={plan.week_number} awaitingReview={awaitingReview} />}
      </div>

      <div className="grid gap-0 lg:grid-cols-[1.45fr_0.85fr]">
        <div className="p-5 sm:p-6 lg:border-r lg:border-line">
          {redos.length > 0 && <PlanSection title="Redo first" icon={RotateCcw} iconClassName="text-warning-800">
            {redos.map((redo) => <Link key={redo.id} to={`/lessons/${redo.lesson_id}${cohortQuery}#${redo.content_block_id ? `block-${redo.content_block_id}` : 'redo'}`} className="pressable group flex min-h-14 items-start gap-3 rounded-lg border-b border-line py-3 last:border-0">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${STATUS_TONE_CLASSES.warning}`}><RotateCcw className="h-4 w-4" aria-hidden="true" /></span>
              <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-ink">{redo.title}</span><span className="mt-0.5 block text-xs text-ink-muted">{redo.lesson_title}{redo.state === 'closed' ? ' · submission window closed' : ''}</span>{redo.feedback && <span className="mt-1.5 line-clamp-2 block text-sm leading-5 text-ink-secondary">{markdownExcerpt(redo.feedback)}</span>}</span>
              <span className="hidden sm:block"><StatusBadge status="redo" /></span>
              <ArrowRight className="mt-2.5 h-4 w-4 shrink-0 text-ink-muted transition-transform duration-[180ms] group-hover:translate-x-0.5" aria-hidden="true" />
            </Link>)}
          </PlanSection>}

          <PlanSection title="Required work" icon={ListChecks}>
            {required.length ? <LessonGroups items={required} cohortQuery={cohortQuery} /> : <EmptyLine icon={Check} text="No required work is open for this week." />}
          </PlanSection>

          {optional.length > 0 && <PlanSection title="Optional stretch" icon={Sparkles} subtle>
            <p className="mb-1 text-sm leading-5 text-ink-muted">Useful if you finish early; this does not count against your required week.</p>
            <LessonGroups items={optional} cohortQuery={cohortQuery} />
          </PlanSection>}
        </div>

        <aside className="border-t border-line bg-surface-sunken/60 p-5 sm:p-6 lg:border-t-0">
          {(plan.events || []).length > 0 && <SideSection title="Live schedule" icon={CalendarClock}>{(plan.events || []).map((event) => <a key={event.id} href={sanitizeUrl(event.meeting_url)} target="_blank" rel="noopener noreferrer" className="pressable block rounded-lg border-b border-line py-3 first:pt-1 last:border-0"><span className="text-xs font-semibold text-ink-muted">{event.kind === 'live_class' ? 'Live class' : 'Office hours'}</span><span className="mt-0.5 block text-sm font-semibold text-ink">{event.title}</span><span className="mt-0.5 block text-xs leading-5 tabular-nums text-ink-muted">{formatShortDateTime(event.starts_at, 'Time pending', event.timezone)}</span></a>)}</SideSection>}
          {(plan.recording_catch_up || []).length > 0 && <SideSection title="Recording catch-up" icon={Film}>{(plan.recording_catch_up || []).map((recording) => <Link key={recording.id} to={`/recordings?${recording.cohort_id ? `cohort_id=${recording.cohort_id}&` : ''}recording=${recording.recording_id}`} className="pressable flex min-h-11 items-center gap-3 rounded-lg border-b border-line py-3 first:pt-1 last:border-0"><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-ink">{recording.title}</span><span className="mt-0.5 block text-xs tabular-nums text-ink-muted">{Math.round(recording.progress_percentage)}% watched</span></span><ArrowRight className="h-4 w-4 text-ink-muted" aria-hidden="true" /></Link>)}</SideSection>}
          {(plan.upcoming_unlocks || []).length > 0 && <SideSection title="Unlocking next" icon={LockKeyhole}>{(plan.upcoming_unlocks || []).slice(0, 3).map((unlock) => <div key={unlock.id} className="border-b border-line py-3 first:pt-1 last:border-0"><p className="text-sm font-semibold text-ink">{unlock.title}</p><p className="mt-0.5 text-xs text-ink-muted">{unlock.module_title} · <span className="tabular-nums">{dateLabel(unlock.unlocks_on)}</span></p></div>)}</SideSection>}
          {!(plan.events || []).length && !(plan.recording_catch_up || []).length && !(plan.upcoming_unlocks || []).length && <EmptyLine icon={Check} text="Nothing else is scheduled right now." />}
        </aside>
      </div>
    </section>
  )
}

const RING_SIZE = 56
const RING_STROKE = 5
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

function readSeen(key: string) {
  try { return window.localStorage.getItem(key) === '1' } catch { return true }
}

/**
 * A one-time, restrained milestone: the first time a learner sees a week with
 * all required work handed in, the ring fills over ~600ms. Afterwards (and
 * under reduced motion) it is a still, filled ring.
 */
function WeekComplete({ cohortId, weekNumber, awaitingReview }: { cohortId?: number; weekNumber: number; awaitingReview: number }) {
  const storageKey = `csg-learn:week-complete:${cohortId ?? 'none'}:${weekNumber}`
  const [animate] = useState(() => typeof window !== 'undefined' && !readSeen(storageKey))
  useEffect(() => {
    try { window.localStorage.setItem(storageKey, '1') } catch { /* storage unavailable: show the still ring */ }
  }, [storageKey])

  return (
    <div className="mt-4 flex items-center gap-4 rounded-2xl border border-success-200 bg-success-50 p-4" role="status" data-week-complete={animate ? 'animate' : 'still'}>
      <span className="relative flex shrink-0 items-center justify-center" style={{ width: RING_SIZE, height: RING_SIZE }}>
        <svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} className="-rotate-90" aria-hidden="true">
          <circle cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_RADIUS} fill="none" stroke="currentColor" strokeWidth={RING_STROKE} className="text-success-200" />
          <circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_RADIUS}
            fill="none"
            stroke="currentColor"
            strokeWidth={RING_STROKE}
            strokeLinecap="round"
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={0}
            className={`text-success-700 ${animate ? 'milestone-ring-animate' : ''}`}
            style={{ ['--ring-circumference' as string]: `${RING_CIRCUMFERENCE}px` }}
          />
        </svg>
        <Check className="absolute h-6 w-6 text-success-700" strokeWidth={2.5} aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-base font-semibold text-success-800"><span className="tabular-nums">Week {weekNumber}</span> complete</p>
        <p className="mt-0.5 text-sm leading-6 text-ink-secondary">
          Everything required this week is handed in.{awaitingReview > 0 ? ` Your instructor is still reviewing ${awaitingReview === 1 ? 'one piece' : `${awaitingReview} pieces`}.` : ' Nice work.'}
        </p>
      </div>
    </div>
  )
}

function PersonalPlanExtras({ plan, hideFirstRedo }: { plan: WeeklyPlan; hideFirstRedo: boolean }) {
  const query = plan.cohort ? `?cohort_id=${plan.cohort.id}` : ''
  const redos = (plan.redos || []).slice(hideFirstRedo ? 1 : 0)
  if (!redos.length && !plan.events?.length && !plan.recording_catch_up?.length && plan.plan_kind !== 'self_paced') return null
  return <section aria-label="Learning support and sessions" className="app-surface overflow-hidden">
    {redos.length > 0 && <PlanSection title="Redo first" icon={RotateCcw}>{redos.map((redo) => <Link key={redo.id} to={`/lessons/${redo.lesson_id}${query}#${redo.content_block_id ? `block-${redo.content_block_id}` : 'redo'}`} className="app-link block min-h-11 py-3">{redo.title}<span className="block text-sm text-ink-secondary">{redo.feedback && markdownExcerpt(redo.feedback)}</span></Link>)}</PlanSection>}
    {!!plan.events?.length && <PlanSection title="Live schedule" icon={CalendarClock}>{plan.events.map((event) => <a key={event.id} href={sanitizeUrl(event.meeting_url) || undefined} target="_blank" rel="noreferrer" className="app-link block min-h-11 py-3">{event.title}<span className="block text-sm text-ink-secondary">{formatShortDateTime(event.starts_at, 'TBD', event.timezone)}</span></a>)}</PlanSection>}
    {!!plan.recording_catch_up?.length && <PlanSection title="Recording catch-up" icon={Film}>{plan.recording_catch_up.map((recording) => <Link key={recording.id} to={`/recordings?${recording.cohort_id || plan.cohort?.id ? `cohort_id=${recording.cohort_id || plan.cohort?.id}&` : ''}recording=${recording.recording_id}`} className="app-link block min-h-11 py-3">{recording.title}</Link>)}</PlanSection>}
    {plan.plan_kind === 'self_paced' && <div className="space-y-1 p-5 text-sm text-ink-secondary">
      {plan.capabilities?.access_expires_at && <p>Course access ends {formatShortDateTime(plan.capabilities.access_expires_at)}.</p>}
      {plan.capabilities?.support_mode !== 'none' && plan.capabilities?.support_expires_at && <p>Instructor support ends {formatShortDateTime(plan.capabilities.support_expires_at)}.</p>}
    </div>}
    {plan.plan_kind === 'self_paced' && plan.cohort && <div className="p-5"><CourseSupport capabilities={plan.capabilities} cohortId={plan.cohort.id} contextLabel={plan.personal_plan?.title || plan.cohort.name} /></div>}
  </section>
}

function SelfPacedPlan({ plan, hideFirstRedo }: { plan: WeeklyPlan; hideFirstRedo: boolean }) {
  const cohortQuery = plan.cohort ? `?cohort_id=${plan.cohort.id}` : ''
  const next = plan.course_overview?.next_lesson
  const redos = (plan.redos || []).slice(hideFirstRedo ? 1 : 0)
  const nextPath = next ? `/lessons/${next.lesson_id}${cohortQuery}` : `/materials${cohortQuery}`
  return <section aria-labelledby="self-paced-title" className="app-surface space-y-4 p-5 sm:p-6">
    <div>
      <p className="app-eyebrow">Self-paced course</p>
      <h2 id="self-paced-title" className="mt-1 text-xl font-bold text-ink [overflow-wrap:anywhere]">{plan.course_overview?.course_name || plan.cohort?.name || 'Your course'}</h2>
      <p className="mt-2 text-sm text-ink-secondary">{next ? `Next lesson: ${next.title}` : 'Your available lessons are ready to review in Materials.'}</p>
      <LinkButton className="mt-3" to={nextPath}>{next ? 'Continue course' : 'Review course'}<ArrowRight className="h-4 w-4" aria-hidden="true" /></LinkButton>
    </div>
    <div className="space-y-1 text-sm text-ink-secondary">
      {plan.capabilities?.access_expires_at && <p>Course access ends {formatShortDateTime(plan.capabilities.access_expires_at)}.</p>}
      {plan.capabilities?.support_mode !== 'none' && plan.capabilities?.support_expires_at && <p>Instructor support ends {formatShortDateTime(plan.capabilities.support_expires_at)}.</p>}
    </div>
    {plan.cohort && <CourseSupport capabilities={plan.capabilities} cohortId={plan.cohort.id} contextLabel={next?.title || plan.course_overview?.course_name || plan.cohort.name} contextPath={`${windowOrigin()}${nextPath}`} />}
    {redos.length > 0 && <PlanSection title="Redo first" icon={RotateCcw} iconClassName="text-warning-800">
      {redos.map((redo) => <Link key={redo.id} to={`/lessons/${redo.lesson_id}${cohortQuery}#${redo.content_block_id ? `block-${redo.content_block_id}` : 'redo'}`} className="pressable block min-h-11 rounded-xl py-3">
        <span className="block font-semibold text-ink">{redo.title}</span>
        <span className="block text-sm text-ink-secondary">{redo.lesson_title} · Redo requested</span>
        {redo.feedback && <span className="block text-sm text-ink-secondary">{markdownExcerpt(redo.feedback)}</span>}
      </Link>)}
    </PlanSection>}
  </section>
}

function windowOrigin() { return typeof window === 'undefined' ? '' : window.location.origin }

function LibraryPlan({ plan }: { plan: WeeklyPlan }) {
  const library = plan.library_summary!

  return (
    <section aria-labelledby="learning-library-title" className="app-surface overflow-hidden">
      <div className="surface-inverse bg-surface-inverse px-5 py-6 text-white sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-300">Keep learning at your pace</p>
        <h2 id="learning-library-title" className="mt-1 text-2xl font-bold tracking-tight">Alumni Learning Library</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">Revisit every CSG topic, watch current and past class recordings, and use the optional exercises and reference projects whenever they help.</p>
        <LinkButton to="/materials" className="mt-5">
          <BookOpen className="h-4 w-4" aria-hidden="true" /> Browse the library <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </LinkButton>
      </div>
      <div className="grid gap-px bg-line sm:grid-cols-3">
        <LibraryStat value={library.module_count} label="learning modules" />
        <LibraryStat value={library.lesson_count} label="available lessons" />
        <LibraryStat value={library.recording_count} label="recorded lessons" />
      </div>
      {((plan.events || []).length > 0 || (plan.recording_catch_up || []).length > 0) && <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-2">
        {(plan.events || []).length > 0 && <SideSection title="Upcoming sessions" icon={CalendarClock}>{(plan.events || []).map((event) => <a key={event.id} href={sanitizeUrl(event.meeting_url)} target="_blank" rel="noopener noreferrer" className="pressable block rounded-lg border-b border-line py-3 first:pt-1 last:border-0"><span className="text-xs font-semibold text-ink-muted">{event.kind === 'live_class' ? 'Live class' : 'Office hours'}</span><span className="mt-0.5 block text-sm font-semibold text-ink">{event.title}</span><span className="mt-0.5 block text-xs leading-5 tabular-nums text-ink-muted">{formatShortDateTime(event.starts_at, 'Time pending', event.timezone)}</span></a>)}</SideSection>}
        {(plan.recording_catch_up || []).length > 0 && <SideSection title="Continue watching" icon={Film}>{(plan.recording_catch_up || []).map((recording) => <Link key={recording.id} to={`/recordings?${recording.cohort_id ? `cohort_id=${recording.cohort_id}&` : ''}recording=${recording.recording_id}`} className="pressable flex min-h-11 items-center gap-3 rounded-lg border-b border-line py-3 first:pt-1 last:border-0"><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-ink">{recording.title}</span><span className="mt-0.5 block text-xs tabular-nums text-ink-muted">{Math.round(recording.progress_percentage)}% watched</span></span><ArrowRight className="h-4 w-4 text-ink-muted" aria-hidden="true" /></Link>)}</SideSection>}
      </div>}
    </section>
  )
}

function LibraryStat({ value, label }: { value: number; label: string }) {
  return <div className="bg-surface-raised px-5 py-4 sm:px-6"><p className="text-2xl font-bold tabular-nums text-ink">{value}</p><p className="mt-0.5 text-sm text-ink-muted">{label}</p></div>
}

function LessonGroups({ items, cohortQuery }: { items: WeeklyPlanLessonItem[]; cohortQuery: string }) {
  return <div>{groupLessons(items).map(([label, lessons]) => <div key={label} className="pt-3 first:pt-1"><p className="text-xs font-semibold tabular-nums text-ink-muted">{label}</p>{lessons.map((item) => <LessonRow key={item.id} item={item} cohortQuery={cohortQuery} />)}</div>)}</div>
}

function LessonRow({ item, cohortQuery }: { item: WeeklyPlanLessonItem; cohortQuery: string }) {
  const status = weeklyItemStatus(item)
  return <Link to={`/lessons/${item.lesson_id}${cohortQuery}`} className="pressable group flex min-h-14 items-center gap-3 rounded-lg border-b border-line py-3 last:border-0"><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${STATUS_TONE_CLASSES[LEARNER_STATUS[status].tone]}`}><StatusIcon status={status} /></span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-ink [overflow-wrap:anywhere]">{item.title}</span><span className="mt-0.5 block text-xs text-ink-muted">{item.module_title} · <span className="tabular-nums">{item.carried_forward ? 'Open from earlier' : dateLabel(item.scheduled_for)}</span>{item.submission_close_at ? <> · closes <span className="tabular-nums">{formatShortDateTime(item.submission_close_at)}</span></> : ''}</span>{status !== 'open' && <span className="mt-1.5 block sm:hidden"><StatusBadge status={status} /></span>}</span><span className="hidden sm:block"><StatusBadge status={status} /></span><ArrowRight className="h-4 w-4 shrink-0 text-ink-muted transition-transform duration-[180ms] group-hover:translate-x-0.5" aria-hidden="true" /></Link>
}

function PlanSection({ title, icon: Icon, children, subtle, iconClassName = 'text-ink-muted' }: { title: string; icon: typeof ListChecks; children: ReactNode; subtle?: boolean; iconClassName?: string }) { return <div className={`mb-6 last:mb-0 ${subtle ? 'rounded-2xl border border-line bg-surface-sunken/60 px-4 py-3' : ''}`}><h3 className="mb-2 flex items-center gap-2 text-base font-semibold text-ink"><Icon className={`h-4 w-4 ${iconClassName}`} aria-hidden="true" />{title}</h3>{children}</div> }
function SideSection({ title, icon: Icon, children }: { title: string; icon: typeof Film; children: ReactNode }) { return <div className="mb-6 last:mb-0"><h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink"><Icon className="h-4 w-4 text-ink-muted" aria-hidden="true" />{title}</h3>{children}</div> }
function EmptyLine({ icon: Icon, text }: { icon: typeof Check; text: string }) { return <div className="flex items-center gap-2 py-3 text-sm text-ink-muted"><Icon className="h-4 w-4 text-success-700" aria-hidden="true" />{text}</div> }
function dateLabel(value: string) { return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'Pacific/Guam' }).format(new Date(`${value}T00:00:00+10:00`)) }
function weekRange(start?: string, end?: string) { return start && end ? `${dateLabel(start)} – ${dateLabel(end)}` : 'Current learning week' }
function groupLessons(items: WeeklyPlanLessonItem[]) {
  const groups = new Map<string, WeeklyPlanLessonItem[]>()
  items.forEach((item) => {
    const label = item.carried_forward ? 'Open from earlier' : dateLabel(item.scheduled_for)
    groups.set(label, [...(groups.get(label) || []), item])
  })
  return [...groups.entries()]
}
