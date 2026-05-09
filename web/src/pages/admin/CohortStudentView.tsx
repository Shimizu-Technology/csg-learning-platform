import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Eye } from 'lucide-react'
import { api } from '../../lib/api'
import type { CohortStudentView as CohortStudentViewData } from '../../types/api'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { EmptyState } from '../../components/shared/EmptyState'
import { Dashboard, type DashboardData } from '../student/Dashboard'

function formatDate(dateStr?: string | null) {
  if (!dateStr) return 'Not scheduled'

  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return 'Not scheduled'

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function CohortStudentView() {
  const { id } = useParams<{ id: string }>()
  const [data, setData] = useState<CohortStudentViewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return

    setLoading(true)
    api.getCohortStudentView(Number(id)).then((res) => {
      if (res.data?.student_view) {
        setData(res.data.student_view)
        setError(null)
      } else {
        setError(res.error || 'Unable to load this cohort student view.')
      }
      setLoading(false)
    })
  }, [id])

  if (loading) return <LoadingSpinner message="Loading cohort student view..." />

  if (error || !data) {
    return (
      <EmptyState
        icon={Eye}
        title="Could not load student view"
        description={error || 'The cohort student view is unavailable right now.'}
      />
    )
  }

  const previewBanner = (
    <div className="rounded-2xl border border-primary-200 bg-primary-50 px-4 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary-700">Read-only cohort student view</p>
          <h1 className="mt-1 text-xl font-bold text-slate-900">{data.cohort.name}</h1>
          <p className="text-sm text-slate-600">
            Generic student dashboard for {data.cohort.curriculum_name} · {data.cohort.active_count} active students · generated {formatDate(data.generated_at)}
          </p>
        </div>
        <Link
          to={`/admin/cohorts/${data.cohort.id}`}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-primary-100 hover:bg-primary-50"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to cohort
        </Link>
      </div>
    </div>
  )

  return (
    <Dashboard
      previewData={data.dashboard as DashboardData}
      previewBanner={previewBanner}
      disableStaffRedirect
    />
  )
}
