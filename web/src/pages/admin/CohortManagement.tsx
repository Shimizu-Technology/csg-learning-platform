import { useEffect, useId, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Layers3, Plus, Users, Calendar, ChevronRight } from 'lucide-react'
import { api } from '../../lib/api'
import { useAuthContext } from '../../contexts/AuthContext'
import { useCohortContext } from '../../contexts/CohortContext'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { EmptyState } from '../../components/shared/EmptyState'
import { useToast } from '../../contexts/ToastContext'
import { CohortStatusBadge } from '../../components/shared/CohortStatusBadge'
import { Button } from '../../components/ui/Button'
import { FilterChip } from '../../components/ui/Choice'
import { formatShortDate } from '../../lib/format'
import type { CohortSummary, CurriculumSummary } from '../../types/api'

interface CreateCohortForm {
  name: string
  cohort_type: string
  curriculum_id: number | ''
  start_date: string
  end_date: string
}

const COHORT_TYPES = [
  { value: 'bootcamp', label: 'Bootcamp' },
  { value: 'workshop', label: 'Workshop' },
  { value: 'alumni', label: 'Alumni' },
  { value: 'custom', label: 'Custom' },
]

export function CohortManagement() {
  const { user } = useAuthContext()
  const { refreshCohorts } = useCohortContext()
  const navigate = useNavigate()
  const toast = useToast()
  const formId = useId()
  const [cohorts, setCohorts] = useState<CohortSummary[]>([])
  const [curricula, setCurricula] = useState<CurriculumSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<'current' | 'inactive' | 'all'>('current')
  const [form, setForm] = useState<CreateCohortForm>({
    name: '',
    cohort_type: 'bootcamp',
    curriculum_id: '',
    start_date: '',
    end_date: '',
  })

  useEffect(() => {
    Promise.all([api.getCohorts(), api.getCurricula()]).then(([cohortsRes, curriculaRes]) => {
      if (cohortsRes.data) setCohorts(cohortsRes.data.cohorts)
      if (curriculaRes.data) setCurricula(curriculaRes.data.curricula)
      setLoading(false)
    })
  }, [])

  const cohortCounts = useMemo(() => ({
    current: cohorts.filter((cohort) => cohort.status === 'active' || cohort.status === 'upcoming').length,
    inactive: cohorts.filter((cohort) => cohort.status === 'completed' || cohort.status === 'archived').length,
    all: cohorts.length,
  }), [cohorts])

  const visibleCohorts = useMemo(() => {
    const filtered = cohorts.filter((cohort) => {
      if (statusFilter === 'all') return true
      if (statusFilter === 'current') return cohort.status === 'active' || cohort.status === 'upcoming'
      return cohort.status === 'completed' || cohort.status === 'archived'
    })

    return [...filtered].sort((a, b) => {
      const statusOrder: Record<string, number> = { active: 0, upcoming: 1, completed: 2, archived: 3 }
      const statusDelta = (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99)
      if (statusDelta !== 0) return statusDelta
      return new Date(b.start_date).getTime() - new Date(a.start_date).getTime()
    })
  }, [cohorts, statusFilter])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name || !form.curriculum_id || !form.start_date) return

    setCreating(true)
    setError(null)

    const res = await api.createCohort({
      name: form.name,
      cohort_type: form.cohort_type,
      curriculum_id: form.curriculum_id as number,
      start_date: form.start_date,
      end_date: form.end_date || undefined,
      status: 'active',
    })

    if (res.data) {
      toast.success(`Created cohort "${form.name}"`)
      await refreshCohorts()
      navigate(`/admin/cohorts/${res.data.cohort.id}`)
    } else {
      const message = res.error || 'Failed to create cohort'
      setError(message)
      toast.error(message)
      setCreating(false)
    }
  }

  if (loading) return <LoadingSpinner message="Loading cohorts..." />

  return (
    <div className="app-page-wide">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="app-eyebrow">Program operations</p>
          <h1 className="app-title mt-2">Cohorts</h1>
          <p className="app-description mt-2">{user?.is_admin ? 'Create, organize, and reopen the workspace for every class.' : 'Open the cohorts you teach and see what needs attention.'}</p>
        </div>
        {user?.is_admin && <Button variant={showCreate ? 'secondary' : 'primary'} onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4" />
          New cohort
        </Button>}
      </header>

      {showCreate && user?.is_admin && (
        <form onSubmit={handleCreate} className="app-surface p-6 space-y-4">
          <h2 className="text-lg font-bold text-ink">Create new cohort</h2>

          {error && (
            <div role="alert" className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">{error}</div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor={`${formId}-name`} className="block text-sm font-semibold text-ink-secondary mb-1">Cohort name *</label>
              <input
                id={`${formId}-name`}
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g., Cohort 4"
                className="app-control w-full"
              />
            </div>
            <div>
              <label htmlFor={`${formId}-type`} className="block text-sm font-semibold text-ink-secondary mb-1">Type</label>
              <select
                id={`${formId}-type`}
                value={form.cohort_type}
                onChange={(e) => setForm({ ...form, cohort_type: e.target.value })}
                className="app-control w-full"
              >
                {COHORT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`${formId}-curriculum`} className="block text-sm font-semibold text-ink-secondary mb-1">Curriculum *</label>
              <select
                id={`${formId}-curriculum`}
                required
                value={form.curriculum_id}
                onChange={(e) => setForm({ ...form, curriculum_id: e.target.value ? Number(e.target.value) : '' })}
                className="app-control w-full"
              >
                <option value="">Select a curriculum...</option>
                {curricula.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`${formId}-start`} className="block text-sm font-semibold text-ink-secondary mb-1">Start date *</label>
              <input
                id={`${formId}-start`}
                type="date"
                required
                value={form.start_date}
                onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                className="app-control w-full"
              />
            </div>
            <div>
              <label htmlFor={`${formId}-end`} className="block text-sm font-semibold text-ink-secondary mb-1">End date</label>
              <input
                id={`${formId}-end`}
                type="date"
                value={form.end_date}
                onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                className="app-control w-full"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Button type="submit" disabled={creating}>
              {creating ? 'Creating...' : 'Create cohort'}
            </Button>
            <Button
              variant="quiet"
              onClick={() => { setShowCreate(false); setError(null) }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {cohorts.length === 0 && !showCreate ? (
        <EmptyState
          icon={Layers3}
          title="No cohorts yet"
          description="Create your first cohort to start enrolling students."
        />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter cohorts by status">
            {([
              { key: 'current', label: 'Current', count: cohortCounts.current },
              { key: 'inactive', label: 'Inactive', count: cohortCounts.inactive },
              { key: 'all', label: 'All', count: cohortCounts.all },
            ] as const).map((filter) => (
              <FilterChip
                key={filter.key}
                selected={statusFilter === filter.key}
                count={filter.count}
                onClick={() => setStatusFilter(filter.key)}
              >
                {filter.label}
              </FilterChip>
            ))}
          </div>

          {visibleCohorts.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line bg-surface-raised px-5 py-8 text-center text-sm text-ink-muted">
              {statusFilter === 'current'
                ? 'No active or upcoming cohorts right now. Completed and archived cohorts are still available under Inactive.'
                : statusFilter === 'inactive'
                  ? 'No completed or archived cohorts yet.'
                  : 'No cohorts match this filter.'}
            </div>
          ) : (
            <div className="space-y-3">
              {visibleCohorts.map((cohort) => (
            <Link
              key={cohort.id}
              to={`/admin/cohorts/${cohort.id}`}
              className="pressable flex min-h-11 items-center justify-between gap-3 rounded-2xl border border-line bg-surface-raised p-5 shadow-raised hover:border-line-strong hover:bg-surface-sunken"
            >
              <div className="flex-1 min-w-0">
                <div className="flex min-w-0 items-center gap-3 mb-1">
                  <h3 className="min-w-0 truncate text-base font-semibold text-ink" title={cohort.name}>{cohort.name}</h3>
                  <CohortStatusBadge status={cohort.status} />
                </div>
                <p className="truncate text-sm text-ink-muted" title={cohort.curriculum_name}>{cohort.curriculum_name}</p>
                <p className="mt-1 text-xs font-semibold text-ink-secondary">Open for access and invitation status</p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-ink-muted">
                  <span className="inline-flex items-center gap-1 tabular-nums">
                    <Calendar className="h-3.5 w-3.5" />
                    {formatShortDate(cohort.start_date)}
                    {cohort.end_date && ` – ${formatShortDate(cohort.end_date)}`}
                  </span>
                  <span className="inline-flex items-center gap-1 tabular-nums">
                    <Users className="h-3.5 w-3.5" />
                    {cohort.enrolled_count} enrolled
                  </span>
                </div>
              </div>
              <ChevronRight className="h-5 w-5 text-ink-muted shrink-0" />
            </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
