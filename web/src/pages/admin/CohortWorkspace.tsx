import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, ArrowRight, BarChart3, BookOpen, CalendarDays, CheckCircle2, CircleDashed, Eye, GitBranch, GraduationCap, MessageSquareText, PlayCircle, RefreshCw, Settings2, Target, Users } from 'lucide-react'
import { api } from '../../lib/api'
import { cohortStudentPath, submissionPath } from '../../lib/routes'
import { formatShortDateTime } from '../../lib/format'
import { EmptyState } from '../../components/shared/EmptyState'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { ProgressBar } from '../../components/shared/ProgressBar'
import { Button } from '../../components/ui/Button'
import type { CohortDetail, LearningInsights, LearningEvidenceStatus } from '../../types/api'

type CohortTab = 'overview' | 'students' | 'learning' | 'insights' | 'schedule'
const tabs: Array<{ id: CohortTab; label: string; icon: typeof Users }> = [
  { id: 'overview', label: 'Overview', icon: GraduationCap },
  { id: 'students', label: 'Students', icon: Users },
  { id: 'learning', label: 'Learning', icon: BookOpen },
  { id: 'insights', label: 'Evidence', icon: BarChart3 },
  { id: 'schedule', label: 'Schedule', icon: CalendarDays },
]

export function CohortWorkspace() {
  const { id } = useParams<{ id: string }>()
  const cohortId = Number(id)
  const [searchParams] = useSearchParams()
  const requestedTab = searchParams.get('tab')
  const activeTab = tabs.some((tab) => tab.id === requestedTab) ? requestedTab as CohortTab : 'overview'
  const [cohort, setCohort] = useState<CohortDetail | null>(null)
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
    return () => { active = false }
  }, [cohortId])

  const loadInsights = useCallback(async () => {
    setInsightsLoading(true)
    setInsightsError(null)
    const result = await api.getLearningInsights(cohortId)
    if (result.data) setInsights(result.data.learning_insights)
    else setInsightsError(result.error || 'Could not load learning evidence.')
    setInsightsLoading(false)
  }, [cohortId])

  useEffect(() => {
    if (activeTab === 'insights' && !insights && !insightsLoading) void loadInsights()
  }, [activeTab, insights, insightsLoading, loadInsights])

  const activeStudents = useMemo(() => cohort?.students.filter((student) => student.status === 'active') || [], [cohort])
  if (loading) return <LoadingSpinner message="Loading cohort workspace…" />
  if (!cohort || error) return <EmptyState icon={Users} title="Could not open cohort" description={error || 'This cohort is unavailable.'} />

  return <div className="app-page-wide space-y-6">
    <header>
      <Link to="/admin/cohorts" className="app-link inline-flex min-h-11 items-center gap-1 text-sm font-bold"><ArrowLeft className="h-4 w-4" />Cohorts</Link>
      <div className="mt-2 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div><div className="flex flex-wrap items-center gap-3"><h1 className="app-title">{cohort.name}</h1><span className={`rounded-full px-2.5 py-1 text-xs font-bold capitalize ${cohort.status === 'active' ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-600'}`}>{cohort.status}</span></div><p className="app-description mt-2">{cohort.curriculum_name} · {activeStudents.length} active student{activeStudents.length === 1 ? '' : 's'}</p></div><div className="flex flex-wrap gap-2"><Link to={`/admin/cohorts/${cohort.id}/student-view${activeStudents[0] ? `?student_id=${activeStudents[0].user_id}` : ''}`} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 hover:border-primary-300 hover:text-primary-700"><Eye className="h-4 w-4" />Preview student view</Link><Link to={`/admin/cohorts/${cohort.id}/settings`} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-bold text-white hover:bg-slate-800"><Settings2 className="h-4 w-4" />Manage cohort</Link></div></div>
    </header>

    <nav aria-label="Cohort workspace sections" className="overflow-x-auto border-b border-slate-200"><div className="flex min-w-max gap-1">{tabs.map(({ id: tabId, label, icon: Icon }) => <Link key={tabId} to={tabId === 'overview' ? `/admin/cohorts/${cohort.id}` : `/admin/cohorts/${cohort.id}?tab=${tabId}`} aria-current={activeTab === tabId ? 'page' : undefined} className={`inline-flex min-h-11 items-center gap-2 border-b-2 px-4 text-sm font-extrabold ${activeTab === tabId ? 'border-primary-600 text-primary-700' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-900'}`}><Icon className="h-4 w-4" />{label}</Link>)}</div></nav>

    {activeTab === 'overview' && <Overview cohort={cohort} />}
    {activeTab === 'students' && <Students cohort={cohort} />}
    {activeTab === 'learning' && <Learning cohort={cohort} />}
    {activeTab === 'insights' && <Insights cohort={cohort} insights={insights} loading={insightsLoading} error={insightsError} onRetry={() => void loadInsights()} />}
    {activeTab === 'schedule' && <Schedule cohort={cohort} />}
  </div>
}

