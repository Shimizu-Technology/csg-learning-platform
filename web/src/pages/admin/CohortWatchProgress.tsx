import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Film, CheckCircle2, Eye } from 'lucide-react'
import { api } from '../../lib/api'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { EmptyState } from '../../components/shared/EmptyState'

interface RecordingInfo {
  id: number
  title: string
  duration_seconds: number | null
}

interface StudentProgress {
  user_id: number
  full_name: string
  recordings: {
    recording_id: number
    progress_percentage: number
    completed: boolean
    total_watched_seconds: number
  }[]
}

export function CohortWatchProgress() {
  const { id } = useParams()
  const [recordings, setRecordings] = useState<RecordingInfo[]>([])
  const [students, setStudents] = useState<StudentProgress[]>([])
  const [loading, setLoading] = useState(true)
  const [cohortName, setCohortName] = useState('')

  useEffect(() => {
    if (!id) return
    Promise.all([
      api.getCohortWatchProgress(Number(id)),
      api.getCohort(Number(id)),
    ]).then(([progressRes, cohortRes]) => {
      if (progressRes.data) {
        setRecordings(progressRes.data.recordings || [])
        setStudents(progressRes.data.students || [])
      }
      if (cohortRes.data?.cohort) {
        setCohortName(cohortRes.data.cohort.name)
      }
      setLoading(false)
    })
  }, [id])

  if (loading) return <LoadingSpinner message="Loading watch progress..." />

  if (recordings.length === 0) {
    return (
      <div className="max-w-6xl mx-auto space-y-4">
        <Link to={`/admin/cohorts/${id}`} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" />
          Back to {cohortName || 'Cohort'}
        </Link>
        <EmptyState icon={Film} title="No recordings uploaded" description="Upload recordings to this cohort first to track student watch progress." />
      </div>
    )
  }

  const getProgressColor = (pct: number, completed: boolean) => {
    if (completed) return 'bg-green-500 text-white'
    if (pct >= 50) return 'bg-amber-100 text-amber-700'
    if (pct > 0) return 'bg-slate-100 text-slate-600'
    return 'bg-slate-50 text-slate-400'
  }

  return (
    <div className="max-w-full mx-auto space-y-5">
      <div>
        <Link to={`/admin/cohorts/${id}`} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-2">
          <ArrowLeft className="h-4 w-4" />
          Back to {cohortName || 'Cohort'}
        </Link>
        <div className="flex items-center gap-3">
          <Eye className="h-6 w-6 text-primary-500" />
          <div>
            <h1 className="text-xl font-bold text-slate-900">Watch Progress</h1>
            <p className="text-sm text-slate-500">{cohortName} · {recordings.length} recording{recordings.length !== 1 ? 's' : ''} · {students.length} student{students.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
      </div>

      {/* Grid */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/50">
                <th className="text-left px-4 py-3 font-medium text-slate-700 sticky left-0 bg-slate-50/50 z-10 min-w-[160px]">Student</th>
                {recordings.map((rec) => (
                  <th key={rec.id} className="text-center px-2 py-3 font-medium text-slate-700 min-w-[80px]">
                    <div className="text-xs leading-tight truncate max-w-[100px] mx-auto" title={rec.title}>
                      {rec.title}
                    </div>
                  </th>
                ))}
                <th className="text-center px-4 py-3 font-medium text-slate-700 min-w-[80px]">Overall</th>
              </tr>
            </thead>
            <tbody>
              {students.map((student) => {
                const completedCount = student.recordings.filter(r => r.completed).length
                const overallPct = recordings.length > 0 ? Math.round((completedCount / recordings.length) * 100) : 0
                return (
                  <tr key={student.user_id} className="border-b border-slate-100 hover:bg-slate-50/50">
                    <td className="px-4 py-2.5 font-medium text-slate-900 sticky left-0 bg-white z-10">
                      {student.full_name}
                    </td>
                    {recordings.map((rec) => {
                      const rp = student.recordings.find(r => r.recording_id === rec.id)
                      const pct = rp?.progress_percentage || 0
                      const completed = rp?.completed || false
                      return (
                        <td key={rec.id} className="text-center px-2 py-2.5">
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${getProgressColor(pct, completed)}`}>
                            {completed ? (
                              <><CheckCircle2 className="h-3 w-3" />Done</>
                            ) : pct > 0 ? (
                              `${Math.round(pct)}%`
                            ) : (
                              '—'
                            )}
                          </span>
                        </td>
                      )
                    })}
                    <td className="text-center px-4 py-2.5">
                      <div className="flex items-center gap-2 justify-center">
                        <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-green-500 rounded-full" style={{ width: `${overallPct}%` }} />
                        </div>
                        <span className="text-xs text-slate-600 tabular-nums">{completedCount}/{recordings.length}</span>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
