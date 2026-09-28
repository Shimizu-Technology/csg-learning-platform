import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowRight, BookOpen, CalendarDays, Megaphone, MessageSquareText, Users } from 'lucide-react'
import { api } from '../../lib/api'
import { formatShortDateTime } from '../../lib/format'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { EmptyState } from '../../components/shared/EmptyState'
import { ProgressBar } from '../../components/shared/ProgressBar'
import type { CohortHome } from '../../types/api'

export function StudentCohortHome() {
  const { id } = useParams<{ id: string }>()
  const cohortId = Number(id)
  const [home, setHome] = useState<CohortHome | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!Number.isInteger(cohortId) || cohortId <= 0) { setError('This cohort address is invalid.'); setLoading(false); return }
    let active = true
    setLoading(true)
    setHome(null)
    void api.getCohortHome(cohortId).then((result) => {
      if (!active) return
      if (result.data && !result.error && !result.fromCache) { setHome(result.data.home); setError(null) }
      else setError(result.error || 'This cohort is unavailable.')
      setLoading(false)
    })
    return () => { active = false }
  }, [cohortId])

  if (loading) return <LoadingSpinner message="Loading your cohort…" />
  if (!home || error) return <EmptyState icon={Users} title="Could not open cohort" description={error || 'This cohort is unavailable.'} />

  return <div className="app-page-wide space-y-6"><header><p className="app-eyebrow">Your cohort</p><div className="mt-2 flex flex-wrap items-center gap-3"><h1 className="app-title">{home.cohort.name}</h1><span className="rounded-full bg-primary-50 px-2.5 py-1 text-xs font-extrabold capitalize text-primary-700">{home.cohort.status}</span></div><p className="app-description mt-2">{home.cohort.curriculum_name}</p></header>
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)]"><section className="app-surface p-5 sm:p-6"><div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-50 text-primary-700"><BookOpen className="h-5 w-5" /></span><div><p className="app-eyebrow">Learning</p><h2 className="text-xl font-extrabold text-slate-950">Your progress</h2></div></div><p className="mt-6 text-4xl font-extrabold tabular-nums tracking-tight text-slate-950">{home.own_progress_percentage ?? 0}%</p><div className="mt-3"><ProgressBar value={home.own_progress_percentage ?? 0} size="sm" /></div><p className="mt-3 text-sm text-slate-600">Pick up where you left off in the curriculum.</p><Link to="/materials" className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary-600 px-4 text-sm font-bold text-white">Open learning <ArrowRight className="h-4 w-4" /></Link></section>
      <section className="app-surface p-5 sm:p-6"><p className="app-eyebrow">Class community</p><h2 className="mt-1 text-xl font-extrabold text-slate-950">Stay connected</h2><p className="mt-2 text-sm leading-6 text-slate-600">Questions and class conversation stay with this cohort.</p><div className="mt-5 grid gap-2"><Link to={`/messages?workspace_id=${home.cohort.workspace_id || ''}`} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-bold text-slate-800 hover:border-primary-300"><MessageSquareText className="h-4 w-4 text-primary-700" />Class messages</Link><Link to={`/announcements?audience=cohort&cohort_id=${cohortId}`} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-bold text-slate-800 hover:border-primary-300"><Megaphone className="h-4 w-4 text-primary-700" />Class updates</Link></div></section></div>
    <div className="grid gap-5 lg:grid-cols-2"><section className="app-surface p-5 sm:p-6"><div className="flex items-center gap-2"><CalendarDays className="h-5 w-5 text-primary-700" /><h2 className="text-lg font-extrabold text-slate-950">Coming up</h2></div><div className="mt-4 space-y-2">{home.upcoming_events.length ? home.upcoming_events.map((event) => <div key={event.id} className="rounded-xl border border-slate-200 p-3"><p className="text-sm font-bold text-slate-900">{event.title}</p><p className="mt-1 text-xs text-slate-500">{formatShortDateTime(event.starts_at, 'Not scheduled', event.timezone)}</p></div>) : <p className="text-sm text-slate-500">No sessions scheduled yet.</p>}</div></section><section className="app-surface p-5 sm:p-6"><div className="flex items-center gap-2"><Megaphone className="h-5 w-5 text-primary-700" /><h2 className="text-lg font-extrabold text-slate-950">Latest updates</h2></div><div className="mt-4 space-y-2">{home.recent_announcements.length ? home.recent_announcements.map((announcement) => <Link key={announcement.id} to={`/announcements/${announcement.id}`} className="block min-h-11 rounded-xl border border-slate-200 p-3 text-sm font-bold text-slate-800 hover:border-primary-300">{announcement.title}</Link>) : <p className="text-sm text-slate-500">No class updates yet.</p>}</div></section></div>
  </div>
}
