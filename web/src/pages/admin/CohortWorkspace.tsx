import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Activity, AlertTriangle, ArrowLeft, ArrowRight, BarChart3, BookOpen, CalendarDays, CheckCircle2, CircleDashed, Eye, GitBranch, GraduationCap, MessageSquareText, PlayCircle, RefreshCw, Settings2, Target, Users } from 'lucide-react'
import { api } from '../../lib/api'
import { cohortStudentPath, submissionPath } from '../../lib/routes'
import { formatDateTimeRange, formatShortDateTime } from '../../lib/format'
import { EmptyState } from '../../components/shared/EmptyState'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { ProgressBar } from '../../components/shared/ProgressBar'
import { Avatar } from '../../components/ui/Avatar'
import { Badge, type BadgeTone } from '../../components/ui/Badge'
import { CohortStatusBadge } from '../../components/shared/CohortStatusBadge'
import { Button, LinkButton } from '../../components/ui/Button'
import { CohortHomePanel } from '../../components/admin/CohortHomePanel'
import { CohortTeachingTeam } from '../../components/admin/CohortTeachingTeam'
import { StaffActivityFeed } from '../../components/admin/StaffActivityFeed'
import { RecordingUploadManager } from '../../components/admin/RecordingUploadManager'
import { StaffPrivateMeetings } from './PrivateMeetings'
import { CohortScheduleManager } from '../../components/admin/CohortScheduleManager'
import { useAuthContext } from '../../contexts/AuthContext'
import type { CohortDetail, CohortHome, GithubAccessResponse, GithubAccessStatus, LearningInsights, LearningEvidenceStatus } from '../../types/api'

type CohortTab = 'overview' | 'students' | 'learning' | 'insights' | 'schedule' | 'communication' | 'team' | 'activity' | 'recordings'
const tabs: Array<{ id: CohortTab; label: string; icon: typeof Users }> = [
  { id: 'overview', label: 'Overview', icon: GraduationCap },
  { id: 'students', label: 'Students', icon: Users },
  { id: 'learning', label: 'Learning', icon: BookOpen },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'recordings', label: 'Recordings', icon: PlayCircle },
  { id: 'schedule', label: 'Schedule', icon: CalendarDays },
  { id: 'communication', label: 'Communication', icon: MessageSquareText },
  { id: 'team', label: 'Teaching team', icon: Users },
]


export function CohortWorkspace() {
  const { id } = useParams<{ id: string }>()
  return <Workspace key={id} cohortId={Number(id)} />
}

