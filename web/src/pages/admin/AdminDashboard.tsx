import { useSearchParams } from 'react-router-dom'
import { PreviewLink as Link } from '../../contexts/PreviewNavigationContext'
import { RefreshCw } from 'lucide-react'
import { api } from '../../lib/api'
import { useCohortContext } from '../../contexts/CohortContext'
import { useStaffResource } from '../../lib/useStaffResource'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { LoadError } from '../../components/shared/LoadError'
import { cohortScopeOptions, PageHeader, ScopeControl } from '../../components/ui/PageHeader'
import { formatHeaderDate } from '../../lib/format'
import { LinkButton } from '../../components/ui/Button'
import { TodayInbox } from '../../components/admin/TodayInbox'
import { cohortPath } from '../../lib/routes'

type AdminDashboardData = import('../../types/api').DashboardData

export function AdminDashboard() {
  const { cohorts = [] } = useCohortContext()
  const [searchParams, setSearchParams] = useSearchParams()
  const candidate = Number(searchParams.get('cohort_id'))
  const selectedCohortId = Number.isInteger(candidate) && candidate > 0 ? candidate : null
  const { data, loading, error, reload } = useStaffResource<AdminDashboardData>(String(selectedCohortId), async () => {
    const result = await api.getDashboard(selectedCohortId ?? undefined)
    return { data: result.data?.dashboard, error: result.error, fromCache: result.fromCache }
  })
  if (loading && !data) return <LoadingSpinner message="Loading Today…" />
  if (!data) return <div className="app-page-wide"><LoadError error={error || 'Today couldn’t load.'} retry={() => void reload()} /></div>
  const today = data.today
  const scoped = (path: string) => `${path}${selectedCohortId ? `${path.includes('?') ? '&' : '?'}cohort_id=${selectedCohortId}` : ''}`
  const needYou = today?.items.length ?? 0
  const inboxPath = (kind: string) => { const params = new URLSearchParams(searchParams); params.set('kind', kind); return `/admin?${params}` }
  const scopeName = cohorts.find((cohort) => cohort.id === selectedCohortId)?.name || data.cohort?.name || `Cohort ${selectedCohortId}`
  // A cohort in the URL that isn't in the list (still loading, or no access) still shows as the scope.
  const scopeOptions = cohortScopeOptions(selectedCohortId && !cohorts.some((cohort) => cohort.id === selectedCohortId) ? [...cohorts, { id: selectedCohortId, name: scopeName }] : cohorts)
  return <div className="app-page-wide">
    <PageHeader
      title="Today"
      description={<>{formatHeaderDate()} · {needYou === 1 ? '1 thing needs you' : `${needYou} things need you`}{selectedCohortId ? <> in {scopeName}</> : null}</>}
      scope={<ScopeControl value={selectedCohortId ? String(selectedCohortId) : ''} options={scopeOptions} onChange={(value) => { const next = new URLSearchParams(searchParams); if (value) next.set('cohort_id', value); else next.delete('cohort_id'); setSearchParams(next) }} />}
      menu={[{ key: 'refresh', label: loading ? 'Refreshing…' : 'Refresh', icon: <RefreshCw aria-hidden="true" />, onSelect: () => void reload() }]}
    />
    {error && <LoadError error={error} stale retry={() => void reload()} />}
    <nav className="flex flex-wrap gap-2" aria-label="Staff summary">{[
      [today?.counts.help ?? 0, 'Help requests', inboxPath('help')],
      [today?.counts.review ?? 0, 'Waiting for review', inboxPath('review')],
      [today?.counts.message ?? 0, 'Unread conversations', inboxPath('message')],
      [today?.counts.quiet ?? 0, 'Going quiet', inboxPath('quiet')],
    ].filter(([count]) => Number(count) > 0).map(([count, label, path]) => <Link key={String(label)} to={String(path)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line px-3 text-sm font-semibold text-ink"><span className="tabular-nums">{count}</span>{label}</Link>)}</nav>
    {today ? <TodayInbox today={today} /> : <LoadError error="Today couldn’t load. Refresh to try again." retry={() => void reload()} />}
    {today && today.upcoming.length > 0 && <section className="app-surface p-4" aria-label="Upcoming today"><h2 className="font-bold text-ink">Upcoming today</h2><div className="flex flex-wrap gap-3">{today.upcoming.map((event, index) => <Link key={index} to={event.web_path} className="inline-flex min-h-11 items-center gap-2 text-sm text-ink">{new Date(event.starts_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} · {event.title}</Link>)}</div></section>}
    <div className="flex flex-wrap gap-3"><LinkButton variant="secondary" to={data.cohort ? cohortPath(data.cohort.id) : '/admin/cohorts'}>Open cohort</LinkButton><LinkButton variant="secondary" to={scoped('/admin/students?filter=never-signed-in')}>Access &amp; invitations</LinkButton></div>
  </div>
}
