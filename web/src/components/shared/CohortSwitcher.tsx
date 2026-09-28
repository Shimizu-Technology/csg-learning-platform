import { ChevronDown, Layers3 } from 'lucide-react'
import { useAuthContext } from '../../contexts/AuthContext'
import { useCohortContext } from '../../contexts/CohortContext'

export function CohortSwitcher({ compact = false }: { compact?: boolean }) {
  const { user } = useAuthContext()
  const { cohorts, selectedCohort, loading, error, selectCohort } = useCohortContext()
  const current = cohorts.filter((cohort) => !['completed', 'archived'].includes(cohort.status))
  const past = cohorts.filter((cohort) => ['completed', 'archived'].includes(cohort.status))

  if (!user || (loading && cohorts.length === 0)) return null

  return <div className={`relative min-w-0 ${compact ? 'flex-1' : 'w-full'}`}>
    <Layers3 aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-primary-600" />
    <select
      aria-label="Switch cohort workspace"
      title={error || undefined}
      value={selectedCohort?.id ?? ''}
      onChange={(event) => selectCohort(event.target.value ? Number(event.target.value) : null)}
      className={`min-h-11 w-full min-w-0 appearance-none truncate rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-9 text-sm font-bold text-slate-800 outline-none transition hover:border-primary-300 focus-visible:border-primary-500 focus-visible:ring-2 focus-visible:ring-primary-200 ${compact ? '' : 'shadow-sm'}`}
    >
      {user.is_staff && <option value="">All cohorts</option>}
      {!user.is_staff && !selectedCohort && <option value="">Choose a cohort</option>}
      {current.length > 0 && <optgroup label="Current cohorts">{current.map((cohort) => <option key={cohort.id} value={cohort.id}>{cohort.name}</option>)}</optgroup>}
      {past.length > 0 && <optgroup label="Past learning">{past.map((cohort) => <option key={cohort.id} value={cohort.id}>{cohort.name}</option>)}</optgroup>}
    </select>
    <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
    {error && <span className="sr-only" role="status">{error}</span>}
  </div>
}
