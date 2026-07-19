import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, AlertTriangle, ArrowRight, ClipboardCheck, FileText, Layers3, Users } from 'lucide-react'
import { api } from '../../lib/api'
import { ProgressBar } from '../../components/shared/ProgressBar'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { PageHeader } from '../../components/ui/PageHeader'

interface AdminDashboardData {
  user: { full_name?: string; role?: string }
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

function isInactive(date: string | null) {
  if (!date) return true
  return Date.now() - new Date(date).getTime() > 14 * 24 * 60 * 60 * 1000
}

function formatLastSeen(date: string | null) {
  if (!date) return 'Never signed in'
  return `Last seen ${new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
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

  const studentsNeedingAttention = useMemo(
    () => (data?.students || [])
      .filter((student) => student.enrollment_status === 'active' && (isInactive(student.last_sign_in_at) || student.progress_percentage < 35))
      .sort((a, b) => a.progress_percentage - b.progress_percentage)
      .slice(0, 5),
    [data?.students],
  )

  if (loading) return <LoadingSpinner message="Loading admin dashboard..." />
  if (!data) return null

  const firstName = data.user?.full_name?.split(' ')[0]

  return (
    <div className="app-page-wide">
      <PageHeader
        eyebrow="Staff workspace"
        title={firstName ? `Good to see you, ${firstName}` : 'Staff home'}
        description="The work that needs attention across your active cohort, all in one place."
        meta={data.cohort && <><span className="rounded-full bg-primary-50 px-2.5 py-1 font-bold text-primary-700">{data.cohort.name}</span><span className="capitalize">{data.cohort.status}</span></>}
        actions={data.cohort && (
          <Link to={`/admin/cohorts/${data.cohort.id}`} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-50">
            Open cohort workspace
            <ArrowRight className="h-4 w-4" />
          </Link>
        )}
      />

      <section aria-labelledby="attention-heading" className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
        <div className="overflow-hidden rounded-[1.75rem] bg-slate-950 p-5 text-white shadow-[0_20px_50px_rgba(15,23,42,0.13)] sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-primary-300">Priority queue</p>
              <h2 id="attention-heading" className="mt-2 text-2xl font-extrabold tracking-tight">Start with what needs action.</h2>
            </div>
            <Activity className="h-6 w-6 text-primary-400" />
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <Link to="/admin/grading" className="group rounded-2xl border border-white/10 bg-white/[0.07] p-4 transition hover:-translate-y-0.5 hover:border-primary-400/50 hover:bg-white/[0.11]">
              <div className="flex items-center justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-500/20 text-primary-300"><ClipboardCheck className="h-5 w-5" /></span>
                <ArrowRight className="h-4 w-4 text-white/35 transition group-hover:translate-x-1 group-hover:text-white" />
              </div>
              <p className="mt-5 text-3xl font-extrabold tabular-nums">{data.ungraded_count || 0}</p>
              <p className="mt-1 text-sm font-bold text-slate-300">Submissions waiting for review</p>
            </Link>
            <Link to="/admin/students" className="group rounded-2xl border border-white/10 bg-white/[0.07] p-4 transition hover:-translate-y-0.5 hover:border-amber-400/50 hover:bg-white/[0.11]">
              <div className="flex items-center justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-400/15 text-amber-300"><AlertTriangle className="h-5 w-5" /></span>
                <ArrowRight className="h-4 w-4 text-white/35 transition group-hover:translate-x-1 group-hover:text-white" />
              </div>
              <p className="mt-5 text-3xl font-extrabold tabular-nums">{studentsNeedingAttention.length}</p>
              <p className="mt-1 text-sm font-bold text-slate-300">Students to check in with</p>
            </Link>
          </div>
        </div>

        <div className="app-surface p-5 sm:p-6">
          <p className="app-eyebrow">Cohort pulse</p>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div>
              <p className="text-3xl font-extrabold tracking-tight text-slate-950">{data.cohort?.enrolled_count || 0}</p>
              <p className="mt-1 text-xs font-semibold text-slate-500">Enrolled</p>
            </div>
            <div>
              <p className="text-3xl font-extrabold tracking-tight text-slate-950">{data.cohort?.active_count || 0}</p>
              <p className="mt-1 text-xs font-semibold text-slate-500">Active</p>
            </div>
          </div>
          <div className="mt-6 border-t border-slate-200 pt-5">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Current cohort</p>
            <p className="mt-1 text-sm font-extrabold text-slate-950">{data.cohort?.name || 'No active cohort'}</p>
            {data.cohort?.start_date && <p className="mt-1 text-xs text-slate-500">Started {new Date(data.cohort.start_date).toLocaleDateString()}</p>}
          </div>
        </div>
      </section>

      <section aria-labelledby="shortcuts-heading">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="app-eyebrow">Common work</p>
            <h2 id="shortcuts-heading" className="mt-1 text-lg font-extrabold tracking-tight text-slate-950">Jump back in</h2>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ['/admin/students', Users, 'Students', 'Progress, access, and intervention'],
            ['/admin/grading', ClipboardCheck, 'Grading', 'Review submissions and redos'],
            ['/admin/content', FileText, 'Curriculum', 'Modules, lessons, and exercises'],
            [data.cohort ? `/admin/cohorts/${data.cohort.id}` : '/admin/cohorts', Layers3, 'Cohort setup', 'Schedule, resources, and access'],
          ].map(([to, Icon, title, description]) => {
            const ItemIcon = Icon as typeof Users
            return (
              <Link key={to as string} to={to as string} className="group app-surface flex items-start gap-3 p-4 transition duration-200 hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-lg hover:shadow-slate-900/5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 transition-colors group-hover:bg-primary-50 group-hover:text-primary-700"><ItemIcon className="h-5 w-5" /></span>
                <span className="min-w-0 flex-1"><span className="block text-sm font-extrabold text-slate-950">{title as string}</span><span className="mt-0.5 block text-xs leading-5 text-slate-500">{description as string}</span></span>
                <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-primary-600" />
              </Link>
            )
          })}
        </div>
      </section>

      {studentsNeedingAttention.length > 0 && (
        <section aria-labelledby="student-attention-heading" className="app-surface overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200/80 px-5 py-4 sm:px-6">
            <div>
              <h2 id="student-attention-heading" className="text-lg font-extrabold tracking-tight text-slate-950">Students to check in with</h2>
              <p className="mt-0.5 text-sm text-slate-500">Low progress or no recent sign-in</p>
            </div>
            <Link to="/admin/students" className="app-link text-sm">View everyone</Link>
          </div>
          <div className="divide-y divide-slate-100">
            {studentsNeedingAttention.map((student) => (
              <Link key={student.user_id} to={`/admin/students/${student.user_id}`} className="group grid gap-3 px-5 py-4 transition hover:bg-slate-50 sm:grid-cols-[minmax(220px,1fr)_minmax(180px,0.7fr)_auto] sm:items-center sm:px-6">
                <div className="min-w-0">
                  <p className="truncate text-sm font-extrabold text-slate-950">{student.full_name}</p>
                  <p className="truncate text-xs text-slate-500">{student.email}</p>
                </div>
                <div className="max-w-xs">
                  <ProgressBar value={student.progress_percentage} size="sm" showPercentage />
                </div>
                <div className="flex items-center justify-between gap-3 sm:justify-end">
                  <span className={`text-xs font-bold ${isInactive(student.last_sign_in_at) ? 'text-amber-700' : 'text-slate-500'}`}>{formatLastSeen(student.last_sign_in_at)}</span>
                  <ArrowRight className="h-4 w-4 text-slate-300 transition group-hover:translate-x-1 group-hover:text-primary-600" />
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {data.students && data.students.length > 0 && studentsNeedingAttention.length === 0 && (
        <div className="app-surface flex items-center gap-4 p-5">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-green-100 text-green-700"><Activity className="h-5 w-5" /></span>
          <div><p className="text-sm font-extrabold text-slate-950">Your active cohort looks steady.</p><p className="mt-0.5 text-xs text-slate-500">No students meet the current attention thresholds.</p></div>
        </div>
      )}
    </div>
  )
}
