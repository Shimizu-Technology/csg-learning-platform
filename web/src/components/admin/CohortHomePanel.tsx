import { Link } from 'react-router-dom'
import { ArrowRight, CalendarDays, ClipboardCheck, LifeBuoy, Megaphone, MessageSquareText, UserPlus, Users } from 'lucide-react'
import { formatDateTimeRange } from '../../lib/format'
import { cohortStudentPath } from '../../lib/routes'
import type { CohortHome } from '../../types/api'
import { UnassignedLearnersWarning } from './UnassignedLearnersWarning'
import { Avatar } from '../ui/Avatar'

function ActionCard({ value, label, detail, to, icon: Icon }: { value: number; label: string; detail: string; to: string; icon: typeof Users }) {
  return <Link to={to} className="pressable group flex min-h-36 flex-col justify-between rounded-2xl border border-line bg-surface-raised p-4 shadow-raised hover:border-line-strong hover:bg-surface-sunken">
    <div className="flex items-start justify-between"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-sunken text-ink-secondary"><Icon className="h-5 w-5" /></span><ArrowRight className="h-4 w-4 text-ink-muted" /></div>
    <div><p className="text-3xl font-bold tabular-nums tracking-tight text-ink">{value}</p><p className="text-sm font-semibold text-ink">{label}</p><p className="mt-0.5 text-xs text-ink-muted">{detail}</p></div>
  </Link>
}

