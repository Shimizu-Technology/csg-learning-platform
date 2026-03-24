import { useEffect, useState } from 'react'
import { Users, Search, ArrowLeft, AlertTriangle, Activity, CheckCircle2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api'
import { ProgressBar } from '../../components/shared/ProgressBar'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { EmptyState } from '../../components/shared/EmptyState'

interface Student {
  user_id: number
  full_name: string
  email: string
  github_username: string | null
  progress_percentage: number
  completed_blocks: number
  total_blocks: number
  last_sign_in_at: string | null
  last_activity_at: string | null
  blocks_this_week: number
  submissions_this_week: number
  enrollment_status: string
}

type ActivityStatus = 'active' | 'quiet' | 'at-risk' | 'new'

function getActivityStatus(student: Student): ActivityStatus {
  const hasAnyActivity = student.last_activity_at != null
  if (!hasAnyActivity) return 'new'

  const daysSinceActivity = student.last_activity_at
    ? (Date.now() - new Date(student.last_activity_at).getTime()) / (1000 * 60 * 60 * 24)
    : Infinity

  if (student.blocks_this_week > 0 || student.submissions_this_week > 0) return 'active'
  if (daysSinceActivity <= 7) return 'quiet'
  return 'at-risk'
}

function ActivityBadge({ status }: { status: ActivityStatus }) {
  const config = {
    active: { label: 'Active', icon: Activity, className: 'bg-success-100 text-success-700' },
    quiet: { label: 'Quiet', icon: AlertTriangle, className: 'bg-amber-100 text-amber-700' },
    'at-risk': { label: 'At Risk', icon: AlertTriangle, className: 'bg-red-100 text-red-700' },
    new: { label: 'Not Started', icon: CheckCircle2, className: 'bg-slate-100 text-slate-600' },
  }
  const { label, icon: Icon, className } = config[status]
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full ${className}`}>
      <Icon className="h-3 w-3" />
      {label}
    </span>
  )
}

function formatLastActivity(dateStr: string | null): string {
  if (!dateStr) return 'Never'
  const date = new Date(dateStr)
  const now = Date.now()
  const diffMs = now - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  if (diffHours < 1) return 'Just now'
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

export function StudentManagement() {
  const [students, setStudents] = useState<Student[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | ActivityStatus>('all')

  useEffect(() => {
    api.getDashboard().then((res) => {
      if (res.data?.dashboard?.students) {
        setStudents(res.data.dashboard.students)
      }
      setLoading(false)
    })
  }, [])

  const withStatus = students.map((s) => ({ ...s, activityStatus: getActivityStatus(s) }))

  const atRiskCount = withStatus.filter((s) => s.activityStatus === 'at-risk').length
  const quietCount = withStatus.filter((s) => s.activityStatus === 'quiet').length
  const activeCount = withStatus.filter((s) => s.activityStatus === 'active').length

  const filtered = withStatus.filter((s) => {
    const matchesSearch =
      s.full_name.toLowerCase().includes(search.toLowerCase()) ||
      s.email.toLowerCase().includes(search.toLowerCase()) ||
      (s.github_username && s.github_username.toLowerCase().includes(search.toLowerCase()))
    const matchesFilter = filter === 'all' || s.activityStatus === filter
    return matchesSearch && matchesFilter
  })

  if (loading) return <LoadingSpinner message="Loading students..." />

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link to="/admin" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-2">
            <ArrowLeft className="h-4 w-4" />
            Admin Dashboard
          </Link>
          <h1 className="text-2xl font-bold text-slate-900">Student Management</h1>
        </div>
      </div>

      {/* Retention Alert Banner */}
      {atRiskCount > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0" />
          <p className="text-sm text-red-700">
            <span className="font-semibold">{atRiskCount} student{atRiskCount > 1 ? 's' : ''} at risk</span>
            {' '}— no activity in 7+ days. Check in now.
          </p>
        </div>
      )}

      {/* Activity summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <button
          onClick={() => setFilter(filter === 'active' ? 'all' : 'active')}
          className={`rounded-xl border p-3 text-left transition-all ${filter === 'active' ? 'border-success-400 bg-success-50' : 'border-slate-200 bg-white hover:border-success-300'}`}
        >
          <p className="text-xl font-bold text-success-700">{activeCount}</p>
          <p className="text-xs text-slate-500">Active this week</p>
        </button>
        <button
          onClick={() => setFilter(filter === 'quiet' ? 'all' : 'quiet')}
          className={`rounded-xl border p-3 text-left transition-all ${filter === 'quiet' ? 'border-amber-400 bg-amber-50' : 'border-slate-200 bg-white hover:border-amber-300'}`}
        >
          <p className="text-xl font-bold text-amber-700">{quietCount}</p>
          <p className="text-xs text-slate-500">Quiet (2-7 days)</p>
        </button>
        <button
          onClick={() => setFilter(filter === 'at-risk' ? 'all' : 'at-risk')}
          className={`rounded-xl border p-3 text-left transition-all ${filter === 'at-risk' ? 'border-red-400 bg-red-50' : 'border-slate-200 bg-white hover:border-red-300'}`}
        >
          <p className="text-xl font-bold text-red-700">{atRiskCount}</p>
          <p className="text-xs text-slate-500">At risk (7+ days)</p>
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search students..."
          className="w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Users} title="No students found" description="No students match your search." />
      ) : (
        <div className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Student</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Progress</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase hidden sm:table-cell">This Week</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase hidden sm:table-cell">Last Active</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filtered.map((student) => (
                  <tr
                    key={student.user_id}
                    className={`hover:bg-slate-50 ${student.activityStatus === 'at-risk' ? 'bg-red-50/30' : ''}`}
                  >
                    <td className="px-6 py-4">
                      <p className="text-sm font-medium text-slate-900">{student.full_name}</p>
                      <p className="text-xs text-slate-500">{student.email}</p>
                      {student.github_username && (
                        <a
                          href={`https://github.com/${student.github_username}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary-600 hover:underline"
                        >
                          @{student.github_username}
                        </a>
                      )}
                    </td>
                    <td className="px-6 py-4 w-44">
                      <ProgressBar value={student.progress_percentage} size="sm" />
                      <p className="text-xs text-slate-400 mt-1">
                        {student.completed_blocks}/{student.total_blocks} blocks
                      </p>
                    </td>
                    <td className="px-6 py-4 hidden sm:table-cell">
                      <div className="text-sm">
                        <span className={`font-semibold ${student.blocks_this_week > 0 ? 'text-success-600' : 'text-slate-400'}`}>
                          {student.blocks_this_week}
                        </span>
                        <span className="text-slate-400 text-xs"> blocks</span>
                      </div>
                      {student.submissions_this_week > 0 && (
                        <p className="text-xs text-blue-500">{student.submissions_this_week} submission{student.submissions_this_week > 1 ? 's' : ''}</p>
                      )}
                    </td>
                    <td className="px-6 py-4 hidden sm:table-cell">
                      <span className="text-sm text-slate-500">
                        {formatLastActivity(student.last_activity_at)}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <ActivityBadge status={student.activityStatus} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
