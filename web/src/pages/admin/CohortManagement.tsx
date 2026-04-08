import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Layers3, Plus, Users, Calendar, ChevronRight } from 'lucide-react'
import { api } from '../../lib/api'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { EmptyState } from '../../components/shared/EmptyState'
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
  { value: 'self_paced', label: 'Self-Paced' },
]

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: 'bg-success-100 text-success-700',
    upcoming: 'bg-blue-100 text-blue-700',
    completed: 'bg-slate-100 text-slate-600',
    archived: 'bg-slate-100 text-slate-500',
  }
  return (
    <span className={`inline-flex text-xs font-medium px-2 py-1 rounded-full ${styles[status] || 'bg-slate-100 text-slate-600'}`}>
      {status}
    </span>
  )
}

export function CohortManagement() {
  const navigate = useNavigate()
  const [cohorts, setCohorts] = useState<CohortSummary[]>([])
  const [curricula, setCurricula] = useState<CurriculumSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
      navigate(`/admin/cohorts/${res.data.cohort.id}`)
    } else {
      setError(res.error || 'Failed to create cohort')
      setCreating(false)
    }
  }

  if (loading) return <LoadingSpinner message="Loading cohorts..." />

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Cohorts</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          New Cohort
        </button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="rounded-2xl bg-white border border-slate-200 p-6 space-y-4">
          <h2 className="text-lg font-semibold text-slate-900">Create New Cohort</h2>

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Cohort Name *</label>
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g., Cohort 4"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Type</label>
              <select
                value={form.cohort_type}
                onChange={(e) => setForm({ ...form, cohort_type: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              >
                {COHORT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Curriculum *</label>
              <select
                required
                value={form.curriculum_id}
                onChange={(e) => setForm({ ...form, curriculum_id: e.target.value ? Number(e.target.value) : '' })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              >
                <option value="">Select a curriculum...</option>
                {curricula.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Start Date *</label>
              <input
                type="date"
                required
                value={form.start_date}
                onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">End Date</label>
              <input
                type="date"
                value={form.end_date}
                onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={creating}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50 transition-colors"
            >
              {creating ? 'Creating...' : 'Create Cohort'}
            </button>
            <button
              type="button"
              onClick={() => { setShowCreate(false); setError(null) }}
              className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors"
            >
              Cancel
            </button>
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
        <div className="space-y-3">
          {cohorts.map((cohort) => (
            <Link
              key={cohort.id}
              to={`/admin/cohorts/${cohort.id}`}
              className="flex items-center justify-between rounded-2xl bg-white border border-slate-200 p-5 hover:border-primary-200 hover:shadow-sm transition-all"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-1">
                  <h3 className="text-base font-semibold text-slate-900">{cohort.name}</h3>
                  <StatusBadge status={cohort.status} />
                </div>
                <p className="text-sm text-slate-500">{cohort.curriculum_name}</p>
                <div className="flex items-center gap-4 mt-2 text-xs text-slate-400">
                  <span className="inline-flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5" />
                    {new Date(cohort.start_date).toLocaleDateString()}
                    {cohort.end_date && ` – ${new Date(cohort.end_date).toLocaleDateString()}`}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Users className="h-3.5 w-3.5" />
                    {cohort.enrolled_count} enrolled
                  </span>
                </div>
              </div>
              <ChevronRight className="h-5 w-5 text-slate-300 shrink-0" />
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