export function CohortHomePanel({ home }: { home: CohortHome }) {
  const cohortId = home.cohort.id
  const counts = home.counts
  const students = [...(home.students || [])].sort((a, b) => {
    const attention = (student: typeof a) => student.ungraded_count * 2 + student.redo_count + (student.invite_delivery_status === 'failed' ? 3 : 0)
    return attention(b) - attention(a) || a.full_name.localeCompare(b.full_name)
  })
  const attention = students.filter((student) => student.ungraded_count || student.redo_count || student.invite_delivery_status === 'failed').slice(0, 5)

  const withoutModules = students.filter((student) => student.status === 'active' && student.assigned_module_count === 0)

  return <div className="space-y-5">
    <UnassignedLearnersWarning cohortId={cohortId} count={counts?.without_modules || 0} learners={withoutModules} />
    <section aria-labelledby="cohort-at-glance" className="space-y-3"><div className="flex flex-wrap items-end justify-between gap-2"><div><p className="text-xs font-semibold text-ink-muted">This cohort</p><h2 id="cohort-at-glance" className="mt-1 text-lg font-bold text-ink">At a glance</h2></div><span className="min-w-0 truncate text-sm font-medium text-ink-muted" title={home.cohort.curriculum_name}>{home.cohort.curriculum_name}</span></div>
      {counts && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"><ActionCard value={counts.ungraded} label="Ready to grade" detail="Review submitted work" to={`/admin/grading?cohort_id=${cohortId}`} icon={ClipboardCheck} /><ActionCard value={counts.open_help} label="Open help requests" detail="Respond to students" to={`/admin/support?cohort_id=${cohortId}`} icon={LifeBuoy} /><ActionCard value={counts.active_students} label="Active students" detail={`${counts.joined} joined cohort · ${counts.invited} added, not yet opened`} to={`/admin/cohorts/${cohortId}?tab=students`} icon={Users} /></div>}
    </section>

    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.85fr)]">
      <section className="app-surface overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-4"><div><p className="text-xs font-semibold text-ink-muted">People and progress</p><h2 className="mt-1 text-lg font-bold text-ink">Needs your attention</h2></div><Link to={`/admin/cohorts/${cohortId}?tab=students`} className="app-link inline-flex min-h-11 items-center gap-1 text-sm">Full roster <ArrowRight className="h-4 w-4" /></Link></div>
        {attention.length ? <div className="divide-y divide-line">{attention.map((student) => <Link key={student.enrollment_id} to={cohortStudentPath(cohortId, student.user_id)} className="pressable group flex min-h-20 items-center justify-between gap-3 px-5 py-3 hover:bg-surface-sunken"><div className="flex min-w-0 items-center gap-3"><Avatar name={student.full_name || student.email} size="sm" /><div className="min-w-0"><p className="truncate text-sm font-semibold text-ink" title={student.full_name || student.email}>{student.full_name || student.email}</p><p className="mt-1 text-xs tabular-nums text-ink-muted">{student.joined_at ? 'Joined cohort' : 'Added, not yet opened'} · {student.progress_percentage}% complete{student.ungraded_count ? ` · ${student.ungraded_count} to grade` : ''}{student.redo_count ? ` · ${student.redo_count} redo` : ''}{student.invite_delivery_status === 'failed' ? ' · account invite failed' : ''}</p></div></div><ArrowRight className="h-4 w-4 shrink-0 text-ink-muted" /></Link>)}</div> : <p className="px-5 py-8 text-sm text-ink-muted">No students need follow-up right now. Open the roster to see everyone’s progress.</p>}
        {counts && <div className="flex flex-wrap gap-2 border-t border-line bg-surface-sunken px-5 py-3 text-xs font-semibold tabular-nums text-ink-secondary"><span>{counts.redos} redos</span><span aria-hidden="true">·</span><span>{counts.invited} added, not yet opened</span></div>}
      </section>

      <div className="space-y-5"><section className="app-surface p-5"><div className="flex items-center justify-between gap-2"><div><p className="text-xs font-semibold text-ink-muted">Schedule</p><h2 className="mt-1 text-lg font-bold text-ink">Coming up</h2></div><CalendarDays className="h-5 w-5 text-ink-muted" /></div><div className="mt-4 space-y-3">{home.upcoming_events.length ? home.upcoming_events.slice(0, 3).map((event) => <div key={event.id} className="min-w-0 rounded-xl border border-line p-3"><p className="truncate text-sm font-semibold text-ink" title={event.title}>{event.title}</p><p className="mt-1 text-xs tabular-nums text-ink-muted">{formatDateTimeRange(event.starts_at, event.ends_at, 'Not scheduled', event.timezone)}</p></div>) : <p className="text-sm text-ink-muted">No live sessions scheduled.</p>}</div><Link to={`/admin/cohorts/${cohortId}?tab=schedule`} className="app-link mt-3 inline-flex min-h-11 items-center gap-1 text-sm">View schedule <ArrowRight className="h-4 w-4" /></Link></section>
        <section className="app-surface p-5"><p className="text-xs font-semibold text-ink-muted">Communication</p><h2 className="mt-1 text-lg font-bold text-ink">Keep the class connected</h2><div className="mt-4 grid gap-2"><Link to={`/messages?workspace_id=${home.cohort.workspace_id || ''}`} className="pressable inline-flex min-h-11 items-center gap-2 rounded-xl border border-line px-3 text-sm font-semibold text-ink hover:border-line-strong hover:bg-surface-sunken"><MessageSquareText className="h-4 w-4 text-ink-muted" />Class messages</Link><Link to={`/announcements?scope=manage&audience=cohort&cohort_id=${cohortId}`} className="pressable inline-flex min-h-11 items-center gap-2 rounded-xl border border-line px-3 text-sm font-semibold text-ink hover:border-line-strong hover:bg-surface-sunken"><Megaphone className="h-4 w-4 text-ink-muted" />Announcements</Link>{home.permissions?.can_manage_roster && <Link to={`/admin/cohorts/${cohortId}/settings`} className="pressable inline-flex min-h-11 items-center gap-2 rounded-xl border border-line px-3 text-sm font-semibold text-ink hover:border-line-strong hover:bg-surface-sunken"><UserPlus className="h-4 w-4 text-ink-muted" />Invite students</Link>}</div></section>
      </div>
    </div>
  </div>
}
