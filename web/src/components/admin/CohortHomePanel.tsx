import { Link } from 'react-router-dom'
import { ArrowRight, CalendarDays, ClipboardCheck, LifeBuoy, Megaphone, MessageSquareText, UserPlus, Users } from 'lucide-react'
import { formatShortDateTime } from '../../lib/format'
import { cohortStudentPath } from '../../lib/routes'
import type { CohortHome } from '../../types/api'

function ActionCard({ value, label, detail, to, icon: Icon, tone = 'slate' }: { value: number; label: string; detail: string; to: string; icon: typeof Users; tone?: 'slate' | 'primary' }) {
  return <Link to={to} className={`group flex min-h-36 flex-col justify-between rounded-2xl border p-4 transition-colors focus-visible:outline-2 focus-visible:outline-primary-600 ${tone === 'primary' ? 'border-primary-200 bg-primary-50 hover:bg-primary-100' : 'border-slate-200 bg-white hover:border-primary-200'}`}>
    <div className="flex items-start justify-between"><span className={`flex h-10 w-10 items-center justify-center rounded-xl ${tone === 'primary' ? 'bg-white text-primary-700' : 'bg-slate-100 text-slate-700'}`}><Icon className="h-5 w-5" /></span><ArrowRight className="h-4 w-4 text-slate-400 transition-transform group-hover:translate-x-1" /></div>
    <div><p className="text-3xl font-extrabold tabular-nums tracking-tight text-slate-950">{value}</p><p className="text-sm font-extrabold text-slate-800">{label}</p><p className="mt-0.5 text-xs text-slate-500">{detail}</p></div>
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

  return <div className="space-y-5">
    <section aria-labelledby="cohort-at-glance" className="space-y-3"><div className="flex flex-wrap items-end justify-between gap-2"><div><p className="app-eyebrow">This cohort</p><h2 id="cohort-at-glance" className="mt-1 text-xl font-extrabold tracking-tight text-slate-950">At a glance</h2></div><span className="text-sm font-medium text-slate-500">{home.cohort.curriculum_name}</span></div>
      {counts && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"><ActionCard value={counts.ungraded} label="Ready to grade" detail="Review submitted work" to={`/admin/grading?cohort_id=${cohortId}`} icon={ClipboardCheck} tone="primary" /><ActionCard value={counts.open_help} label="Open help requests" detail="Respond to students" to={`/admin/support?cohort_id=${cohortId}`} icon={LifeBuoy} /><ActionCard value={counts.active_students} label="Active students" detail={`${counts.joined} joined cohort · ${counts.invited} added, not yet opened`} to={`/admin/cohorts/${cohortId}?tab=students`} icon={Users} /></div>}
    </section>

    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.85fr)]">
      <section className="app-surface overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4"><div><p className="app-eyebrow">People and progress</p><h2 className="mt-1 text-lg font-extrabold text-slate-950">Needs your attention</h2></div><Link to={`/admin/cohorts/${cohortId}?tab=students`} className="app-link inline-flex min-h-11 items-center gap-1 text-sm font-bold">Full roster <ArrowRight className="h-4 w-4" /></Link></div>
        {attention.length ? <div className="divide-y divide-slate-100">{attention.map((student) => <Link key={student.enrollment_id} to={cohortStudentPath(cohortId, student.user_id)} className="group flex min-h-20 items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50"><div className="min-w-0"><p className="truncate text-sm font-extrabold text-slate-900 group-hover:text-primary-700">{student.full_name || student.email}</p><p className="mt-1 text-xs text-slate-500">{student.joined_at ? 'Joined cohort' : 'Added, not yet opened'} · {student.progress_percentage}% complete{student.ungraded_count ? ` · ${student.ungraded_count} to grade` : ''}{student.redo_count ? ` · ${student.redo_count} redo` : ''}{student.invite_delivery_status === 'failed' ? ' · account invite failed' : ''}</p></div><ArrowRight className="h-4 w-4 shrink-0 text-slate-400" /></Link>)}</div> : <p className="px-5 py-8 text-sm text-slate-500">No students need follow-up right now. Open the roster to see everyone’s progress.</p>}
        {counts && <div className="flex flex-wrap gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3 text-xs font-bold text-slate-600"><span>{counts.redos} redos</span><span aria-hidden="true">·</span><span>{counts.invited} added, not yet opened</span></div>}
      </section>

      <div className="space-y-5"><section className="app-surface p-5"><div className="flex items-center justify-between gap-2"><div><p className="app-eyebrow">Schedule</p><h2 className="mt-1 text-lg font-extrabold text-slate-950">Coming up</h2></div><CalendarDays className="h-5 w-5 text-primary-700" /></div><div className="mt-4 space-y-3">{home.upcoming_events.length ? home.upcoming_events.slice(0, 3).map((event) => <div key={event.id} className="rounded-xl border border-slate-200 p-3"><p className="text-sm font-bold text-slate-900">{event.title}</p><p className="mt-1 text-xs text-slate-500">{formatShortDateTime(event.starts_at, 'Not scheduled', event.timezone)}</p></div>) : <p className="text-sm text-slate-500">No live sessions scheduled.</p>}</div><Link to={`/admin/cohorts/${cohortId}?tab=schedule`} className="app-link mt-3 inline-flex min-h-11 items-center gap-1 text-sm font-bold">View schedule <ArrowRight className="h-4 w-4" /></Link></section>
        <section className="app-surface p-5"><p className="app-eyebrow">Communication</p><h2 className="mt-1 text-lg font-extrabold text-slate-950">Keep the class connected</h2><div className="mt-4 grid gap-2"><Link to={`/messages?workspace_id=${home.cohort.workspace_id || ''}`} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-bold text-slate-800 hover:border-primary-300"><MessageSquareText className="h-4 w-4 text-primary-700" />Class messages</Link><Link to={`/announcements?scope=manage&audience=cohort&cohort_id=${cohortId}`} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-bold text-slate-800 hover:border-primary-300"><Megaphone className="h-4 w-4 text-primary-700" />Announcements</Link>{home.permissions?.can_manage_roster && <Link to={`/admin/cohorts/${cohortId}/settings`} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-bold text-slate-800 hover:border-primary-300"><UserPlus className="h-4 w-4 text-primary-700" />Invite students</Link>}</div></section>
      </div>
    </div>
  </div>
}