function Overview({ cohort }: { cohort: CohortDetail }) {
  const assigned = cohort.modules.filter((module) => module.assigned)
  const occurrences = cohort.office_hour_occurrences || []
  return <div className="space-y-6"><section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric value={cohort.students.length} label="enrolled students" /><Metric value={assigned.length} label="assigned modules" /><Metric value={cohort.uploaded_recordings_count || 0} label="uploaded recordings" /><Metric value={occurrences.length} label="upcoming sessions" /></section><div className="grid gap-6 lg:grid-cols-2"><section className="app-surface p-5 sm:p-6"><div className="flex items-center justify-between"><h2 className="text-lg font-extrabold text-slate-950">Students</h2><Link className="app-link text-sm" to={`/admin/cohorts/${cohort.id}?tab=students`}>View all</Link></div><div className="mt-4 space-y-2">{cohort.students.slice(0, 5).map((student) => <Link key={student.enrollment_id} to={cohortStudentPath(cohort.id, student.user_id)} className="flex min-h-14 items-center justify-between rounded-xl border border-slate-200 px-3 hover:border-primary-300 hover:bg-primary-50"><div className="min-w-0"><p className="truncate text-sm font-bold text-slate-900">{student.full_name || student.email}</p><p className="truncate text-xs text-slate-500">{student.email}</p></div><ArrowRight className="h-4 w-4 text-slate-400" /></Link>)}</div></section><section className="app-surface p-5 sm:p-6"><div className="flex items-center justify-between"><h2 className="text-lg font-extrabold text-slate-950">What’s next</h2><Link className="app-link text-sm" to={`/admin/cohorts/${cohort.id}?tab=schedule`}>Schedule</Link></div><div className="mt-4 space-y-3">{occurrences.length ? occurrences.slice(0, 4).map((occurrence, index) => <div key={`${occurrence.office_hour_id}-${occurrence.starts_at}-${index}`} className="rounded-xl border border-slate-200 p-3"><p className="text-sm font-bold text-slate-900">{occurrence.title}</p><p className="mt-1 text-xs text-slate-500">{formatShortDateTime(occurrence.starts_at, 'Not scheduled', occurrence.timezone)}</p></div>) : <p className="text-sm text-slate-500">No live sessions scheduled.</p>}</div></section></div><section className="rounded-2xl border border-primary-100 bg-primary-50 p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-extrabold text-slate-950">Operate from connected records</p><p className="mt-1 text-sm text-slate-600">Choose a student to see learning, work, support, messages, and access without losing this cohort context.</p></div>{cohort.students[0] && <Link to={cohortStudentPath(cohort.id, cohort.students[0].user_id)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 text-sm font-bold text-white"><Users className="h-4 w-4" />Open first student</Link>}</div></section></div>
}

function Students({ cohort }: { cohort: CohortDetail }) {
  if (!cohort.students.length) return <EmptyState icon={Users} title="No students enrolled" description="Use Manage cohort to add a student." />
  return <section className="app-surface overflow-hidden"><div className="border-b border-slate-100 px-5 py-4"><h2 className="font-extrabold text-slate-950">Enrolled students</h2><p className="mt-1 text-sm text-slate-500">Each row opens the student’s cohort-scoped workspace.</p></div><div className="divide-y divide-slate-100">{cohort.students.map((student) => <div key={student.enrollment_id} className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><Link to={cohortStudentPath(cohort.id, student.user_id)} className="min-w-0"><p className="truncate font-extrabold text-slate-900 hover:text-primary-700">{student.full_name || student.email}</p><p className="truncate text-sm text-slate-500">{student.email} · {student.status}</p></Link><div className="flex gap-2"><Link to={`/admin/cohorts/${cohort.id}/student-view?student_id=${student.user_id}`} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-bold text-slate-600 hover:border-primary-300"><Eye className="h-4 w-4" />Preview</Link><Link to={cohortStudentPath(cohort.id, student.user_id, 'communication')} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-bold text-slate-600 hover:border-primary-300"><MessageSquareText className="h-4 w-4" />Messages</Link></div></div>)}</div></section>
}

function Learning({ cohort }: { cohort: CohortDetail }) {
  return <div className="space-y-4"><section className="flex flex-col gap-4 rounded-2xl border border-primary-100 bg-primary-50 p-5 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-extrabold text-slate-950">{cohort.curriculum_name}</h2><p className="mt-1 text-sm text-slate-600">Review what is assigned here; use Manage cohort for release dates and access changes.</p></div><div className="flex flex-wrap gap-2"><Link to={`/admin/cohorts/${cohort.id}/watch-progress`} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-primary-200 bg-white px-3 text-sm font-bold text-primary-700"><PlayCircle className="h-4 w-4" />Watch progress</Link><Link to={`/admin/cohorts/${cohort.id}/settings#curriculum`} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-900 px-3 text-sm font-bold text-white"><Settings2 className="h-4 w-4" />Configure learning</Link></div></section>{cohort.modules.map((module) => <section key={module.id} className="app-surface p-5"><div className="flex items-start justify-between gap-4"><div><h3 className="font-extrabold text-slate-950">{module.name}</h3><p className="mt-1 text-sm text-slate-500">{module.lessons_count} lessons · {module.assigned_count} students assigned</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${module.assigned ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'}`}>{module.assigned ? 'Assigned' : 'Not assigned'}</span></div></section>)}</div>
}

function Insights({ cohort, insights, loading, error, onRetry }: { cohort: CohortDetail; insights: LearningInsights | null; loading: boolean; error: string | null; onRetry: () => void }) {
  if (loading && !insights) return <LoadingSpinner message="Building explainable learning evidence…" />
  if (!insights) return <EmptyState icon={BarChart3} title="Could not load learning evidence" description={error || 'Evidence is unavailable.'} action={<Button onClick={onRetry}><RefreshCw className="h-4 w-4" />Try again</Button>} />
  const returnTo = `/admin/cohorts/${cohort.id}?tab=insights`
  return <div className="space-y-6">
    <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5 sm:p-6"><div className="flex gap-3"><Target className="mt-0.5 h-6 w-6 shrink-0 text-blue-700" /><div><h2 className="font-extrabold text-blue-950">Evidence, not an automated verdict</h2><p className="mt-1 text-sm leading-6 text-blue-900">Statuses come only from rubric ratings, graded aligned submissions, and objective-linked retrieval checks. Completion, watch time, and message activity are excluded. Nothing here changes a grade, unlock, or learner record automatically.</p><details className="mt-3"><summary className="min-h-11 cursor-pointer text-sm font-bold text-blue-800">How the working rule is calculated</summary><dl className="grid gap-2 pb-2 text-xs leading-5 text-blue-900 sm:grid-cols-2"><Rule label="Demonstrated" value={insights.rule.demonstrated} /><Rule label="Needs revision" value={insights.rule.needs_revision} /><Rule label="Developing" value={insights.rule.developing} /><Rule label="Not evidenced" value={insights.rule.not_evidenced} /></dl></details></div></div></section>

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><Metric value={insights.summary.objective_count} label="objectives" /><Metric value={insights.summary.demonstrated_count} label="demonstrated records" /><Metric value={insights.summary.developing_count} label="developing records" /><Metric value={insights.summary.needs_revision_count} label="need revision" /><Metric value={insights.summary.revision_pattern_count} label="revision patterns" /></section>

    <section className="app-surface overflow-hidden"><div className="border-b border-slate-100 px-5 py-4 sm:px-6"><p className="app-eyebrow">Objective evidence</p><h2 className="mt-1 text-lg font-extrabold text-slate-950">From cohort signal to source record</h2><p className="mt-1 text-sm text-slate-500">Expand an objective, then open a learner or the exact submission that supports the status.</p></div>{insights.objectives.length ? <div className="divide-y divide-slate-100">{insights.objectives.map((objective) => <details key={objective.id} className="group"><summary className="cursor-pointer list-none px-5 py-5 sm:px-6"><div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px_auto] lg:items-center"><div><div className="flex flex-wrap items-center gap-2"><span className="rounded-lg bg-slate-100 px-2 py-1 font-mono text-xs font-extrabold text-slate-700">{objective.code}</span><h3 className="font-extrabold text-slate-950">{objective.title}</h3></div><p className="mt-2 text-sm leading-6 text-slate-600">{objective.success_criteria}</p></div><div><ProgressBar value={objective.demonstrated_percentage} size="sm" /><p className="mt-1 text-xs font-bold text-slate-500">{objective.demonstrated_count} of {objective.learner_count} demonstrated</p></div><ArrowRight className="h-4 w-4 rotate-90 text-slate-400 transition group-open:-rotate-90" /></div></summary><div className="border-t border-slate-100 bg-slate-50/60 px-5 py-4 sm:px-6"><div className="mb-4 flex flex-wrap gap-2"><EvidencePill status="demonstrated" count={objective.status_counts.demonstrated} /><EvidencePill status="developing" count={objective.status_counts.developing} /><EvidencePill status="needs_revision" count={objective.status_counts.needs_revision} /><EvidencePill status="not_evidenced" count={objective.status_counts.not_evidenced} /></div><div className="grid gap-2">{objective.students.map((student) => <div key={student.enrollment_id} className="rounded-xl border border-slate-200 bg-white p-3"><div className="flex flex-wrap items-center justify-between gap-3"><Link to={`${cohortStudentPath(cohort.id, student.user.id, 'learning')}?objective=${objective.id}`} className="font-extrabold text-slate-900 hover:text-primary-700">{student.user.full_name}</Link><EvidencePill status={student.status} /></div>{student.evidence.length ? <div className="mt-3 flex flex-wrap gap-2">{student.evidence.slice(0, 4).map((evidence) => evidence.submission_id ? <Link key={evidence.id} to={submissionPath(evidence.submission_id, { cohortId: cohort.id, userId: student.user.id, returnTo })} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-bold text-slate-700 hover:border-primary-300 hover:text-primary-700"><EvidenceIcon kind={evidence.kind} />{evidence.label} · {evidence.value}{evidence.github_checks?.failed ? <span className="text-red-700">{evidence.github_checks.failed} failed check{evidence.github_checks.failed === 1 ? '' : 's'}</span> : null}</Link> : <Link key={evidence.id} to={`${cohortStudentPath(cohort.id, student.user.id, 'learning')}?objective=${objective.id}`} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-bold text-slate-700 hover:border-primary-300 hover:text-primary-700"><EvidenceIcon kind={evidence.kind} />{evidence.label} · {evidence.value}</Link>)}</div> : <p className="mt-2 text-xs text-slate-500">No objective evidence recorded yet.</p>}</div>)}</div></div></details>)}</div> : <p className="px-6 py-8 text-center text-sm text-slate-500">No active objectives are configured for this curriculum.</p>}</section>

    <section className="app-surface overflow-hidden"><div className="border-b border-slate-100 px-5 py-4 sm:px-6"><p className="app-eyebrow">Curriculum review</p><h2 className="mt-1 text-lg font-extrabold text-slate-950">Revision and test patterns</h2><p className="mt-1 text-sm text-slate-500">Counts describe current work records—not learner risk. Every affected count opens the exact submission.</p></div>{insights.revision_patterns.length ? <div className="divide-y divide-slate-100">{insights.revision_patterns.map((pattern) => <div key={pattern.content_block.id} className="px-5 py-5 sm:px-6"><div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]"><div><h3 className="font-extrabold text-slate-950">{pattern.content_block.title}</h3><p className="mt-1 text-sm text-slate-500">{pattern.module.name} · {pattern.lesson.title}</p></div><div className="flex flex-wrap gap-2"><Signal label={`${pattern.open_redo_count} open redo`} tone={pattern.open_redo_count ? 'red' : 'slate'} /><Signal label={`${pattern.repeat_attempt_count} repeat attempt`} tone={pattern.repeat_attempt_count ? 'amber' : 'slate'} /><Signal label={`${pattern.failed_check_count} failed check`} tone={pattern.failed_check_count ? 'red' : 'slate'} /></div></div><div className="mt-4 flex flex-wrap gap-2">{pattern.records.map((record) => <Link key={record.submission_id} to={submissionPath(record.submission_id, { cohortId: cohort.id, userId: record.user.id, returnTo })} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-bold text-slate-700 hover:border-primary-300 hover:text-primary-700"><Users className="h-4 w-4" />{record.user.full_name}<span className="text-slate-400">Attempt {record.attempt_count}</span><ArrowRight className="h-3.5 w-3.5" /></Link>)}</div></div>)}</div> : <p className="px-6 py-8 text-center text-sm text-slate-500">No current redo, repeated-attempt, or failed-check patterns.</p>}</section>
  </div>
}

function Rule({ label, value }: { label: string; value: string }) { return <div><dt className="font-extrabold">{label}</dt><dd>{value}</dd></div> }
function EvidenceIcon({ kind }: { kind: string }) { const Icon = kind === 'knowledge_check' ? CircleDashed : kind === 'rubric_criterion' ? CheckCircle2 : GitBranch; return <Icon className="h-4 w-4" /> }
function EvidencePill({ status, count }: { status: LearningEvidenceStatus; count?: number }) { const labels = { demonstrated: 'Demonstrated', developing: 'Developing', needs_revision: 'Needs revision', not_evidenced: 'Not evidenced' }; const styles = { demonstrated: 'bg-green-50 text-green-700', developing: 'bg-amber-50 text-amber-800', needs_revision: 'bg-red-50 text-red-700', not_evidenced: 'bg-slate-100 text-slate-500' }; return <span className={`rounded-full px-2.5 py-1 text-xs font-extrabold ${styles[status]}`}>{count !== undefined ? `${count} ` : ''}{labels[status]}</span> }
function Signal({ label, tone }: { label: string; tone: 'red' | 'amber' | 'slate' }) { const styles = { red: 'bg-red-50 text-red-700', amber: 'bg-amber-50 text-amber-800', slate: 'bg-slate-100 text-slate-500' }; return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-extrabold ${styles[tone]}`}>{tone === 'red' && <AlertTriangle className="h-3.5 w-3.5" />}{label}</span> }

function Schedule({ cohort }: { cohort: CohortDetail }) {
  const occurrences = cohort.office_hour_occurrences || []
  return <div className="space-y-4"><div className="flex justify-end"><Link to={`/admin/cohorts/${cohort.id}/settings#schedule`} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-bold text-white"><Settings2 className="h-4 w-4" />Manage schedule</Link></div>{occurrences.length ? <section className="app-surface divide-y divide-slate-100">{occurrences.map((occurrence, index) => <div key={`${occurrence.office_hour_id}-${occurrence.starts_at}-${index}`} className="flex items-start gap-3 px-5 py-4"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700"><CalendarDays className="h-5 w-5" /></span><div><p className="font-extrabold text-slate-950">{occurrence.title}</p><p className="mt-1 text-sm text-slate-500">{formatShortDateTime(occurrence.starts_at, 'Not scheduled', occurrence.timezone)} · {occurrence.event_kind === 'live_class' ? 'Live class' : 'Office hours'}</p></div></div>)}</section> : <EmptyState icon={CalendarDays} title="No sessions scheduled" description="Add live classes or office hours from Manage cohort." />}</div>
}
function Metric({ value, label }: { value: number; label: string }) { return <div className="app-surface p-5"><p className="text-3xl font-extrabold tabular-nums text-slate-950">{value}</p><p className="mt-1 text-sm font-bold text-slate-500">{label}</p></div> }
