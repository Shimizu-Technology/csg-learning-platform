import { Link } from 'react-router-dom'
import { ArrowRight, CalendarDays, ClipboardCheck, LifeBuoy, Megaphone, MessageSquareText, UserPlus, Users } from 'lucide-react'
import { formatDateTimeRange } from '../../lib/format'
import type { CohortHome } from '../../types/api'
import { AttentionList } from './AttentionList'
import { cohortPath, cohortSettingsPath } from '../../lib/routes'
import { TERMS } from '../../lib/glossary'

function ActionCard({ value, label, detail, to, icon: Icon }: { value: number; label: string; detail: string; to: string; icon: typeof Users }) {
  return <Link to={to} className="pressable group flex min-h-36 flex-col justify-between rounded-2xl border border-line bg-surface-raised p-4 shadow-raised hover:border-line-strong hover:bg-surface-sunken">
    <div className="flex items-start justify-between"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-sunken text-ink-secondary"><Icon className="h-5 w-5" /></span><ArrowRight className="h-4 w-4 text-ink-muted" /></div>
    <div><p className="text-3xl font-bold tabular-nums tracking-tight text-ink">{value}</p><p className="text-sm font-semibold text-ink">{label}</p><p className="mt-0.5 text-xs text-ink-muted">{detail}</p></div>
  </Link>
}

/** Repeating office hours share one session id, so each occurrence is keyed by id and start time. */
function occurrenceKey(event: Pick<CohortHome['upcoming_events'][number], 'id' | 'starts_at'>) {
  return `${event.id}:${event.starts_at ?? ''}`
}

export function CohortHomePanel({ home }: { home: CohortHome }) {
  const cohortId = home.cohort.id
  const counts = home.counts

  return <div className="@container space-y-5">
    <section aria-labelledby="cohort-at-glance" className="space-y-3"><div className="flex flex-wrap items-end justify-between gap-2"><div><p className="text-xs font-semibold text-ink-muted">This cohort</p><h2 id="cohort-at-glance" className="mt-1 text-lg font-bold text-ink">At a glance</h2></div><div className="flex min-w-0 flex-wrap items-center gap-x-4"><span className="min-w-0 truncate text-sm font-medium text-ink-muted" title={home.cohort.curriculum_name}>{home.cohort.curriculum_name}</span><Link to={cohortPath(cohortId, 'insights')} className="app-link inline-flex min-h-11 items-center gap-1 text-sm">View insights <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link></div></div>
      {counts && <div className="grid gap-3 @md:grid-cols-2 @2xl:grid-cols-3"><ActionCard value={counts.ungraded} label="Ready to grade" detail="Review submitted work" to={`/admin/grading?cohort_id=${cohortId}`} icon={ClipboardCheck} /><ActionCard value={counts.open_help} label="Open help requests" detail="Respond to students" to={`/admin/support?cohort_id=${cohortId}`} icon={LifeBuoy} /><ActionCard value={counts.active_students} label="Active students" detail={`${counts.joined} joined cohort · ${counts.invited} added, not yet opened`} to={cohortPath(cohortId, 'students')} icon={Users} /></div>}
    </section>

    <div className="grid gap-5 @3xl:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.85fr)]">
      {home.attention ? <AttentionList students={home.attention.students} limit={5} viewAll={`/admin/support?cohort_id=${cohortId}`} /> : <p role="alert" className="app-surface p-5 text-sm text-ink-secondary">Attention data unavailable. Refresh the cohort to try again.</p>}

      <div className="min-w-0 space-y-5"><section className="app-surface p-5"><div className="flex items-center justify-between gap-2"><div><p className="text-xs font-semibold text-ink-muted">Schedule</p><h2 className="mt-1 text-lg font-bold text-ink">Coming up</h2></div><CalendarDays className="h-5 w-5 text-ink-muted" /></div><div className="mt-4 space-y-3">{home.upcoming_events.length ? home.upcoming_events.slice(0, 3).map((event) => <div key={occurrenceKey(event)} className="min-w-0 rounded-xl border border-line p-3"><p className="truncate text-sm font-semibold text-ink" title={event.title}>{event.title}</p><p className="mt-1 text-xs tabular-nums text-ink-muted">{formatDateTimeRange(event.starts_at, event.ends_at, 'Not scheduled', event.timezone)}</p></div>) : <p className="text-sm text-ink-muted">No live classes or office hours scheduled.</p>}</div><Link to={cohortPath(cohortId, 'schedule')} className="app-link mt-3 inline-flex min-h-11 items-center gap-1 text-sm">View schedule <ArrowRight className="h-4 w-4" /></Link></section>
        <section className="app-surface p-5"><p className="text-xs font-semibold text-ink-muted">Communication</p><h2 className="mt-1 text-lg font-bold text-ink">Keep the class connected</h2><div className="mt-4 grid gap-2"><Link to={`/messages?workspace_id=${home.cohort.workspace_id || ''}&cohort_id=${cohortId}`} className="pressable inline-flex min-h-11 items-center gap-2 rounded-xl border border-line px-3 text-sm font-semibold text-ink hover:border-line-strong hover:bg-surface-sunken"><MessageSquareText className="h-4 w-4 text-ink-muted" />{TERMS.classChat}</Link><Link to={`/announcements?scope=manage&audience=cohort&cohort_id=${cohortId}`} className="pressable inline-flex min-h-11 items-center gap-2 rounded-xl border border-line px-3 text-sm font-semibold text-ink hover:border-line-strong hover:bg-surface-sunken"><Megaphone className="h-4 w-4 text-ink-muted" />{TERMS.updates}</Link>{home.permissions?.can_manage_roster && <Link to={cohortSettingsPath(cohortId, 'students')} className="pressable inline-flex min-h-11 items-center gap-2 rounded-xl border border-line px-3 text-sm font-semibold text-ink hover:border-line-strong hover:bg-surface-sunken"><UserPlus className="h-4 w-4 text-ink-muted" />Invite students</Link>}</div></section>
      </div>
    </div>
  </div>
}
