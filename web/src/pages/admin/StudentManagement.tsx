import { useCallback, useEffect, useState } from 'react'
import { PageHeader, ScopeControl } from '../../components/ui/PageHeader'
import { Users, Search, AlertTriangle, ChevronDown, MessageCircle, X } from 'lucide-react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { requireSection, SectionBoundary, useSection } from '../../lib/useSection'
import { useAuthContext } from '../../contexts/AuthContext'
import { api } from '../../lib/api'
import type { UserEnrollment } from '../../types/api'
import { cohortStudentPath, cohortPath, studentPath } from '../../lib/routes'
import { ProgressBar } from '../../components/shared/ProgressBar'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { EmptyState } from '../../components/shared/EmptyState'
import { presenceStatus, usePresenceNow, type PresenceStatus } from '../../lib/presence'
import { subscribeToStaffPresence } from '../../lib/realtime'
import { PresenceBadge } from '../../components/shared/PresenceBadge'
import { Avatar } from '../../components/ui/Avatar'
import { Badge, type BadgeTone } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { FilterChip } from '../../components/ui/Choice'
import { RowButton } from '../../components/ui/RowButton'
import { Collapse } from '../../components/ui/Motion'
import { formatShortDate } from '../../lib/format'
import { forwardReturnState, listLinkState, useListScrollMemory } from '../../lib/navigationContext'
import { useRememberRoster } from '../../lib/recordQueue'
import { lessonsLabel } from '../../lib/progressLabel'
import { MessageStudentsDialog, useMessageStudent } from '../../components/admin/MessageStudentsDialog'
import type { BulkRecipient } from '../../lib/bulkMessage'

