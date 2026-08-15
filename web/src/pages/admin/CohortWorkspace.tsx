import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, BookOpen, CalendarDays, Eye, GraduationCap, MessageSquareText, PlayCircle, Settings2, Users } from 'lucide-react'
import { api } from '../../lib/api'
import { cohortStudentPath } from '../../lib/routes'
import { formatShortDateTime } from '../../lib/format'
import { EmptyState } from '../../components/shared/EmptyState'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import type { CohortDetail } from '../../types/api'

type CohortTab = 'overview' | 'students' | 'learning' | 'schedule'
const tabs: Array<{ id: CohortTab; label: string; icon: typeof Users }> = [
  { id: 'overview', label: 'Overview', icon: GraduationCap },
  { id: 'students', label: 'Students', icon: Users },
  { id: 'learning', label: 'Learning', icon: BookOpen },
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

function Schedule({ cohort }: { cohort: CohortDetail }) {
  const occurrences = cohort.office_hour_occurrences || []
  return <div className="space-y-4"><div className="flex justify-end"><Link to={`/admin/cohorts/${cohort.id}/settings#schedule`} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-bold text-white"><Settings2 className="h-4 w-4" />Manage schedule</Link></div>{occurrences.length ? <section className="app-surface divide-y divide-slate-100">{occurrences.map((occurrence, index) => <div key={`${occurrence.office_hour_id}-${occurrence.starts_at}-${index}`} className="flex items-start gap-3 px-5 py-4"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700"><CalendarDays className="h-5 w-5" /></span><div><p className="font-extrabold text-slate-950">{occurrence.title}</p><p className="mt-1 text-sm text-slate-500">{formatShortDateTime(occurrence.starts_at, 'Not scheduled', occurrence.timezone)} · {occurrence.event_kind === 'live_class' ? 'Live class' : 'Office hours'}</p></div></div>)}</section> : <EmptyState icon={CalendarDays} title="No sessions scheduled" description="Add live classes or office hours from Manage cohort." />}</div>
}
function Metric({ value, label }: { value: number; label: string }) { return <div className="app-surface p-5"><p className="text-3xl font-extrabold tabular-nums text-slate-950">{value}</p><p className="mt-1 text-sm font-bold text-slate-500">{label}</p></div> }
