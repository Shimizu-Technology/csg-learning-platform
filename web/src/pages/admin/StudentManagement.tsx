import { useEffect, useState } from 'react'
import { Users, Search, ArrowLeft } from 'lucide-react'
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
  enrollment_status: string
}

export function StudentManagement() {
  const [students, setStudents] = useState<Student[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    api.getDashboard().then((res) => {
      if (res.data?.dashboard?.students) {
        setStudents(res.data.dashboard.students)
      }
      setLoading(false)
    })
  }, [])

  const filtered = students.filter(
    (s) =>
      s.full_name.toLowerCase().includes(search.toLowerCase()) ||
      s.email.toLowerCase().includes(search.toLowerCase()) ||
      (s.github_username && s.github_username.toLowerCase().includes(search.toLowerCase()))
  )

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
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase hidden md:table-cell">GitHub</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Progress</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase hidden sm:table-cell">Last Active</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase hidden sm:table-cell">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filtered.map((student) => (
                  <tr key={student.user_id} className="hover:bg-slate-50">
                    <td className="px-6 py-4">
                      <p className="text-sm font-medium text-slate-900">{student.full_name}</p>
                      <p className="text-xs text-slate-500">{student.email}</p>
                    </td>
                    <td className="px-6 py-4 hidden md:table-cell">
                      {student.github_username ? (
                        <a
                          href={`https://github.com/${student.github_username}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-primary-600 hover:underline"
                        >
                          @{student.github_username}
                        </a>
                      ) : (
                        <span className="text-sm text-slate-400">Not set</span>
                      )}
                    </td>
                    <td className="px-6 py-4 w-44">
                      <ProgressBar value={student.progress_percentage} size="sm" />
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
