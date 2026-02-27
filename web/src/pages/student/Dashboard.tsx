import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, BookOpen, AlertCircle, Clock } from 'lucide-react'
import { api } from '../../lib/api'
import { ProgressRing } from '../../components/shared/ProgressRing'
import { ProgressBar } from '../../components/shared/ProgressBar'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { EmptyState } from '../../components/shared/EmptyState'

interface DashboardData {
  enrolled: boolean
  user: { id: number; full_name: string; role: string }
  cohort?: { id: number; name: string; start_date: string; status: string }
  overall_progress?: { completed: number; total: number; percentage: number }
  modules?: Array<{
    id: number
    name: string
    module_type: string
    progress_percentage: number
    completed_blocks: number
    total_blocks: number
    lessons: Array<{
      id: number
      title: string
      lesson_type: string
      available: boolean
      unlock_date: string
      completed: boolean
      total_blocks: number
      completed_blocks: number
    }>
  }>
  continue_lesson?: { id: number; title: string } | null
  action_items?: Array<{ type: string; submission_id: number; lesson_title: string; content_block_title: string }>
}

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getDashboard().then((res) => {
      if (res.data) setData(res.data.dashboard)
      setLoading(false)
    })
  }, [])

  if (loading) return <LoadingSpinner message="Loading dashboard..." />

  if (!data?.enrolled) {
    return (
      <EmptyState
        icon={BookOpen}
        title="Not enrolled yet"
        description="You haven't been enrolled in a cohort yet. Contact your instructor for access."
      />
    )
  }

  const progress = data.overall_progress

  return (
    <div className="space-y-6">
      {/* Welcome card */}
      <div className="rounded-2xl bg-white border border-slate-200 p-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-slate-900">
              Welcome back, {data.user.full_name.split(' ')[0]}
            </h1>
            <p className="mt-1 text-slate-500">
              {data.cohort?.name} · {progress?.completed || 0} of {progress?.total || 0} blocks completed
            </p>
          </div>
          {progress && (
            <ProgressRing percentage={progress.percentage} size={90} label="Overall" />
          )}
        </div>

        {/* Continue button */}
        {data.continue_lesson && (
          <Link
            to={`/lessons/${data.continue_lesson.id}`}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary-500 px-5 py-2.5 text-sm font-medium text-white hover:bg-primary-600 transition-colors"
          >
            Continue: {data.continue_lesson.title}
            <ArrowRight className="h-4 w-4" />
          </Link>
        )}
      </div>

      {/* Action items */}
      {data.action_items && data.action_items.length > 0 && (
        <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-amber-800">
            <AlertCircle className="h-4 w-4" />
            Action Items
          </h3>
          <ul className="mt-2 space-y-1">
            {data.action_items.map((item, i) => (
              <li key={i} className="text-sm text-amber-700">
                Redo requested: {item.content_block_title}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Modules */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Your Modules</h2>
        {data.modules?.map((mod) => (
          <Link
            key={mod.id}
            to={`/modules/${mod.id}`}
            className="block rounded-2xl bg-white border border-slate-200 p-5 hover:border-primary-200 hover:shadow-sm transition-all"
          >
            <div className="flex items-center gap-4">
              <ProgressRing percentage={mod.progress_percentage} size={64} />
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-slate-900">{mod.name}</h3>
                <p className="text-sm text-slate-500 capitalize">{mod.module_type.replace('_', ' ')}</p>
                <ProgressBar
                  value={mod.completed_blocks}
                  max={mod.total_blocks}
                  showPercentage={false}
                  size="sm"
                />
              </div>
              <div className="text-sm text-slate-500">
                {mod.completed_blocks}/{mod.total_blocks}
              </div>
            </div>

            {/* Today's lessons preview */}
            <div className="mt-3 flex flex-wrap gap-2">
              {mod.lessons
                .filter((l) => l.available && !l.completed)
                .slice(0, 3)
                .map((l) => (
                  <span key={l.id} className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
                    <Clock className="h-3 w-3" />
                    {l.title.length > 30 ? l.title.slice(0, 30) + '...' : l.title}
                  </span>
                ))}
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
