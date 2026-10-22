import { useCallback, useEffect, useState } from 'react'
import { Users, Search, ArrowLeft, AlertTriangle, Activity, Circle, Clock3, ChevronRight, ChevronDown } from 'lucide-react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { requireSection, SectionBoundary, useSection } from '../../lib/useSection'
import { useAuthContext } from '../../contexts/AuthContext'
import { api } from '../../lib/api'
import { cohortStudentPath } from '../../lib/routes'
import { ProgressBar } from '../../components/shared/ProgressBar'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { EmptyState } from '../../components/shared/EmptyState'
import { presenceStatus, usePresenceNow, type PresenceStatus } from '../../lib/presence'
import { subscribeToStaffPresence } from '../../lib/realtime'
import { PresenceBadge } from '../../components/shared/PresenceBadge'
import { Avatar } from '../../components/ui/Avatar'
import { Badge, type BadgeTone } from '../../components/ui/Badge'
import { LinkButton } from '../../components/ui/Button'
import { FilterChip } from '../../components/ui/Choice'
import { RowButton } from '../../components/ui/RowButton'
import { formatShortDate } from '../../lib/format'
import { listLinkState, useListScrollMemory } from '../../lib/navigationContext'

interface Student {
  user_id: number
  full_name: string
  email: string
  github_username: string | null
  progress_percentage: number
  completed_blocks: number
  total_blocks: number
  last_sign_in_at: string | null
  last_seen_at: string | null
  last_activity_at: string | null
  blocks_this_week: number
  submissions_this_week: number
  enrollment_status: string
}

interface CohortGroup {
  cohort: {
    id: number
    name: string
    start_date: string
    status: string
    enrolled_count: number
    active_count: number
  }
  students: Student[]
  ungraded_count: number
}

type ActivityStatus = 'active' | 'quiet' | 'at-risk' | 'new'
type StudentFilter = 'all' | ActivityStatus | 'online' | 'never-signed-in'
const STUDENT_FILTERS: StudentFilter[] = ['all', 'active', 'quiet', 'at-risk', 'new', 'online', 'never-signed-in']
const STUDENT_FILTER_LABELS: Record<StudentFilter, string> = { all: 'All', active: 'Active', quiet: 'Quiet', 'at-risk': 'At risk', new: 'New', online: 'Online now', 'never-signed-in': 'Never signed in' }
type StudentWithStatus = Student & {
  activityStatus: ActivityStatus
  presence: PresenceStatus
}

function getActivityStatus(student: Student): ActivityStatus {
  if (student.last_activity_at == null) return 'new'
  const daysSinceActivity = (Date.now() - new Date(student.last_activity_at).getTime()) / (1000 * 60 * 60 * 24)
  if (daysSinceActivity < 2) return 'active'
  if (daysSinceActivity < 7) return 'quiet'
  return 'at-risk'
}

