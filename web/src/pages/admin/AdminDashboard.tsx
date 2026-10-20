import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, AlertTriangle, ArrowRight, ClipboardCheck, FileText, Layers3, LifeBuoy, Users } from 'lucide-react'
import { api } from '../../lib/api'
import { useCohortContext } from '../../contexts/CohortContext'
import { cohortStudentPath } from '../../lib/routes'
import { ProgressBar } from '../../components/shared/ProgressBar'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { PageHeader } from '../../components/ui/PageHeader'
import { Badge } from '../../components/ui/Badge'
import { Avatar } from '../../components/ui/Avatar'
import { LinkButton } from '../../components/ui/Button'
import { formatShortDate } from '../../lib/format'
import { UnassignedLearnersWarning } from '../../components/admin/UnassignedLearnersWarning'

interface AdminDashboardData {
  user: { full_name?: string; role?: string }
  cohort?: {
    id: number
    name: string
    start_date: string
    status: string
    enrolled_count: number
    active_count: number
    students_without_modules_count?: number
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
    assigned_module_count?: number
  }>
  ungraded_count?: number
}

function isInactive(date: string | null) {
  if (!date) return true
  return Date.now() - new Date(date).getTime() > 14 * 24 * 60 * 60 * 1000
}

function formatLastSeen(date: string | null) {
  if (!date) return 'Never signed in'
  return `Last seen ${formatShortDate(date, '—', { withYear: false })}`
}

