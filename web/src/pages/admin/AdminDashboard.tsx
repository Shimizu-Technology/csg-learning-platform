import { useSearchParams } from 'react-router-dom'
import { PreviewLink as Link } from '../../contexts/PreviewNavigationContext'
import { ArrowRight, ClipboardCheck, LifeBuoy, RefreshCw, Users } from 'lucide-react'
import { api } from '../../lib/api'
import { useCohortContext } from '../../contexts/CohortContext'
import { useStaffResource } from '../../lib/useStaffResource'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { LoadError } from '../../components/shared/LoadError'
import { cohortScopeOptions, PageHeader, ScopeControl } from '../../components/ui/PageHeader'
import { formatHeaderDate } from '../../lib/format'
import { LinkButton } from '../../components/ui/Button'
import { AttentionList } from '../../components/admin/AttentionList'
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
  const attention = data.attention
  const supportPath = `/admin/support${selectedCohortId ? `?cohort_id=${selectedCohortId}` : ''}`
  const firstName = data.user.full_name?.split(' ')[0]
  const needYou = attention?.summary.student_count ?? 0
  const scopeName = cohorts.find((cohort) => cohort.id === selectedCohortId)?.name || data.cohort?.name || `Cohort ${selectedCohortId}`
  // A cohort in the URL that isn't in the list (still loading, or no access) still shows as the scope.
  const scopeOptions = cohortScopeOptions(selectedCohortId && !cohorts.some((cohort) => cohort.id === selectedCohortId) ? [...cohorts, { id: selectedCohortId, name: scopeName }] : cohorts)
  return <div className="app-page-wide">
    <PageHeader
      title={firstName ? `Good to see you, ${firstName}` : 'Today'}
      description={<>{formatHeaderDate()} · {needYou === 1 ? '1 learner needs you' : `${needYou} learners need you`}{selectedCohortId ? <> in {scopeName}</> : null}</>}
      scope={<ScopeControl value={selectedCohortId ? String(selectedCohortId) : ''} options={scopeOptions} onChange={(value) => { const next = new URLSearchParams(searchParams); if (value) next.set('cohort_id', value); else next.delete('cohort_id'); setSearchParams(next) }} />}
      menu={[{ key: 'refresh', label: loading ? 'Refreshing…' : 'Refresh', icon: <RefreshCw aria-hidden="true" />, onSelect: () => void reload() }]}
    />
    {error && <LoadError error={error} stale retry={() => void reload()} />}
    <section className="grid gap-3 sm:grid-cols-3" aria-label="Staff summary">{[
      [attention?.summary.ungraded_count ?? 0, 'Waiting for review', `/admin/grading${selectedCohortId ? `?cohort_id=${selectedCohortId}` : ''}`, ClipboardCheck],
      [attention?.summary.student_count ?? 0, 'Students who need attention', supportPath, LifeBuoy],
      [attention?.summary.checked_enrollment_count ?? 0, 'Active students', '/admin/cohorts', Users],
    ].map(([count, label, path, Icon]) => { const ItemIcon = Icon as typeof Users; return <Link key={label as string} to={path as string} className="app-surface pressable min-h-11 p-5 hover:bg-surface-sunken"><ItemIcon className="h-5 w-5 text-ink-muted" aria-hidden="true" /><p className="mt-4 text-3xl font-bold tabular-nums text-ink">{count as number}</p><p className="mt-1 text-sm text-ink-secondary">{label as string}</p></Link> })}</section>
    {attention ? <AttentionList students={attention.students} limit={5} viewAll={supportPath} /> : <LoadError error="Needs attention couldn’t load. Refresh to try again." retry={() => void reload()} />}
    <div className="flex flex-wrap gap-3"><LinkButton variant="secondary" to={data.cohort ? cohortPath(data.cohort.id) : '/admin/cohorts'}>Open cohort<ArrowRight className="h-4 w-4" aria-hidden="true" /></LinkButton><LinkButton variant="secondary" to="/admin/cohorts">Access &amp; invitations</LinkButton></div>
  </div>
}
