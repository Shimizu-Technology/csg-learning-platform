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
  const activeKind = searchParams.get('kind')
  const scoped = (path: string) => `${path}${selectedCohortId ? `${path.includes('?') ? '&' : '?'}cohort_id=${selectedCohortId}` : ''}`
  const needYou = Object.values(today?.counts ?? {}).reduce((sum, count) => sum + count, 0) + (today?.attention_remaining ?? 0)
  const inboxPath = (kind: string) => {
    const params = new URLSearchParams(searchParams)
    if (activeKind === kind) params.delete('kind')
    else params.set('kind', kind)
    const query = params.toString()
    return query ? `/admin?${query}` : '/admin'
  }
  // Waiting work opens the Grading workbench, where Save and next keeps going; it returns here.
  const gradingPath = `${scoped('/admin/grading')}${selectedCohortId ? '&' : '?'}return_to=${encodeURIComponent(`/admin${searchParams.toString() ? `?${searchParams}` : ''}`)}`
  const scopeName = cohorts.find((cohort) => cohort.id === selectedCohortId)?.name || data.cohort?.name || 'Not one of your cohorts'
  // A cohort in the URL that isn't in the list (still loading, or no access) still shows as the scope.
  const scopeOptions = cohortScopeOptions(selectedCohortId && !cohorts.some((cohort) => cohort.id === selectedCohortId) ? [...cohorts, { id: selectedCohortId, name: scopeName }] : cohorts)
  const summaryPills = [
    { kind: 'help', count: today?.counts.help ?? 0, label: 'Help requests', path: inboxPath('help') },
    { kind: 'review', count: today?.counts.review ?? 0, label: 'Waiting for review', path: gradingPath },
    { kind: 'message', count: today?.counts.message ?? 0, label: 'Unread conversations', path: inboxPath('message') },
    { kind: 'follow_up', count: today?.counts.follow_up ?? 0, label: 'Follow-ups', path: inboxPath('follow_up') },
    { kind: 'quiet', count: today?.counts.quiet ?? 0, label: 'Going quiet', path: inboxPath('quiet') },
  ].filter((item) => item.count > 0)
  return <div className="app-page-wide">
    <PageHeader
      title="Today"
      description={<>{formatHeaderDate()} · {needYou === 1 ? '1 thing needs you' : `${needYou} things need you`}{selectedCohortId ? <> in {scopeName}</> : null}</>}
      scope={<ScopeControl value={selectedCohortId ? String(selectedCohortId) : ''} options={scopeOptions} onChange={(value) => { const next = new URLSearchParams(searchParams); if (value) next.set('cohort_id', value); else next.delete('cohort_id'); setSearchParams(next) }} />}
      menu={[{ key: 'refresh', label: loading ? 'Refreshing…' : 'Refresh', icon: <RefreshCw aria-hidden="true" />, onSelect: () => void reload() }]}
    />
    {error && <LoadError error={error} stale retry={() => void reload()} />}
    {summaryPills.length > 0 && (
      <nav className="flex flex-wrap gap-2" aria-label="Staff summary">
        {summaryPills.map(({ kind, count, label, path }) => {
          const selected = kind !== 'review' && activeKind === kind
          return (
            <Link
              key={label}
              to={path}
              aria-current={selected ? 'true' : undefined}
              data-selected={selected ? 'true' : undefined}
              className={`pressable inline-flex min-h-11 items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-semibold transition-colors lg:min-h-9 ${
                selected
                  ? 'border-ink bg-surface-sunken text-ink'
                  : 'border-line bg-surface-raised text-ink-secondary shadow-raised hover:border-line-strong hover:bg-surface-sunken hover:text-ink'
              }`}
            >
              {selected && <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-action-primary" />}
              <span className="rounded-full bg-surface-sunken px-1.5 py-0.5 text-xs font-bold tabular-nums text-ink">{count}</span>
              {label}
            </Link>
          )
        })}
      </nav>
    )}
    {today ? <TodayInbox today={today} /> : <LoadError error="Today couldn’t load. Refresh to try again." retry={() => void reload()} />}
    {today && today.upcoming.length > 0 && <section className="app-surface p-4 sm:p-5" aria-label="Upcoming today"><h2 className="text-base font-bold text-ink">Upcoming today</h2><div className="mt-3 flex flex-wrap gap-2">{today.upcoming.map((event, index) => <Link key={index} to={event.web_path} className="pressable inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-surface-sunken/70 px-3.5 text-sm font-medium text-ink transition-colors hover:border-line-strong hover:bg-surface-sunken">{new Date(event.starts_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} · {event.title}</Link>)}</div></section>}
    <div className="flex flex-wrap gap-3"><LinkButton variant="secondary" to={data.cohort ? cohortPath(data.cohort.id) : '/admin/cohorts'}>Open cohort</LinkButton><LinkButton variant="secondary" to={scoped('/admin/students?filter=never-signed-in')}>Access &amp; invitations</LinkButton></div>
  </div>
}