function Workspace({ cohortId }: { cohortId: number }) {
  const [searchParams] = useSearchParams()
  const requestedTab = searchParams.get('tab')
  const activeTab = (requestedTab === 'insights' || tabs.some((tab) => tab.id === requestedTab)) ? requestedTab as CohortTab : 'overview'
  const [cohort, setCohort] = useState<CohortDetail | null>(null)
  const [home, setHome] = useState<CohortHome | null>(null)
  const { user } = useAuthContext()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [insights, setInsights] = useState<LearningInsights | null>(null)
  const [insightsLoading, setInsightsLoading] = useState(false)
  const [insightsError, setInsightsError] = useState<string | null>(null)

  useEffect(() => {
    if (!Number.isInteger(cohortId) || cohortId <= 0) {
      setError('This cohort address is invalid.')
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)
    void api.getCohort(cohortId).then((result) => {
      if (!active) return
      if (result.data) { setCohort(result.data.cohort); setError(null) }
      else setError(result.error || 'Could not load this cohort workspace.')
      setLoading(false)
    })
    void api.getCohortHome(cohortId).then((result) => {
      if (active && result.data && !result.error && !result.fromCache) setHome(result.data.home)
    })
    return () => { active = false }
  }, [cohortId])

  const loadInsights = useCallback(async () => {
    setInsightsLoading(true)
    setInsightsError(null)
    const result = await api.getLearningInsights(cohortId)
    if (result.data && !result.error && !result.fromCache) setInsights(result.data.learning_insights)
    else setInsightsError(result.error || 'Could not load learning evidence.')
    setInsightsLoading(false)
  }, [cohortId])

  useEffect(() => {
    if (activeTab === 'insights' && !insights && !insightsLoading && !insightsError) void loadInsights()
  }, [activeTab, insights, insightsLoading, insightsError, loadInsights])

  const activeStudents = useMemo(() => cohort?.students.filter((student) => student.status === 'active') || [], [cohort])
  if (loading) return <LoadingSpinner message="Loading cohort workspace…" />
  if (!cohort || error) return <EmptyState icon={Users} title="Could not open cohort" description={error || 'This cohort is unavailable.'} />

  return <div className="app-page-wide space-y-6">
    {!user?.is_admin && searchParams.get('settings_notice') === '1' && <p role="status" className="rounded-xl border border-line p-4 text-sm text-ink-secondary">Cohort settings are managed by admins.</p>}
    <header>
      <Link to="/admin/cohorts" className="app-link inline-flex min-h-11 items-center gap-1 text-sm"><ArrowLeft className="h-4 w-4" />Cohorts</Link>
      <div className="mt-2 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-3"><h1 className="app-title min-w-0 [overflow-wrap:anywhere]">{cohort.name}</h1><CohortStatusBadge status={cohort.status} /></div><p className="app-description mt-2 tabular-nums">{cohort.curriculum_name} · {cohort.students.length} enrolled student{cohort.students.length === 1 ? '' : 's'}</p></div><div className="flex shrink-0 flex-wrap gap-2"><LinkButton variant="secondary" to={`/admin/cohorts/${cohort.id}/student-view${activeStudents[0] ? `?student_id=${activeStudents[0].user_id}` : ''}`}><Eye className="h-4 w-4" />Preview student view</LinkButton>{user?.is_admin && <LinkButton to={`/admin/cohorts/${cohort.id}/settings`}><Settings2 className="h-4 w-4" />Manage cohort</LinkButton>}</div></div>
    </header>

    <nav aria-label="Cohort workspace sections" className="border-b border-line lg:overflow-x-auto"><div className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:flex lg:min-w-max">{tabs.filter((tab) => tab.id !== 'team' || user?.is_admin).map(({ id: tabId, label, icon: Icon }) => <Link key={tabId} to={tabId === 'overview' ? `/admin/cohorts/${cohort.id}` : `/admin/cohorts/${cohort.id}?tab=${tabId}`} aria-current={(activeTab === tabId || (activeTab === 'insights' && tabId === 'learning')) ? 'page' : undefined} className={`inline-flex min-h-11 items-center justify-center gap-2 px-2 text-center text-sm font-semibold transition-colors duration-150 sm:px-4 ${(activeTab === tabId || (activeTab === 'insights' && tabId === 'learning')) ? 'tab-selected' : 'text-ink-secondary hover:bg-surface-sunken hover:text-ink'}`}><Icon className="h-4 w-4 shrink-0" />{label}</Link>)}</div></nav>

    {activeTab === 'overview' && (home ? <CohortHomePanel home={home} /> : <Overview cohort={cohort} />)}
    {activeTab === 'students' && <Students key={cohort.id} cohort={cohort} />}
    {(activeTab === 'learning' || activeTab === 'insights') && <nav aria-label="Learning sections" className="flex flex-wrap gap-2"><LinkButton variant={activeTab === 'learning' ? 'secondary' : 'quiet'} to={`/admin/cohorts/${cohort.id}?tab=learning`}>Assigned learning</LinkButton><LinkButton variant={activeTab === 'insights' ? 'secondary' : 'quiet'} to={`/admin/cohorts/${cohort.id}?tab=insights`}>Learning insights</LinkButton></nav>}
    {activeTab === 'learning' && <Learning cohort={cohort} canConfigure={Boolean(user?.is_admin)} />}
    {activeTab === 'activity' && <StaffActivityFeed cohort={cohort} />}
    {activeTab === 'recordings' && <section className="app-surface p-5 sm:p-6"><h2 className="mb-4 text-lg font-bold text-ink">Class recordings</h2><RecordingUploadManager key={cohort.id} cohortId={cohort.id} /></section>}
    {activeTab === 'insights' && <Insights cohort={cohort} insights={insights} loading={insightsLoading} error={insightsError} onRetry={() => void loadInsights()} />}
    {activeTab === 'schedule' && <div className="space-y-8"><CohortScheduleManager key={cohort.id} cohortId={cohort.id} canManage={Boolean(home?.permissions?.can_manage_schedule)} canManageLearningSchedule={Boolean(user?.is_admin && home?.permissions?.can_manage_learning_schedule)} /><StaffPrivateMeetings key={cohort.id} cohortId={cohort.id} /></div>}
    {activeTab === 'communication' && <Communication cohort={cohort} home={home} />}
    {activeTab === 'team' && user?.is_admin && <CohortTeachingTeam cohortId={cohort.id} />}
  </div>
}

