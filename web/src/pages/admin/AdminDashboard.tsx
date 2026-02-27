import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Users, FileText, ClipboardCheck, ArrowRight } from 'lucide-react'
import { api } from '../../lib/api'
import { ProgressBar } from '../../components/shared/ProgressBar'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'

interface AdminDashboardData {
  user: any
  cohort?: {
    id: number
    name: string
    start_date: string
    status: string
    enrolled_count: number
    active_count: number
  }
  students?: Array<{
    user_id: number
    full_name: string
    email: string
    github_username: string | null
    progress_percentage: number
    completed_blocks: number
    total_blocks: number
    last_sign_in_at: string | null
    enrollment_status: string
  }>
  ungraded_count?: number
}

export function AdminDashboard() {
  const [data, setData] = useState<AdminDashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getDashboard().then((res) => {
      if (res.data) setData(res.data.dashboard)
      setLoading(false)
    })
  }, [])

  if (loading) return <LoadingSpinner message="Loading admin dashboard..." />
  if (!data) return null

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Admin Dashboard</h1>

      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-2xl bg-white border border-slate-200 p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-blue-100 p-2.5">
              <Users className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{data.cohort?.enrolled_count || 0}</p>
              <p className="text-sm text-slate-500">Enrolled Students</p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl bg-white border border-slate-200 p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-success-100 p-2.5">
              <Users className="h-5 w-5 text-success-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{data.cohort?.active_count || 0}</p>
              <p className="text-sm text-slate-500">Active Students</p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl bg-white border border-slate-200 p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-amber-100 p-2.5">
              <ClipboardCheck className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{data.ungraded_count || 0}</p>
              <p className="text-sm text-slate-500">Ungraded Submissions</p>
            </div>
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Link
          to="/admin/students"
          className="flex items-center justify-between rounded-2xl bg-white border border-slate-200 p-4 hover:border-primary-200 hover:shadow-sm transition-all"
        >
          <div className="flex items-center gap-3">
            <Users className="h-5 w-5 text-slate-400" />
            <span className="text-sm font-medium text-slate-700">Manage Students</span>
          </div>
          <ArrowRight className="h-4 w-4 text-slate-400" />
        </Link>
        <Link
          to="/admin/content"
          className="flex items-center justify-between rounded-2xl bg-white border border-slate-200 p-4 hover:border-primary-200 hover:shadow-sm transition-all"
        >
          <div className="flex items-center gap-3">
            <FileText className="h-5 w-5 text-slate-400" />
            <span className="text-sm font-medium text-slate-700">Manage Content</span>
          </div>
          <ArrowRight className="h-4 w-4 text-slate-400" />
        </Link>
        <Link
          to="/admin/grading"
          className="flex items-center justify-between rounded-2xl bg-white border border-slate-200 p-4 hover:border-primary-200 hover:shadow-sm transition-all"
        >
          <div className="flex items-center gap-3">
            <ClipboardCheck className="h-5 w-5 text-slate-400" />
            <span className="text-sm font-medium text-slate-700">Grade Submissions</span>
          </div>
          <ArrowRight className="h-4 w-4 text-slate-400" />
        </Link>
      </div>

      {/* Student progress table */}
      {data.students && data.students.length > 0 && (
        <div className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200">
            <h2 className="text-lg font-semibold text-slate-900">Student Progress</h2>
            <p className="text-sm text-slate-500">{data.cohort?.name}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Student</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Progress</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase hidden sm:table-cell">Last Active</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase hidden sm:table-cell">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {data.students.map((student) => (
                  <tr key={student.user_id} className="hover:bg-slate-50">
                    <td className="px-6 py-4">
                      <p className="text-sm font-medium text-slate-900">{student.full_name}</p>
                      <p className="text-xs text-slate-500">{student.email}</p>
                    </td>
                    <td className="px-6 py-4 w-48">
                      <ProgressBar
                        value={student.progress_percentage}
                        size="sm"
                        showPercentage={true}
                      />
                    </td>
                    <td className="px-6 py-4 hidden sm:table-cell">
                      <span className="text-sm text-slate-500">
                        {student.last_sign_in_at
                          ? new Date(student.last_sign_in_at).toLocaleDateString()
                          : 'Never'}
                      </span>
                    </td>
                    <td className="px-6 py-4 hidden sm:table-cell">
                      <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                        student.enrollment_status === 'active' ? 'bg-success-100 text-success-700' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {student.enrollment_status}
                      </span>
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
