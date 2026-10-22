import { Link } from 'react-router-dom'
import { ArrowRight, ClipboardCheck, LifeBuoy, Users } from 'lucide-react'
import { api } from '../../lib/api'
import { useCohortContext } from '../../contexts/CohortContext'
import { useStaffResource } from '../../lib/useStaffResource'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { LoadError } from '../../components/shared/LoadError'
import { PageHeader } from '../../components/ui/PageHeader'
import { Button, LinkButton } from '../../components/ui/Button'
import { AttentionList } from '../../components/admin/AttentionList'
import type { StaffAttention } from '../../types/api'

interface AdminDashboardData {
  user: { full_name?: string }
  cohort?: { id: number; name: string; active_count: number }
  cohorts?: { cohort: { id: number; active_count: number } }[]
  attention?: StaffAttention
}

export function AdminDashboard() {
  const { selectedCohortId } = useCohortContext()
  const { data, loading, error, reload } = useStaffResource<AdminDashboardData>(String(selectedCohortId), async () => {
    const result = await api.getDashboard(selectedCohortId ?? undefined)
    return { data: result.data?.dashboard, error: result.error, fromCache: result.fromCache }
  })
  if (loading && !data) return <LoadingSpinner message="Loading staff dashboard..." />
  if (!data) return <div className="app-page-wide"><LoadError error={error || 'Staff dashboard unavailable.'} retry={() => void reload()} /></div>
  const attention = data.attention
  const supportPath = `/admin/support${selectedCohortId ? `?cohort_id=${selectedCohortId}` : ''}`
  const firstName = data.user.full_name?.split(' ')[0]
  return <div className="app-page-wide">
    <PageHeader eyebrow="Staff workspace" title={firstName ? `Good to see you, ${firstName}` : 'Staff home'} description="Respond to learners, review work, and see what needs a follow-up." actions={<Button variant="secondary" disabled={loading} onClick={() => void reload()}>{loading ? 'Refreshing…' : 'Refresh'}</Button>} />
    {error && <LoadError error={error} stale retry={() => void reload()} />}
    <section className="grid gap-3 sm:grid-cols-3" aria-label="Staff summary">{[
      [attention?.summary.ungraded_count ?? 0, 'Latest attempts awaiting review', `/admin/grading${selectedCohortId ? `?cohort_id=${selectedCohortId}` : ''}`, ClipboardCheck],
      [attention?.summary.student_count ?? 0, 'Enrollments needing attention', supportPath, LifeBuoy],
      [attention?.summary.checked_enrollment_count ?? 0, 'Active enrollments checked', '/admin/cohorts', Users],
    ].map(([count, label, path, Icon]) => { const ItemIcon = Icon as typeof Users; return <Link key={label as string} to={path as string} className="app-surface pressable min-h-11 p-5 hover:bg-surface-sunken"><ItemIcon className="h-5 w-5 text-ink-muted" aria-hidden="true" /><p className="mt-4 text-3xl font-bold tabular-nums text-ink">{count as number}</p><p className="mt-1 text-sm text-ink-secondary">{label as string}</p></Link> })}</section>
    {attention ? <AttentionList students={attention.students} limit={5} viewAll={supportPath} /> : <LoadError error="Attention data is unavailable. Refresh to try again." retry={() => void reload()} />}
    <div className="flex flex-wrap gap-3"><LinkButton variant="secondary" to={data.cohort ? `/admin/cohorts/${data.cohort.id}` : '/admin/cohorts'}>Open cohort workspace<ArrowRight className="h-4 w-4" aria-hidden="true" /></LinkButton><LinkButton variant="secondary" to="/admin/cohorts">Access &amp; invitations</LinkButton></div>
  </div>
}