interface Student {
  user_id: number
  full_name: string
  email: string
  github_username: string | null
  progress_percentage: number
  completed_blocks: number
  total_blocks: number
  completed_lessons?: number
  total_lessons?: number
  last_sign_in_at: string | null
  last_seen_at: string | null
  /** The one "last active" (the learner's own learning activity in this cohort). */
  last_activity_at: string | null
  /** From the attention list: the same "needs attention" as Today and Support. */
  needs_attention?: boolean
  status_label?: string
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

// Status comes from the server's attention list (T-3), never a client-side
// rule: "Needs attention" here is exactly who Today and Support list.
type StudentFilter = 'all' | 'needs-attention' | 'online' | 'never-signed-in'
const STUDENT_FILTERS: StudentFilter[] = ['all', 'needs-attention', 'online', 'never-signed-in']
const STUDENT_FILTER_LABELS: Record<StudentFilter, string> = { all: 'All', 'needs-attention': 'Needs attention', online: 'Online now', 'never-signed-in': 'Never signed in' }
// Links saved before T-3 used the client-side "at risk" filter.
const LEGACY_FILTERS: Record<string, StudentFilter> = { 'at-risk': 'needs-attention' }
type StudentWithStatus = Student & {
  presence: PresenceStatus
}

function enrollmentLabel(enrollment: Pick<UserEnrollment, 'status' | 'cohort_status' | 'access_expires_at'>): string {
  if (enrollment.status === 'completed') return 'Completed'
  if (enrollment.status === 'dropped' || enrollment.cohort_status === 'completed' || enrollment.cohort_status === 'past' || enrollment.cohort_status === 'archived' ||
    (enrollment.access_expires_at && new Date(enrollment.access_expires_at).getTime() <= Date.now())) return 'Access ended'
  return enrollment.status === 'paused' ? 'Paused' : 'Active'
}

function StatusBadge({ student }: { student: Student }) {
  const label = student.status_label || (student.needs_attention ? 'Needs attention' : 'On track')
  const tone: BadgeTone = student.needs_attention ? 'warning' : label === 'On track' ? 'success' : 'neutral'
  return <Badge tone={tone} icon={student.needs_attention ? <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> : undefined}>{label}</Badge>
}

function formatLastActivity(dateStr: string | null): string {
  if (!dateStr) return 'No activity yet'
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
  const location = useLocation()
  const [cohortGroups, setCohortGroups] = useState<CohortGroup[]>([])
  const [loading, setLoading] = useState(true)
  // Search and filter live in the URL so Back from a student returns to the same filtered list.
  const [searchParams, setSearchParams] = useSearchParams()
  // The box keeps its own state so fast typing never waits on a URL update; the URL mirrors it.
  const [search, setSearchValue] = useState(() => searchParams.get('q') || '')
  const filterParam = searchParams.get('filter') || ''
  const filter: StudentFilter = STUDENT_FILTERS.includes(filterParam as StudentFilter) ? filterParam as StudentFilter : LEGACY_FILTERS[filterParam] || 'all'
  // Typing replaces the history entry; choosing a filter or cohort pushes one, so Back undoes it.
  const updateParam = (key: 'q' | 'filter' | 'cohort_id', value: string) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      if (value && !(key === 'filter' && value === 'all')) next.set(key, value)
      else next.delete(key)
      return next
    }, { replace: key === 'q', preventScrollReset: true, state: forwardReturnState(location.state) })
  }
  const setSearch = (value: string) => {
    setSearchValue(value)
    updateParam('q', value)
  }
  const setFilter = (value: StudentFilter) => updateParam('filter', value)
  const [collapsedCohorts, setCollapsedCohorts] = useState<Set<number>>(new Set())
  // Selected rows for "Message selected", keyed by student and cohort.
  const [selected, setSelected] = useState<Map<string, BulkRecipient>>(new Map())
  const [composing, setComposing] = useState(false)
  const message = useMessageStudent()
  const toggleSelected = (recipient: BulkRecipient) => setSelected((current) => {
    const next = new Map(current)
    const key = `${recipient.userId}:${recipient.cohortId}`
    if (next.has(key)) next.delete(key)
    else next.set(key, recipient)
    return next
  })
  // Back from a student returns to this exact list (search + filter) at the same scroll position.
  useListScrollMemory(!loading)
  const filterLabel = filter === 'all' ? '' : ` · ${STUDENT_FILTER_LABELS[filter]}`
  const studentLinkState = listLinkState(location, `Students${filterLabel}${search.trim() ? ` · “${search.trim().slice(0, 24)}”` : ''}`)

  const [dashboardError, setDashboardError] = useState<string | null>(null)
  const loadDashboard = useCallback(() => {
    setDashboardError(null)
    // The directory renders independently; an activity failure must never hide it.
    return api.getDashboard().then((res) => {
      const dashboard = res.data?.dashboard
      if (res.error || !dashboard) {
        setDashboardError(res.error || 'Activity details are unavailable.')
      } else if (dashboard.cohorts) {
        setCohortGroups(dashboard.cohorts)
      } else if (dashboard.cohort && dashboard.students) {
        setCohortGroups([{
          cohort: dashboard.cohort,
          students: dashboard.students,
          ungraded_count: dashboard.ungraded_count || 0,
        }])
      }
    }).catch((error: unknown) => {
      setDashboardError(error instanceof Error ? error.message : 'Activity details are unavailable.')
    }).finally(() => setLoading(false))
  }, [])
  useEffect(() => { void loadDashboard() }, [loadDashboard])

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

  // Only a positive whole id selects a cohort; anything else in the URL shows every cohort.
  const cohortParam = Number(searchParams.get('cohort_id'))
  const selectedCohort = Number.isSafeInteger(cohortParam) && cohortParam > 0 ? String(cohortParam) : ''
  const visibleGroups = selectedCohort ? cohortGroups.filter((group) => String(group.cohort.id) === selectedCohort) : cohortGroups
  const allStudents = visibleGroups.flatMap(g =>
    g.students.map(s => ({
      ...s,
      presence: presenceStatus(s.last_seen_at, presenceNow),
      cohortId: g.cohort.id,
    }))
  )

  const attentionCount = allStudents.filter(s => s.needs_attention).length
  const onlineCount = allStudents.filter(s => s.presence === 'online').length
  const neverSignedInCount = allStudents.filter(s => !s.last_sign_in_at).length

  const matchesFilters = (s: StudentWithStatus) => {
    const matchesSearch =
      s.full_name.toLowerCase().includes(search.toLowerCase()) ||
      s.email.toLowerCase().includes(search.toLowerCase()) ||
      (s.github_username && s.github_username.toLowerCase().includes(search.toLowerCase()))
    const matchesFilter =
      filter === 'all' ||
      (filter === 'needs-attention' && Boolean(s.needs_attention)) ||
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

  // Dashboard is an activity projection, not a complete enrollment directory.
  const dashboardPairs = new Set(cohortGroups.flatMap((group) => group.students.map((student) => `${student.user_id}:${group.cohort.id}`)))
  const enrollmentFacts = new Map((directory.data || []).flatMap((student) =>
    (student.enrollments || []).map((enrollment) => [`${student.id}:${enrollment.cohort_id}`, enrollment] as const)))
  const cohortOptions = new Map(cohortGroups.map((group) => [group.cohort.id, group.cohort.name]))
  for (const student of directory.data || []) for (const enrollment of student.enrollments || []) {
    cohortOptions.set(enrollment.cohort_id, enrollment.cohort_name)
  }
  const directoryStudents = filter === 'all' ? (directory.data || []).flatMap((student) => {
    if (!`${student.full_name} ${student.email} ${student.github_username || ''}`.toLowerCase().includes(search.toLowerCase())) return []
    const missing = (student.enrollments || []).filter((enrollment) =>
      (!selectedCohort || String(enrollment.cohort_id) === selectedCohort) &&
      !dashboardPairs.has(`${student.id}:${enrollment.cohort_id}`))
    if (student.archived_at || !student.enrollments?.length) {
      if (!selectedCohort) return [{ student, enrollment: null as UserEnrollment | null }]
      // A cohort filter keeps the archived learner's enrollment so the row opens that workspace.
      const selected = student.enrollments?.find((enrollment) => String(enrollment.cohort_id) === selectedCohort)
      return selected ? [{ student, enrollment: selected as UserEnrollment | null }] : []
    }
    return missing.map((enrollment) => ({ student, enrollment }))
  }).sort((a, b) => Number(b.enrollment != null && enrollmentLabel(b.enrollment) === 'Active') -
    Number(a.enrollment != null && enrollmentLabel(a.enrollment) === 'Active') || a.student.full_name.localeCompare(b.student.full_name)) : []

  const groupRows = (group: CohortGroup) => group.students
    .map(s => ({
      ...s,
      presence: presenceStatus(s.last_seen_at, presenceNow),
    }))
    .filter(matchesFilters)
    .sort((a, b) => Number(b.enrollment_status === 'active') - Number(a.enrollment_status === 'active') || a.full_name.localeCompare(b.full_name))
  // The student page walks this list, in this order and with these filters (L-0.7).
  useRememberRoster(staff?.id, studentLinkState.returnTo, [
    ...visibleGroups.flatMap((group) => groupRows(group).map((student) => ({ cohortId: group.cohort.id, userId: student.user_id }))),
    ...directoryStudents.flatMap(({ student, enrollment }) => enrollment ? [{ cohortId: enrollment.cohort_id, userId: student.id }] : []),
  ], !loading)

  const enrollmentCount = allStudents.length + directoryStudents.filter((row) => row.enrollment).length
  const cohortCount = selectedCohort ? Number(cohortOptions.has(Number(selectedCohort))) : cohortOptions.size

  if (loading) return <LoadingSpinner message="Loading students..." />

  return (
    <div className="app-page-wide">
      <PageHeader
        title="Students"
        description={<>{enrollmentCount} enrollment{enrollmentCount !== 1 ? 's' : ''} across {cohortCount} cohort{cohortCount !== 1 ? 's' : ''}</>}
        scope={<ScopeControl value={selectedCohort} options={[{ value: '', label: 'All cohorts' }, ...[...cohortOptions].map(([id, name]) => ({ value: String(id), label: name }))]} onChange={(value) => updateParam('cohort_id', value)} />}
      />

      {dashboardError && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-warning-line bg-warning-soft px-4 py-3">
          <AlertTriangle className="h-5 w-5 shrink-0 text-warning-ink" aria-hidden="true" />
          <p className="flex-1 text-sm text-warning-ink">Activity and progress details couldn't load. The student list below is still current.</p>
          <Button variant="secondary" size="sm" onClick={() => void loadDashboard()}>Try again</Button>
        </div>
      )}

      <div role="group" aria-label="Filter students" className="flex flex-wrap items-center gap-2">
        <FilterChip selected={filter === 'needs-attention'} count={attentionCount} onClick={() => setFilter(filter === 'needs-attention' ? 'all' : 'needs-attention')}>
          Needs attention
        </FilterChip>
        <FilterChip selected={filter === 'online'} count={onlineCount} onClick={() => setFilter(filter === 'online' ? 'all' : 'online')}>
          Online now
        </FilterChip>
        <FilterChip selected={filter === 'never-signed-in'} count={neverSignedInCount} onClick={() => setFilter(filter === 'never-signed-in' ? 'all' : 'never-signed-in')}>
          Never signed in
        </FilterChip>
        {attentionCount > 0 && <Link to={`/admin/support${selectedCohort ? `?cohort_id=${selectedCohort}` : ''}`} className="app-link inline-flex min-h-11 items-center text-sm">See why in Support</Link>}
      </div>

      {selected.size > 0 && (
        <div role="region" aria-label="Selected students" className="sticky top-2 z-20 flex flex-wrap items-center gap-3 rounded-xl border border-line-strong bg-surface-raised px-4 py-2 shadow-sm">
          <p className="text-sm font-semibold tabular-nums text-ink">{selected.size} selected</p>
          <Button size="sm" onClick={() => setComposing(true)}><MessageCircle className="h-4 w-4" aria-hidden="true" />Message selected</Button>
          <Button size="sm" variant="secondary" onClick={() => setSelected(new Map())}><X className="h-4 w-4" aria-hidden="true" />Clear</Button>
        </div>
      )}
      <MessageStudentsDialog open={composing} recipients={[...selected.values()]} onClose={() => setComposing(false)} />

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

      {cohortGroups.length === 0 && !directoryStudents.length ? (
        <EmptyState icon={Users} title="No cohorts" description="No active cohorts with students found." />
      ) : allStudents.filter(matchesFilters).length === 0 && !directoryStudents.length ? (
        <EmptyState icon={Search} title="No students found" description="No students match your current search or filters." />
      ) : (
        <div className="space-y-4">
          {visibleGroups.map(group => {
            const groupStudents = groupRows(group)
            const isCollapsed = collapsedCohorts.has(group.cohort.id)

            if (groupStudents.length === 0) return null

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
                          <span className="font-semibold text-warning-ink"> · {group.ungraded_count} ungraded</span>
                        )}
                      </span>
                    </span>
                  </RowButton>
                  <Link
                    to={cohortPath(group.cohort.id, 'students')}
                    className="app-link inline-flex min-h-11 shrink-0 items-center text-xs"
                  >
                    Access & invitations
                  </Link>
                </div>

                <Collapse open={!isCollapsed}>
                  <div className="overflow-x-auto">
                    {groupStudents.length === 0 ? (
                      <p className="px-6 py-8 text-center text-sm text-ink-muted">No students match your filters</p>
                    ) : (
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-line bg-surface-sunken">
                            <th className="w-12 py-2.5 pl-4 pr-0 text-left sm:pl-6"><span className="sr-only">Select</span></th>
                            <th className="px-4 py-2.5 text-left text-xs font-semibold text-ink-muted sm:px-6">Student</th>
                            <th className="px-6 py-2.5 text-left text-xs font-semibold text-ink-muted">Progress</th>
                            <th className="hidden px-6 py-2.5 text-left text-xs font-semibold text-ink-muted sm:table-cell">Last active</th>
                            <th className="hidden px-6 py-2.5 text-left text-xs font-semibold text-ink-muted sm:table-cell">Last 7 days</th>
                            <th className="hidden px-6 py-2.5 text-left text-xs font-semibold text-ink-muted sm:table-cell">Status</th>
                            <th className="px-3 py-2.5"><span className="sr-only">Actions</span></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                          {groupStudents.map(student => (
                            <tr
                              key={student.user_id}
                              className={`transition-colors duration-150 hover:bg-surface-sunken ${student.needs_attention ? 'bg-warning-soft/60' : ''}`}
                            >
                              <td className="w-12 py-3 pl-4 pr-0 align-top sm:pl-6">
                                <label className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl hover:bg-surface-sunken">
                                  <input type="checkbox" className="h-4 w-4 accent-primary" checked={selected.has(`${student.user_id}:${group.cohort.id}`)} onChange={() => toggleSelected({ userId: student.user_id, name: student.full_name, cohortId: group.cohort.id })} aria-label={`Select ${student.full_name}`} />
                                </label>
                              </td>
                              <td className="max-w-[15rem] px-4 py-3 sm:max-w-xs sm:px-6">
                                <div className="flex min-w-0 items-start gap-3">
                                  <Avatar name={student.full_name} size="sm" className="mt-1.5" />
                                  <div className="min-w-0 flex-1">
                                    <Link to={cohortStudentPath(group.cohort.id, student.user_id)} state={studentLinkState} title={student.full_name} className="block truncate rounded-md py-1 text-sm font-semibold text-ink underline-offset-4 hover:underline">{student.full_name}</Link>
                                    <p className="truncate text-xs text-ink-muted" title={student.email}>{student.email}</p>
                                  </div>
                                </div>
                                <Badge>{enrollmentLabel(enrollmentFacts.get(`${student.user_id}:${group.cohort.id}`) || { status: student.enrollment_status, cohort_status: group.cohort.status })}</Badge>
                                <div className="mt-1 flex flex-wrap items-center gap-2">
                                  <PresenceBadge status={student.presence} />
                                  <span className="text-xs tabular-nums text-ink-muted sm:hidden">Last active: {formatLastActivity(student.last_activity_at)}</span>
                                  <span className="sm:hidden"><StatusBadge student={student} /></span>
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
                                  {lessonsLabel(student)}
                                </p>
                              </td>
                              <td className="px-6 py-3 hidden sm:table-cell">
                                <span className="whitespace-nowrap text-sm tabular-nums text-ink-muted">{formatLastActivity(student.last_activity_at)}</span>
                              </td>
                              <td className="px-6 py-3 hidden sm:table-cell">
                                <p className="whitespace-nowrap text-sm tabular-nums text-ink-secondary">
                                  {student.submissions_this_week} {student.submissions_this_week === 1 ? 'submission' : 'submissions'}
                                </p>
                              </td>
                              <td className="px-6 py-3 hidden sm:table-cell">
                                <StatusBadge student={student} />
                              </td>
                              <td className="px-3 py-3">
                                <Button size="sm" variant="secondary" onClick={() => void message.open(student.user_id, group.cohort.id)} disabled={message.opening === student.user_id} aria-label={`Message ${student.full_name}`}>
                                  <MessageCircle className="h-4 w-4" aria-hidden="true" /><span className="hidden lg:inline">{message.opening === student.user_id ? 'Opening…' : 'Message'}</span>
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </Collapse>
              </div>
            )
          })}
        </div>
      )}
      {filter === 'all' && <SectionBoundary section={directory} label="Student directory">
        {directoryStudents.map(({ student, enrollment }) => <Link key={`${student.id}:${enrollment?.id || 'profile'}`}
          to={enrollment ? cohortStudentPath(enrollment.cohort_id, student.id) : studentPath(student.id)}
          state={studentLinkState} className="app-surface mb-3 flex min-h-20 flex-wrap items-center justify-between gap-3 p-4">
          <span className="min-w-0 flex-1"><span className="block font-semibold text-ink [overflow-wrap:anywhere]">{student.full_name || student.email}</span>
            <span className="block truncate text-sm text-ink-muted">{student.email}</span>
            {enrollment && <span className="block text-sm text-ink-secondary">{enrollment.cohort_name}</span>}
          </span>
          <Badge>{student.archived_at ? 'Archived' : enrollment ? enrollmentLabel(enrollment) : 'No enrollments'}</Badge>
        </Link>)}
      </SectionBoundary>}
    </div>
  )
}