function ActivityBadge({ status }: { status: ActivityStatus }) {
  const config: Record<ActivityStatus, { label: string; icon: typeof Activity; tone: BadgeTone }> = {
    active: { label: 'Active', icon: Activity, tone: 'success' },
    quiet: { label: 'Quiet (2-7d)', icon: Clock3, tone: 'neutral' },
    'at-risk': { label: 'At risk', icon: AlertTriangle, tone: 'warning' },
    new: { label: 'Not started', icon: Circle, tone: 'neutral' },
  }
  const { label, icon: Icon, tone } = config[status]
  return (
    <Badge tone={tone} icon={<Icon className="h-3.5 w-3.5" aria-hidden="true" />}>
      {label}
    </Badge>
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
  return formatShortDate(date)
}

export function StudentManagement() {
  const { user: staff } = useAuthContext()
  const isAdmin = Boolean(staff?.is_admin)
  const directory = useSection(String(isAdmin), useCallback(async () => requireSection(await api.getUsers({ role: 'student', include_enrollments: 'true', ...(isAdmin ? { include_archived: 'true' } : {}) })).users, [isAdmin]))
  const presenceNow = usePresenceNow()
  const [cohortGroups, setCohortGroups] = useState<CohortGroup[]>([])
  const [loading, setLoading] = useState(true)
  // Search and filter live in the URL so Back from a student returns to the same filtered list.
  const [searchParams, setSearchParams] = useSearchParams()
  // The box keeps its own state so fast typing never waits on a URL update; the URL mirrors it.
  const [search, setSearchValue] = useState(() => searchParams.get('q') || '')
  const filterParam = searchParams.get('filter')
  const filter: StudentFilter = STUDENT_FILTERS.includes(filterParam as StudentFilter) ? filterParam as StudentFilter : 'all'
  const updateParam = (key: 'q' | 'filter' | 'cohort_id', value: string) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      if (value && !(key === 'filter' && value === 'all')) next.set(key, value)
      else next.delete(key)
      return next
    }, { replace: true })
  }
  const setSearch = (value: string) => {
    setSearchValue(value)
    updateParam('q', value)
  }
  const setFilter = (value: StudentFilter) => updateParam('filter', value)
  const [collapsedCohorts, setCollapsedCohorts] = useState<Set<number>>(new Set())
  const location = useLocation()
  // Back from a student returns to this exact list (search + filter) at the same scroll position.
  useListScrollMemory(!loading)
  const filterLabel = filter === 'all' ? '' : ` · ${STUDENT_FILTER_LABELS[filter]}`
  const studentLinkState = listLinkState(location, `Students${filterLabel}${search.trim() ? ` · “${search.trim().slice(0, 24)}”` : ''}`)

  useEffect(() => {
    api.getDashboard().then((res) => {
      const dashboard = res.data?.dashboard
      if (dashboard?.cohorts) {
        setCohortGroups(dashboard.cohorts)
      } else if (dashboard?.cohort && dashboard?.students) {
        setCohortGroups([{
          cohort: dashboard.cohort,
          students: dashboard.students,
          ungraded_count: dashboard.ungraded_count || 0,
        }])
      }
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    let unsubscribe: (() => void) | undefined
    let active = true

    subscribeToStaffPresence((event) => {
      if (!active) return

      setCohortGroups((groups) => groups.map((group) => ({
        ...group,
        students: group.students.map((student) => (
          student.user_id === event.user_id
            ? { ...student, last_seen_at: event.last_seen_at }
            : student
        )),
      })))
    }).then((nextUnsubscribe) => {
      if (active) unsubscribe = nextUnsubscribe
      else nextUnsubscribe()
    }).catch(() => {
      // Existing dashboard loads and heartbeat timestamps remain the fallback.
    })

    return () => {
      active = false
      unsubscribe?.()
    }
  }, [])

  const selectedCohort = searchParams.get('cohort_id') || ''
  const visibleGroups = selectedCohort ? cohortGroups.filter((group) => String(group.cohort.id) === selectedCohort) : cohortGroups
  const allStudents = visibleGroups.flatMap(g =>
    g.students.map(s => ({
      ...s,
      activityStatus: getActivityStatus(s),
      presence: presenceStatus(s.last_seen_at, presenceNow),
      cohortId: g.cohort.id,
    }))
  )

  const atRiskCount = allStudents.filter(s => s.activityStatus === 'at-risk').length
  const quietCount = allStudents.filter(s => s.activityStatus === 'quiet').length
  const activeCount = allStudents.filter(s => s.activityStatus === 'active').length
  const onlineCount = allStudents.filter(s => s.presence === 'online').length
  const neverSignedInCount = allStudents.filter(s => !s.last_sign_in_at).length

  const matchesFilters = (s: StudentWithStatus) => {
    const matchesSearch =
      s.full_name.toLowerCase().includes(search.toLowerCase()) ||
      s.email.toLowerCase().includes(search.toLowerCase()) ||
      (s.github_username && s.github_username.toLowerCase().includes(search.toLowerCase()))
    const matchesFilter =
      filter === 'all' ||
      s.activityStatus === filter ||
      (filter === 'online' && s.presence === 'online') ||
      (filter === 'never-signed-in' && !s.last_sign_in_at)
    return matchesSearch && matchesFilter
  }

  const toggleCohort = (id: number) => {
    setCollapsedCohorts(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (loading) return <LoadingSpinner message="Loading students..." />

  return (
    <div className="app-page-wide">
      <header>
        <LinkButton to="/admin" variant="quiet" size="sm" className="-ml-3 mb-2">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Staff home
        </LinkButton>
        <p className="app-eyebrow">People & intervention</p>
        <h1 className="app-title mt-2">Students</h1>
        <p className="app-description mt-2 tabular-nums">
          {allStudents.length} student{allStudents.length !== 1 ? 's' : ''} across {cohortGroups.length} cohort{cohortGroups.length !== 1 ? 's' : ''}
        </p>
      </header>

      {atRiskCount > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-warning-200 bg-warning-50 px-4 py-3">
          <AlertTriangle className="h-5 w-5 shrink-0 text-warning-700" aria-hidden="true" />
          <p className="text-sm text-warning-800">
            <span className="font-semibold tabular-nums">{atRiskCount} student{atRiskCount > 1 ? 's' : ''} at risk</span>
            {' '}— no activity in 7+ days.
          </p>
        </div>
      )}

      <label className="mb-4 block text-sm font-semibold text-ink-secondary">Cohort<select aria-label="Filter students by cohort" className="app-control mt-1 w-full sm:max-w-sm" value={selectedCohort} onChange={(event) => updateParam('cohort_id', event.target.value)}><option value="">All cohorts</option>{cohortGroups.map((group) => <option key={group.cohort.id} value={group.cohort.id}>{group.cohort.name}</option>)}</select></label>

      <div role="group" aria-label="Filter students" className="flex flex-wrap gap-2">
        <FilterChip selected={filter === 'online'} count={onlineCount} onClick={() => setFilter(filter === 'online' ? 'all' : 'online')}>
          Online now
        </FilterChip>
        <FilterChip selected={filter === 'active'} count={activeCount} onClick={() => setFilter(filter === 'active' ? 'all' : 'active')}>
          Active (&lt;2 days)
        </FilterChip>
        <FilterChip selected={filter === 'quiet'} count={quietCount} onClick={() => setFilter(filter === 'quiet' ? 'all' : 'quiet')}>
          Quiet (2-7 days)
        </FilterChip>
        <FilterChip selected={filter === 'at-risk'} count={atRiskCount} onClick={() => setFilter(filter === 'at-risk' ? 'all' : 'at-risk')}>
          At risk (7+ days)
        </FilterChip>
        <FilterChip selected={filter === 'never-signed-in'} count={neverSignedInCount} onClick={() => setFilter(filter === 'never-signed-in' ? 'all' : 'never-signed-in')}>
          Never signed in
        </FilterChip>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search students across all cohorts..."
          aria-label="Search students"
          className="app-control w-full pl-10 pr-4"
        />
      </div>

      {filter === 'all' && <SectionBoundary section={directory} label="Student directory">{directory.data?.filter((student) => (!student.enrollments?.length || student.archived_at) && (!selectedCohort || student.enrollments?.some((enrollment) => String(enrollment.cohort_id) === selectedCohort)) && `${student.full_name} ${student.email} ${student.github_username || ''}`.toLowerCase().includes(search.toLowerCase())).map((student) => <Link key={student.id} to={`/admin/students/${student.id}`} state={studentLinkState} className="app-surface mb-3 flex min-h-20 items-center justify-between gap-3 p-4"><span className="min-w-0"><span className="block font-semibold text-ink [overflow-wrap:anywhere]">{student.full_name || student.email}</span><span className="block truncate text-sm text-ink-muted">{student.email}</span></span><Badge>{student.archived_at ? 'Archived' : 'No enrollments'}</Badge></Link>)}</SectionBoundary>}

      {cohortGroups.length === 0 ? (
        <EmptyState icon={Users} title="No cohorts" description="No active cohorts with students found." />
      ) : allStudents.filter(matchesFilters).length === 0 ? (
        <EmptyState icon={Search} title="No students found" description="No students match your current search or filters." />
      ) : (
        <div className="space-y-4">
          {visibleGroups.map(group => {
            const groupStudents = group.students
              .map(s => ({
                ...s,
                activityStatus: getActivityStatus(s),
                presence: presenceStatus(s.last_seen_at, presenceNow),
              }))
              .filter(matchesFilters)
            const isCollapsed = collapsedCohorts.has(group.cohort.id)

            if (groupStudents.length === 0 && (search || filter !== 'all')) return null

            return (
              <div key={group.cohort.id} className="app-surface overflow-hidden">
                <div className="flex items-center gap-3 border-b border-line pr-4 sm:pr-6">
                  <RowButton
                    onClick={() => toggleCohort(group.cohort.id)}
                    aria-expanded={!isCollapsed}
                    className="flex flex-1 items-center gap-3 px-4 py-4 sm:px-6"
                  >
                    <ChevronDown className={`h-4 w-4 shrink-0 text-ink-muted transition-transform duration-150 ${isCollapsed ? '-rotate-90' : ''}`} aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block truncate text-base font-semibold text-ink" title={group.cohort.name}>{group.cohort.name}</span>
                      <span className="mt-0.5 block text-xs tabular-nums text-ink-muted">
                        {group.cohort.enrolled_count} enrolled · {group.cohort.active_count} active enrollments
                        {group.ungraded_count > 0 && (
                          <span className="font-semibold text-warning-800"> · {group.ungraded_count} ungraded</span>
                        )}
                      </span>
                    </span>
                  </RowButton>
                  <Link
                    to={`/admin/cohorts/${group.cohort.id}?tab=students`}
                    className="app-link inline-flex min-h-11 shrink-0 items-center text-xs"
                  >
                    Access & invitations
                  </Link>
                </div>

                {!isCollapsed && (
                  <div className="overflow-x-auto">
                    {groupStudents.length === 0 ? (
                      <p className="px-6 py-8 text-center text-sm text-ink-muted">No students match your filters</p>
                    ) : (
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-line bg-surface-sunken">
                            <th className="px-6 py-2.5 text-left text-xs font-semibold text-ink-muted">Student</th>
                            <th className="px-6 py-2.5 text-left text-xs font-semibold text-ink-muted">Progress</th>
                            <th className="hidden px-6 py-2.5 text-left text-xs font-semibold text-ink-muted sm:table-cell">This week</th>
                            <th className="hidden px-6 py-2.5 text-left text-xs font-semibold text-ink-muted sm:table-cell">Course activity</th>
                            <th className="hidden px-6 py-2.5 text-left text-xs font-semibold text-ink-muted sm:table-cell">Status</th>
                            <th className="px-3 py-2.5 w-8" />
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                          {groupStudents.map(student => (
                            <tr
                              key={student.user_id}
                              className={`transition-colors duration-150 hover:bg-surface-sunken ${student.activityStatus === 'at-risk' ? 'bg-warning-50/60' : ''}`}
                            >
                              <td className="max-w-[15rem] px-4 py-3 sm:max-w-xs sm:px-6">
                                <div className="flex min-w-0 items-start gap-3">
                                  <Avatar name={student.full_name} size="sm" className="mt-1.5" />
                                  <div className="min-w-0 flex-1">
                                    <Link to={cohortStudentPath(group.cohort.id, student.user_id)} state={studentLinkState} title={student.full_name} className="block truncate rounded-md py-1 text-sm font-semibold text-ink underline-offset-4 hover:underline">{student.full_name}</Link>
                                    <p className="truncate text-xs text-ink-muted" title={student.email}>{student.email}</p>
                                  </div>
                                </div>
                                <div className="mt-1 flex flex-wrap items-center gap-2">
                                  <PresenceBadge status={student.presence} />
                                  <span className="text-xs tabular-nums text-ink-muted">Last active: {formatLastActivity(student.last_seen_at)}</span>
                                </div>
                                {student.github_username && (
                                  <a
                                    href={`https://github.com/${student.github_username}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={e => e.stopPropagation()}
                                    title={`@${student.github_username}`}
                                    className="app-link mt-1 block truncate text-xs"
                                  >
                                    @{student.github_username}
                                  </a>
                                )}
                              </td>
                              <td className="px-6 py-3 w-44">
                                <ProgressBar value={student.progress_percentage} size="sm" />
                                <p className="mt-1 text-xs tabular-nums text-ink-muted">
                                  {student.completed_blocks}/{student.total_blocks}
                                </p>
                              </td>
                              <td className="px-6 py-3 hidden sm:table-cell">
                                <div className="text-sm tabular-nums">
                                  <span className={`font-semibold ${student.blocks_this_week > 0 ? 'text-success-700' : 'text-ink-muted'}`}>
                                    {student.blocks_this_week}
                                  </span>
                                  <span className="text-xs text-ink-muted"> blocks</span>
                                </div>
                                {student.submissions_this_week > 0 && (
                                  <p className="text-xs tabular-nums text-info-700">{student.submissions_this_week} submission{student.submissions_this_week > 1 ? 's' : ''}</p>
                                )}
                              </td>
                              <td className="px-6 py-3 hidden sm:table-cell">
                                <span className="whitespace-nowrap text-sm tabular-nums text-ink-muted">{formatLastActivity(student.last_activity_at)}</span>
                              </td>
                              <td className="px-6 py-3 hidden sm:table-cell">
                                <ActivityBadge status={student.activityStatus} />
                              </td>
                              <td className="px-3 py-3 w-8">
                                <ChevronRight className="h-4 w-4 text-ink-muted" aria-hidden="true" />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