function Communication({ cohort, home }: { cohort: CohortDetail; home: CohortHome | null }) {
  return <div className="grid gap-4 lg:grid-cols-2">
    <section className="app-surface p-5 sm:p-6"><p className="text-xs font-semibold text-ink-muted">Conversation</p><h2 className="mt-2 text-lg font-bold text-ink">Class messages</h2><p className="mt-2 text-sm leading-6 text-ink-secondary">Open this cohort’s channels and conversations.</p><LinkButton to={`/messages?workspace_id=${home?.cohort.workspace_id || ''}`} className="mt-5"><MessageSquareText className="h-4 w-4" />Open messages</LinkButton></section>
    <section className="app-surface p-5 sm:p-6"><p className="text-xs font-semibold text-ink-muted">Announcements</p><h2 className="mt-2 text-lg font-bold text-ink">Updates for this cohort</h2><div className="mt-4 space-y-2">{home?.recent_announcements.length ? home.recent_announcements.map((announcement) => <Link key={announcement.id} to={`/announcements/${announcement.id}`} className="pressable block min-h-11 truncate rounded-xl border border-line p-3 text-sm font-semibold text-ink hover:border-line-strong hover:bg-surface-sunken" title={announcement.title}>{announcement.title}</Link>) : <p className="text-sm text-ink-muted">No cohort announcements yet.</p>}</div><Link to={`/announcements?scope=manage&audience=cohort&cohort_id=${cohort.id}`} className="app-link mt-4 inline-flex min-h-11 items-center gap-2 text-sm">Manage announcements <ArrowRight className="h-4 w-4" /></Link></section>
  </div>
}

function Overview({ cohort }: { cohort: CohortDetail }) {
  const assigned = cohort.modules.filter((module) => module.assigned)
  const occurrences = cohort.office_hour_occurrences || []
  return <div className="space-y-6"><section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric value={cohort.students.length} label="enrolled students" /><Metric value={assigned.length} label="assigned modules" /><Metric value={cohort.uploaded_recordings_count || 0} label="uploaded recordings" /><Metric value={occurrences.length} label="upcoming sessions" /></section><div className="grid gap-6 lg:grid-cols-2"><section className="app-surface p-5 sm:p-6"><div className="flex items-center justify-between"><h2 className="text-lg font-bold text-ink">Students</h2><Link className="app-link inline-flex min-h-11 items-center text-sm" to={`/admin/cohorts/${cohort.id}?tab=students`}>View all</Link></div><div className="mt-4 space-y-2">{cohort.students.slice(0, 5).map((student) => <Link key={student.enrollment_id} to={cohortStudentPath(cohort.id, student.user_id)} className="pressable flex min-h-14 items-center justify-between gap-3 rounded-xl border border-line px-3 hover:border-line-strong hover:bg-surface-sunken"><div className="flex min-w-0 items-center gap-3"><Avatar name={student.full_name || student.email} size="sm" /><div className="min-w-0"><p className="truncate text-sm font-semibold text-ink" title={student.full_name || student.email}>{student.full_name || student.email}</p><p className="truncate text-xs text-ink-muted" title={student.email}>{student.email}</p></div></div><ArrowRight className="h-4 w-4 shrink-0 text-ink-muted" /></Link>)}</div></section><section className="app-surface p-5 sm:p-6"><div className="flex items-center justify-between"><h2 className="text-lg font-bold text-ink">What’s next</h2><Link className="app-link inline-flex min-h-11 items-center text-sm" to={`/admin/cohorts/${cohort.id}?tab=schedule`}>Schedule</Link></div><div className="mt-4 space-y-3">{occurrences.length ? occurrences.slice(0, 4).map((occurrence, index) => <div key={`${occurrence.office_hour_id}-${occurrence.starts_at}-${index}`} className="min-w-0 rounded-xl border border-line p-3"><p className="truncate text-sm font-semibold text-ink" title={occurrence.title}>{occurrence.title}</p><p className="mt-1 text-xs tabular-nums text-ink-muted">{formatDateTimeRange(occurrence.starts_at, occurrence.ends_at, 'Not scheduled', occurrence.timezone)}</p></div>) : <p className="text-sm text-ink-muted">No live sessions scheduled.</p>}</div></section></div><section className="app-surface-muted p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-base font-semibold text-ink">Operate from connected records</p><p className="mt-1 text-sm text-ink-secondary">Choose a student to see learning, work, support, messages, and access without losing this cohort context.</p></div>{cohort.students[0] && <LinkButton variant="secondary" className="shrink-0" to={cohortStudentPath(cohort.id, cohort.students[0].user_id)}><Users className="h-4 w-4" />Open first student</LinkButton>}</div></section></div>
}

