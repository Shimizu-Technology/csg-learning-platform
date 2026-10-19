import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowRight, BookOpen, CalendarDays, Megaphone, MessageSquareText, Users } from 'lucide-react'
import { api } from '../../lib/api'
import { formatShortDateTime } from '../../lib/format'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { EmptyState } from '../../components/shared/EmptyState'
import { ProgressBar } from '../../components/shared/ProgressBar'
import { Badge } from '../../components/ui/Badge'
import { LinkButton } from '../../components/ui/Button'
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

  const progress = Math.min(100, Math.max(0, Math.round(home.own_progress_percentage ?? 0)))
  const rowLink = 'pressable inline-flex min-h-11 items-center gap-2 rounded-xl border border-line px-3 text-sm font-semibold text-ink hover:border-line-strong hover:bg-surface-sunken'

  return <div className="app-page-wide space-y-6">
    <header>
      <p className="app-eyebrow">Your cohort</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="app-title min-w-0 [overflow-wrap:anywhere]">{home.cohort.name}</h1>
        <Badge className="capitalize">{home.cohort.status}</Badge>
      </div>
      <p className="app-description mt-2">{home.cohort.curriculum_name}</p>
    </header>
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)]">
      <section className="app-surface p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-sunken text-ink-secondary"><BookOpen className="h-5 w-5" aria-hidden="true" /></span>
          <div className="min-w-0"><p className="text-xs font-semibold text-ink-muted">Learning</p><h2 className="text-xl font-bold text-ink">Your progress</h2></div>
        </div>
        <p className="mt-6 text-3xl font-bold tabular-nums tracking-tight text-ink" data-testid="cohort-progress-percentage">{progress}%</p>
        <div className="mt-3"><ProgressBar value={progress} size="sm" showPercentage={false} /></div>
        <p className="mt-3 text-sm text-ink-secondary">Pick up where you left off in the curriculum.</p>
        <LinkButton to="/materials" className="mt-4">Open learning <ArrowRight className="h-4 w-4" aria-hidden="true" /></LinkButton>
      </section>
      <section className="app-surface p-5 sm:p-6">
        <p className="text-xs font-semibold text-ink-muted">Class community</p>
        <h2 className="mt-1 text-xl font-bold text-ink">Stay connected</h2>
        <p className="mt-2 text-sm leading-6 text-ink-secondary">Questions and class conversation stay with this cohort.</p>
        <div className="mt-5 grid gap-2">
          <Link to={`/messages?workspace_id=${home.cohort.workspace_id || ''}`} className={rowLink}><MessageSquareText className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />Class messages</Link>
          <Link to={`/announcements?audience=cohort&cohort_id=${cohortId}`} className={rowLink}><Megaphone className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />Class updates</Link>
        </div>
      </section>
    </div>
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="app-surface p-5 sm:p-6">
        <div className="flex items-center gap-2"><CalendarDays className="h-5 w-5 shrink-0 text-ink-muted" aria-hidden="true" /><h2 className="text-lg font-bold text-ink">Coming up</h2></div>
        <div className="mt-4 space-y-2">{home.upcoming_events.length ? home.upcoming_events.map((event) => <div key={event.id} className="rounded-xl border border-line p-3"><p className="text-sm font-semibold text-ink [overflow-wrap:anywhere]">{event.title}</p><p className="mt-1 text-xs tabular-nums text-ink-secondary">{formatShortDateTime(event.starts_at, 'Not scheduled', event.timezone)}</p></div>) : <p className="text-sm text-ink-secondary">No sessions scheduled yet.</p>}</div>
      </section>
      <section className="app-surface p-5 sm:p-6">
        <div className="flex items-center gap-2"><Megaphone className="h-5 w-5 shrink-0 text-ink-muted" aria-hidden="true" /><h2 className="text-lg font-bold text-ink">Latest updates</h2></div>
        <div className="mt-4 space-y-2">{home.recent_announcements.length ? home.recent_announcements.map((announcement) => <Link key={announcement.id} to={`/announcements/${announcement.id}`} className="pressable block min-h-11 rounded-xl border border-line p-3 text-sm font-semibold text-ink [overflow-wrap:anywhere] hover:border-line-strong hover:bg-surface-sunken">{announcement.title}</Link>) : <p className="text-sm text-ink-secondary">No class updates yet.</p>}</div>
      </section>
    </div>
  </div>
}