export function AdminDashboard() {
  const { selectedCohortId } = useCohortContext()
  const [data, setData] = useState<AdminDashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    setData(null)
    api.getDashboard(selectedCohortId ?? undefined).then((res) => {
      if (res.data) setData(res.data.dashboard)
      setLoading(false)
    })
  }, [selectedCohortId])

  const allStudentsNeedingAttention = useMemo(
    () => (data?.students || [])
      .filter((student) => student.enrollment_status === 'active' && (isInactive(student.last_sign_in_at) || student.progress_percentage < 35))
      .sort((a, b) => a.progress_percentage - b.progress_percentage),
    [data?.students],
  )
  const studentsNeedingAttention = allStudentsNeedingAttention.slice(0, 5)

  if (loading) return <LoadingSpinner message="Loading admin dashboard..." />
  if (!data) return null

  const firstName = data.user?.full_name?.split(' ')[0]

  return (
    <div className="app-page-wide">
      <PageHeader
        eyebrow="Staff workspace"
        title={firstName ? `Good to see you, ${firstName}` : 'Staff home'}
        description="The work that needs attention across your active cohort, all in one place."
        meta={data.cohort && <><Badge>{data.cohort.name}</Badge><span className="capitalize">{data.cohort.status}</span></>}
        actions={data.cohort && (
          <LinkButton to={`/admin/cohorts/${data.cohort.id}`} variant="secondary">
            Open cohort workspace
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </LinkButton>
        )}
      />

      {data.cohort && <UnassignedLearnersWarning cohortId={data.cohort.id} count={data.cohort.students_without_modules_count || 0} learners={(data.students || []).filter((student) => student.enrollment_status === 'active' && student.assigned_module_count === 0)} />}

      <section aria-labelledby="attention-heading" className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
        <div className="app-surface p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold text-ink-muted">Priority queue</p>
              <h2 id="attention-heading" className="mt-1 text-lg font-bold text-ink">Start with what needs action.</h2>
            </div>
            <Activity className="h-5 w-5 shrink-0 text-ink-muted" aria-hidden="true" />
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <Link to="/admin/grading" className="group pressable flex min-h-11 flex-col rounded-2xl border border-line bg-surface-raised p-4 hover:border-line-strong hover:bg-surface-sunken">
              <div className="flex items-center justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-sunken text-ink-secondary"><ClipboardCheck className="h-5 w-5" aria-hidden="true" /></span>
                <ArrowRight className="h-4 w-4 text-ink-muted transition-colors duration-150 group-hover:text-ink" aria-hidden="true" />
              </div>
              <p className="mt-4 text-3xl font-bold tabular-nums text-ink">{data.ungraded_count || 0}</p>
              <p className="mt-1 text-sm font-semibold text-ink-secondary">Submissions waiting for review</p>
            </Link>
            <Link to="/admin/students" className="group pressable flex min-h-11 flex-col rounded-2xl border border-line bg-surface-raised p-4 hover:border-line-strong hover:bg-surface-sunken">
              <div className="flex items-center justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-sunken text-ink-secondary"><AlertTriangle className="h-5 w-5" aria-hidden="true" /></span>
                <ArrowRight className="h-4 w-4 text-ink-muted transition-colors duration-150 group-hover:text-ink" aria-hidden="true" />
              </div>
              <p className="mt-4 text-3xl font-bold tabular-nums text-ink">{allStudentsNeedingAttention.length}</p>
              <p className="mt-1 text-sm font-semibold text-ink-secondary">Students to check in with</p>
            </Link>
          </div>
        </div>

        <div className="app-surface p-5 sm:p-6">
          <p className="text-xs font-semibold text-ink-muted">Cohort pulse</p>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div>
              <p className="text-3xl font-bold tracking-tight tabular-nums text-ink">{data.cohort?.enrolled_count || 0}</p>
              <p className="mt-1 text-xs font-semibold text-ink-muted">Enrolled</p>
            </div>
            <div>
              <p className="text-3xl font-bold tracking-tight tabular-nums text-ink">{data.cohort?.active_count || 0}</p>
              <p className="mt-1 text-xs font-semibold text-ink-muted">Active</p>
            </div>
          </div>
          <div className="mt-6 border-t border-line pt-5">
            <p className="text-xs font-semibold text-ink-muted">Current cohort</p>
            <p className="mt-1 text-sm font-semibold text-ink">{data.cohort?.name || 'No active cohort'}</p>
            {data.cohort?.start_date && <p className="mt-1 text-xs tabular-nums text-ink-muted">Started {formatShortDate(data.cohort.start_date)}</p>}
          </div>
        </div>
      </section>

      <section aria-labelledby="shortcuts-heading">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-ink-muted">Common work</p>
            <h2 id="shortcuts-heading" className="mt-1 text-lg font-bold text-ink">Jump back in</h2>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {[
            ['/admin/support', LifeBuoy, 'Student support', 'Requests and explainable signals'],
            ['/admin/cohorts', Users, 'Access & invitations', 'Choose any cohort, then check who joined'],
            ['/admin/grading', ClipboardCheck, 'Grading', 'Review submissions and redos'],
            ['/admin/content', FileText, 'Curriculum', 'Modules, lessons, and exercises'],
            [data.cohort ? `/admin/cohorts/${data.cohort.id}` : '/admin/cohorts', Layers3, 'Cohort setup', 'Schedule, resources, and access'],
          ].map(([to, Icon, title, description]) => {
            const ItemIcon = Icon as typeof Users
            return (
              <Link key={to as string} to={to as string} className="group app-surface pressable flex min-h-11 items-start gap-3 p-4 hover:border-line-strong hover:bg-surface-sunken">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-sunken text-ink-secondary"><ItemIcon className="h-5 w-5" aria-hidden="true" /></span>
                <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-ink">{title as string}</span><span className="mt-0.5 block text-xs leading-5 text-ink-muted">{description as string}</span></span>
                <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-ink-muted transition-colors duration-150 group-hover:text-ink" aria-hidden="true" />
              </Link>
            )
          })}
        </div>
      </section>

      {studentsNeedingAttention.length > 0 && (
        <section aria-labelledby="student-attention-heading" className="app-surface overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
            <div className="min-w-0">
              <h2 id="student-attention-heading" className="text-lg font-bold text-ink">Students to check in with</h2>
              <p className="mt-0.5 text-sm text-ink-muted">Low progress or no recent sign-in</p>
            </div>
            <Link to="/admin/students" className="app-link shrink-0 text-sm">View everyone</Link>
          </div>
          <div className="divide-y divide-line">
            {studentsNeedingAttention.map((student) => (
              <Link key={student.user_id} to={data.cohort ? cohortStudentPath(data.cohort.id, student.user_id) : `/admin/students/${student.user_id}`} className="group pressable grid min-h-11 gap-3 px-5 py-4 hover:bg-surface-sunken sm:grid-cols-[minmax(220px,1fr)_minmax(180px,0.7fr)_auto] sm:items-center sm:px-6">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={student.full_name} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink" title={student.full_name}>{student.full_name}</p>
                    <p className="truncate text-xs text-ink-muted" title={student.email}>{student.email}</p>
                  </div>
                </div>
                <div className="max-w-xs">
                  <ProgressBar value={student.progress_percentage} size="sm" showPercentage />
                </div>
                <div className="flex items-center justify-between gap-3 sm:justify-end">
                  {isInactive(student.last_sign_in_at)
                    ? <Badge tone="warning">{formatLastSeen(student.last_sign_in_at)}</Badge>
                    : <span className="text-xs font-semibold tabular-nums text-ink-muted">{formatLastSeen(student.last_sign_in_at)}</span>}
                  <ArrowRight className="h-4 w-4 shrink-0 text-ink-muted transition-colors duration-150 group-hover:text-ink" aria-hidden="true" />
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {data.students && data.students.length > 0 && studentsNeedingAttention.length === 0 && (
        <div className="app-surface flex items-center gap-4 p-5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-success-50 text-success-700"><Activity className="h-5 w-5" aria-hidden="true" /></span>
          <div><p className="text-sm font-semibold text-ink">Your active cohort looks steady.</p><p className="mt-0.5 text-xs text-ink-muted">No students meet the current attention thresholds.</p></div>
        </div>
      )}
    </div>
  )
}