function Students({ cohort }: { cohort: CohortDetail }) {
  const { user } = useAuthContext()
  const [github, setGithub] = useState<GithubAccessResponse | null>(null)
  const [githubError, setGithubError] = useState<string | null>(null)
  const [githubLoading, setGithubLoading] = useState(false)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const loadGithub = useCallback(async () => {
    if (!cohort.github_organization_name) return
    setGithubLoading(true)
    const result = await api.getCohortGithubAccess(cohort.id)
    if (result.data && !result.error && !result.fromCache) { setGithub(result.data); setGithubError(null) }
    else { setGithub(null); setFilter('all'); setGithubError(result.error || 'Could not check GitHub access.') }
    setGithubLoading(false)
  }, [cohort.id, cohort.github_organization_name])
  useEffect(() => { void loadGithub() }, [loadGithub])

  const status = (id: number): GithubAccessStatus | 'unavailable' => github?.statuses[String(id)] || 'unavailable'
  const visible = cohort.students.filter((student) => {
    const text = `${student.full_name} ${student.email} ${student.github_username || ''}`.toLowerCase()
    const matchesFilter = filter === 'all' ||
      (filter === 'cohort_joined' && Boolean(student.joined_at)) ||
      (filter === 'cohort_not_opened' && !student.joined_at) ||
      (filter === 'app_pending' && !student.last_sign_in_at) ||
      (filter === 'github_member' && status(student.user_id) === 'member') ||
      (filter === 'github_invited' && status(student.user_id) === 'invited') ||
      (filter === 'github_followup' && ['not_invited', 'username_missing'].includes(status(student.user_id)))
    return matchesFilter && text.includes(search.trim().toLowerCase())
  })
  const githubLabels: Record<GithubAccessStatus | 'unavailable', string> = { member: 'Joined GitHub org', invited: 'GitHub invite pending', not_invited: 'No current GitHub invite', username_missing: 'GitHub username needed', unavailable: 'GitHub status unavailable' }
  const githubTones: Record<GithubAccessStatus | 'unavailable', BadgeTone> = { member: 'success', invited: 'pending', not_invited: 'warning', username_missing: 'warning', unavailable: 'neutral' }
  if (!cohort.students.length) return <EmptyState icon={Users} title="No students enrolled" description="Use Manage cohort to add a student." />
  return <section className="app-surface overflow-hidden">
    <div className="border-b border-line px-5 py-5 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-bold text-ink">Access and invitations</h2><p className="mt-1 text-sm text-ink-secondary">Cohort entry, app account invitation, and GitHub membership are tracked separately.</p></div><div className="flex flex-wrap gap-2">{user?.is_admin && <LinkButton to={`/admin/cohorts/${cohort.id}/settings#students`}>Invite students</LinkButton>}{cohort.github_organization_name && <Button variant="secondary" onClick={() => void loadGithub()} disabled={githubLoading}><RefreshCw className="h-4 w-4" />{githubLoading ? 'Checking…' : 'Refresh GitHub'}</Button>}</div></div>
      {githubError && <p role="status" className="mt-3 rounded-xl border border-warning-200 bg-warning-50 p-3 text-sm text-warning-800">{githubError} App statuses are still available.</p>}
      {!cohort.github_organization_name && <p className="mt-3 text-sm text-ink-muted">No GitHub organization is configured for this cohort.</p>}
      {github && <p className="mt-2 text-xs tabular-nums text-ink-muted">GitHub checked {formatShortDateTime(github.checked_at, '—')} · {github.organization}</p>}
      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4"><div className="rounded-xl border border-line bg-surface-sunken px-4 py-3"><p className="text-xl font-bold tabular-nums text-ink">{cohort.students.filter((student) => student.joined_at).length}</p><p className="text-xs font-semibold text-ink-secondary">joined cohort</p></div><div className="rounded-xl border border-warning-200 bg-warning-50 px-4 py-3"><p className="text-xl font-bold tabular-nums text-warning-900">{cohort.students.filter((student) => !student.joined_at).length}</p><p className="text-xs font-semibold text-warning-800">added, not yet opened</p></div><div className="rounded-xl border border-line bg-surface-sunken px-4 py-3"><p className="text-xl font-bold tabular-nums text-ink">{cohort.students.filter((student) => student.last_sign_in_at).length}</p><p className="text-xs font-semibold text-ink-secondary">signed in to app</p></div><div className="rounded-xl border border-line bg-surface-sunken px-4 py-3"><p className="text-xl font-bold tabular-nums text-ink">{github ? cohort.students.filter((student) => status(student.user_id) === 'member').length : '—'}</p><p className="text-xs font-semibold text-ink-secondary">joined GitHub org</p></div></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]"><label className="relative"><span className="sr-only">Search enrolled students</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, email, or GitHub username" className="app-control w-full" /></label><label><span className="sr-only">Filter access status</span><select value={filter} onChange={(event) => setFilter(event.target.value)} className="app-control w-full"><option value="all">All enrolled</option><option value="cohort_joined">Joined cohort</option><option value="cohort_not_opened">Added, not yet opened</option><option value="app_pending">Not signed in to app</option><option value="github_member" disabled={!github}>Joined GitHub org</option><option value="github_invited" disabled={!github}>GitHub invite pending</option><option value="github_followup" disabled={!github}>GitHub follow-up needed</option></select></label></div>
      <p aria-live="polite" className="mt-3 text-xs font-semibold tabular-nums text-ink-muted">Showing {visible.length} of {cohort.students.length} enrolled</p>
    </div>
    <div className="divide-y divide-line">{visible.map((student) => { const githubStatus = status(student.user_id); const appLabel = student.last_sign_in_at ? 'Signed in to app' : student.invite_pending ? `App invite ${student.invite_delivery_status === 'failed' ? 'failed' : student.invite_delivery_status === 'queued' ? 'queued' : student.invite_delivery_status === 'not_sent' ? 'not sent' : 'sent'}` : 'App account ready · no sign-in'; return <div key={student.enrollment_id} className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-6"><div className="flex min-w-0 items-start gap-3"><Avatar name={student.full_name || student.email} size="sm" className="mt-0.5" /><div className="min-w-0"><Link to={cohortStudentPath(cohort.id, student.user_id)} className="block truncate font-semibold text-ink hover:text-ruby-700 hover:underline" title={student.full_name || student.email}>{student.full_name || student.email}</Link><p className="truncate text-sm text-ink-muted" title={student.email}>{student.email}{student.github_username ? ` · @${student.github_username}` : ''}</p><div className="mt-2 flex flex-wrap gap-2"><Badge tone={student.joined_at ? 'success' : 'warning'}>{student.joined_at ? 'Joined cohort' : 'Added, not yet opened'}</Badge><Badge tone={student.last_sign_in_at ? 'neutral' : student.invite_delivery_status === 'failed' ? 'danger' : 'warning'}>{appLabel}</Badge>{cohort.github_organization_name && <Badge tone={githubTones[githubStatus]}>{githubLabels[githubStatus]}</Badge>}</div></div></div><div className="flex shrink-0 flex-wrap gap-2"><LinkButton variant="secondary" size="sm" to={`/admin/cohorts/${cohort.id}/student-view?student_id=${student.user_id}`}><Eye className="h-4 w-4" />Preview</LinkButton><LinkButton variant="secondary" size="sm" to={cohortStudentPath(cohort.id, student.user_id, 'communication')}><MessageSquareText className="h-4 w-4" />Messages</LinkButton></div></div> })}{!visible.length && <p className="px-5 py-8 text-sm text-ink-muted">No students match this search and filter.</p>}</div>
  </section>
}

function Learning({ cohort, canConfigure }: { cohort: CohortDetail; canConfigure: boolean }) {
  return <div className="space-y-4"><section className="app-surface-muted flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><h2 className="text-lg font-bold text-ink">{cohort.curriculum_name}</h2><p className="mt-1 text-sm text-ink-secondary">Review assigned modules and access facts. Administrators manage cohort release dates and access settings.</p></div><div className="flex shrink-0 flex-wrap gap-2"><LinkButton variant="secondary" to={`/admin/cohorts/${cohort.id}/watch-progress`}><PlayCircle className="h-4 w-4" />Watch progress</LinkButton>{canConfigure && <LinkButton to={`/admin/cohorts/${cohort.id}/settings#curriculum`}><Settings2 className="h-4 w-4" />Configure learning</LinkButton>}</div></section>{cohort.modules.map((module) => <section key={module.id} className="app-surface p-5"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><h3 className="text-base font-semibold text-ink">{module.name}</h3><p className="mt-1 text-sm tabular-nums text-ink-muted">{module.lessons_count} lessons · {module.assigned_count} students assigned</p></div><Badge tone={module.assigned ? 'success' : 'neutral'}>{module.assigned ? 'Assigned' : 'Not assigned'}</Badge></div></section>)}</div>
}

function Insights({ cohort, insights, loading, error, onRetry }: { cohort: CohortDetail; insights: LearningInsights | null; loading: boolean; error: string | null; onRetry: () => void }) {
  if (loading && !insights) return <LoadingSpinner message="Building explainable learning evidence…" />
  if (!insights) return <EmptyState icon={BarChart3} title="Could not load learning evidence" description={error || 'Evidence is unavailable.'} action={<Button onClick={onRetry}><RefreshCw className="h-4 w-4" />Try again</Button>} />
  if (!insights.objectives.length && !insights.revision_patterns.length) return <details className="app-surface overflow-hidden"><summary className="min-h-11 cursor-pointer px-5 py-4 text-sm font-semibold text-ink">No learning evidence yet</summary><p className="border-t border-line px-5 py-4 text-sm leading-6 text-ink-secondary">No objective evidence or revision patterns are recorded for this cohort. Learning insights uses rubric ratings, aligned reviews, and objective-linked checks; it does not treat watch time or completion as proof of understanding.</p></details>
  const returnTo = `/admin/cohorts/${cohort.id}?tab=insights`
  return <div className="space-y-6">
    <section className="rounded-2xl border border-info-200 bg-info-50 p-5 sm:p-6"><div className="flex gap-3"><Target className="mt-0.5 h-6 w-6 shrink-0 text-info-700" /><div><h2 className="text-base font-semibold text-ink">Evidence, not an automated verdict</h2><p className="mt-1 text-sm leading-6 text-info-800">Statuses come only from rubric ratings, graded aligned submissions, and objective-linked retrieval checks. Completion, watch time, and message activity are excluded. Nothing here changes a grade, unlock, or learner record automatically.</p><details className="mt-3"><summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-info-800">How the working rule is calculated</summary><dl className="grid gap-2 pb-2 text-xs leading-5 text-info-800 sm:grid-cols-2"><Rule label="Demonstrated" value={insights.rule.demonstrated} /><Rule label="Needs revision" value={insights.rule.needs_revision} /><Rule label="Developing" value={insights.rule.developing} /><Rule label="Not evidenced" value={insights.rule.not_evidenced} /></dl></details></div></div></section>

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><Metric value={insights.summary.objective_count} label="objectives" /><Metric value={insights.summary.demonstrated_count} label="demonstrated records" /><Metric value={insights.summary.developing_count} label="developing records" /><Metric value={insights.summary.needs_revision_count} label="need revision" /><Metric value={insights.summary.revision_pattern_count} label="revision patterns" /></section>

    <section className="app-surface overflow-hidden"><div className="border-b border-line px-5 py-4 sm:px-6"><p className="text-xs font-semibold text-ink-muted">Objective evidence</p><h2 className="mt-1 text-lg font-bold text-ink">From cohort signal to source record</h2><p className="mt-1 text-sm text-ink-muted">Expand an objective, then open a learner or the exact submission that supports the status.</p></div>{insights.objectives.length ? <div className="divide-y divide-line">{insights.objectives.map((objective) => <details key={objective.id} className="group"><summary className="cursor-pointer list-none px-5 py-5 sm:px-6"><div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px_auto] lg:items-center"><div><div className="flex flex-wrap items-center gap-2"><span className="rounded-lg bg-surface-sunken px-2 py-1 font-mono text-xs font-semibold text-ink-secondary">{objective.code}</span><h3 className="text-base font-semibold text-ink">{objective.title}</h3></div><p className="mt-2 text-sm leading-6 text-ink-secondary">{objective.success_criteria}</p></div><div><ProgressBar value={objective.demonstrated_percentage} size="sm" /><p className="mt-1 text-xs font-semibold tabular-nums text-ink-muted">{objective.demonstrated_count} of {objective.learner_count} demonstrated</p></div><ArrowRight className="h-4 w-4 rotate-90 text-ink-muted transition-transform duration-150 group-open:-rotate-90" /></div></summary><div className="border-t border-line bg-surface-sunken px-5 py-4 sm:px-6"><div className="mb-4 flex flex-wrap gap-2"><EvidencePill status="demonstrated" count={objective.status_counts.demonstrated} /><EvidencePill status="developing" count={objective.status_counts.developing} /><EvidencePill status="needs_revision" count={objective.status_counts.needs_revision} /><EvidencePill status="not_evidenced" count={objective.status_counts.not_evidenced} /></div><div className="grid gap-2">{objective.students.map((student) => <div key={student.enrollment_id} className="rounded-xl border border-line bg-surface-raised p-3"><div className="flex flex-wrap items-center justify-between gap-3"><Link to={`${cohortStudentPath(cohort.id, student.user.id, 'learning')}?objective=${objective.id}`} className="inline-flex min-h-11 min-w-0 items-center gap-2 font-semibold text-ink hover:text-ruby-700 hover:underline" title={student.user.full_name}><Avatar name={student.user.full_name} size="sm" /><span className="truncate">{student.user.full_name}</span></Link><EvidencePill status={student.status} /></div>{student.evidence.length ? <div className="mt-3 flex flex-wrap gap-2">{student.evidence.slice(0, 4).map((evidence) => evidence.submission_id ? <Link key={evidence.id} to={submissionPath(evidence.submission_id, { cohortId: cohort.id, userId: student.user.id, returnTo })} className="pressable inline-flex min-h-11 items-center gap-2 rounded-xl border border-line px-3 text-xs font-semibold text-ink-secondary hover:border-line-strong hover:bg-surface-sunken hover:text-ink"><EvidenceIcon kind={evidence.kind} />{evidence.label} · {evidence.value}{evidence.github_checks?.failed ? <span className="tabular-nums text-danger-700">{evidence.github_checks.failed} failed check{evidence.github_checks.failed === 1 ? '' : 's'}</span> : null}</Link> : <Link key={evidence.id} to={`${cohortStudentPath(cohort.id, student.user.id, 'learning')}?objective=${objective.id}`} className="pressable inline-flex min-h-11 items-center gap-2 rounded-xl border border-line px-3 text-xs font-semibold text-ink-secondary hover:border-line-strong hover:bg-surface-sunken hover:text-ink"><EvidenceIcon kind={evidence.kind} />{evidence.label} · {evidence.value}</Link>)}</div> : <p className="mt-2 text-xs text-ink-muted">No objective evidence recorded yet.</p>}</div>)}</div></div></details>)}</div> : <p className="px-6 py-8 text-center text-sm text-ink-muted">No active objectives are configured for this curriculum.</p>}</section>

    <section className="app-surface overflow-hidden"><div className="border-b border-line px-5 py-4 sm:px-6"><p className="text-xs font-semibold text-ink-muted">Curriculum review</p><h2 className="mt-1 text-lg font-bold text-ink">Revision and test patterns</h2><p className="mt-1 text-sm text-ink-muted">Counts describe current work records—not learner risk. Every affected count opens the exact submission.</p></div>{insights.revision_patterns.length ? <div className="divide-y divide-line">{insights.revision_patterns.map((pattern) => <div key={pattern.content_block.id} className="px-5 py-5 sm:px-6"><div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]"><div><h3 className="text-base font-semibold text-ink">{pattern.content_block.title}</h3><p className="mt-1 text-sm text-ink-muted">{pattern.module.name} · {pattern.lesson.title}</p></div><div className="flex flex-wrap gap-2"><Signal label={`${pattern.open_redo_count} open redo`} tone={pattern.open_redo_count ? 'amber' : 'slate'} /><Signal label={`${pattern.repeat_attempt_count} repeat attempt`} tone={pattern.repeat_attempt_count ? 'amber' : 'slate'} /><Signal label={`${pattern.failed_check_count} failed check`} tone={pattern.failed_check_count ? 'red' : 'slate'} /></div></div><div className="mt-4 flex flex-wrap gap-2">{pattern.records.map((record) => <Link key={record.submission_id} to={submissionPath(record.submission_id, { cohortId: cohort.id, userId: record.user.id, returnTo })} className="pressable inline-flex min-h-11 items-center gap-2 rounded-xl border border-line px-3 text-xs font-semibold text-ink-secondary hover:border-line-strong hover:bg-surface-sunken hover:text-ink"><Users className="h-4 w-4" />{record.user.full_name}<span className="tabular-nums text-ink-muted">Attempt {record.attempt_count}</span><ArrowRight className="h-3.5 w-3.5" /></Link>)}</div></div>)}</div> : <p className="px-6 py-8 text-center text-sm text-ink-muted">No current redo, repeated-attempt, or failed-check patterns.</p>}</section>
  </div>
}

function Rule({ label, value }: { label: string; value: string }) { return <div><dt className="font-semibold">{label}</dt><dd>{value}</dd></div> }
function EvidenceIcon({ kind }: { kind: string }) { const Icon = kind === 'knowledge_check' ? CircleDashed : kind === 'rubric_criterion' ? CheckCircle2 : GitBranch; return <Icon className="h-4 w-4" /> }
function EvidencePill({ status, count }: { status: LearningEvidenceStatus; count?: number }) { const labels = { demonstrated: 'Demonstrated', developing: 'Developing', needs_revision: 'Needs revision', not_evidenced: 'Not evidenced' }; const tones: Record<LearningEvidenceStatus, BadgeTone> = { demonstrated: 'success', developing: 'info', needs_revision: 'warning', not_evidenced: 'neutral' }; return <Badge tone={tones[status]} className="tabular-nums">{count !== undefined ? `${count} ` : ''}{labels[status]}</Badge> }
function Signal({ label, tone }: { label: string; tone: 'red' | 'amber' | 'slate' }) { const tones: Record<typeof tone, BadgeTone> = { red: 'danger', amber: 'warning', slate: 'neutral' }; return <Badge tone={tones[tone]} className="tabular-nums" icon={tone === 'red' ? <AlertTriangle className="h-3.5 w-3.5" /> : undefined}>{label}</Badge> }

function Metric({ value, label }: { value: number; label: string }) { return <div className="app-surface p-5"><p className="text-3xl font-bold tabular-nums text-ink">{value}</p><p className="mt-1 text-sm font-semibold text-ink-muted">{label}</p></div> }
