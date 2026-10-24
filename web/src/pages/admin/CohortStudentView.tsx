import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  Bell,
  BookOpenText,
  ExternalLink,
  LayoutDashboard,
  Link2,
  MessageCircle,
  PlayCircle,
  User,
  WifiOff,
} from 'lucide-react'
import { api } from '../../lib/api'
import { LOGO_SRC, PRODUCT_NAME } from '../../lib/brand'
import type { CohortStudent, CohortStudentView as CohortStudentViewData, StudentProgressResponse } from '../../types/api'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { EmptyState } from '../../components/shared/EmptyState'
import { Dashboard } from '../student/Dashboard'
import { Materials } from '../student/Materials'
import { sanitizeUrl } from '../../lib/sanitizeUrl'
import { formatShortDate } from '../../lib/format'
import { Avatar } from '../../components/ui/Avatar'
import { Badge } from '../../components/ui/Badge'
import { LinkButton } from '../../components/ui/Button'

function formatDate(dateStr?: string | null) {
  return formatShortDate(dateStr, 'Not scheduled')
}

type PreviewSection = 'dashboard' | 'materials' | 'recordings' | 'resources' | 'messages' | 'announcements' | 'profile'

const sectionConfig: Record<PreviewSection, { label: string; icon: typeof LayoutDashboard }> = {
  dashboard: { label: 'Today', icon: LayoutDashboard },
  materials: { label: 'Learn', icon: BookOpenText },
  recordings: { label: 'Recordings', icon: PlayCircle },
  resources: { label: 'Resources', icon: Link2 },
  messages: { label: 'Messages', icon: MessageCircle },
  announcements: { label: 'Updates', icon: Bell },
  profile: { label: 'Profile', icon: User },
}

const sections: PreviewSection[] = ['dashboard', 'materials', 'recordings', 'resources', 'messages', 'announcements', 'profile']

export function previewSectionsForCohort(cohortType?: string): PreviewSection[] {
  return cohortType === 'alumni' ? sections.filter((section) => section !== 'recordings') : sections
}

export function CohortStudentView() {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const studentId = Number(searchParams.get('student_id')) || null
  const [data, setData] = useState<CohortStudentViewData | null>(null)
  const [students, setStudents] = useState<CohortStudent[]>([])
  const [selectedStudent, setSelectedStudent] = useState<CohortStudent | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return

    setLoading(true)
    Promise.all([
      api.getCohortStudentView(Number(id)),
      api.getCohort(Number(id)),
      studentId ? api.getStudentProgress(studentId, Number(id)) : Promise.resolve(null),
    ]).then(([viewResult, cohortResult, progressResult]) => {
      if (viewResult.data?.student_view && cohortResult.data?.cohort) {
        const cohortStudents = cohortResult.data.cohort.students
        const student = studentId ? cohortStudents.find((item) => item.user_id === studentId) || null : null
        setStudents(cohortStudents)
        setSelectedStudent(student)
        if (studentId && !student) {
          setData(null)
          setError('This student is not enrolled in the selected cohort.')
        } else if (student && !progressResult?.data) {
          setData(null)
          setError(progressResult?.error || 'Unable to load this student’s enrollment progress.')
        } else {
          setData(progressResult?.data && student ? mergeStudentProgress(viewResult.data.student_view, progressResult.data) : viewResult.data.student_view)
          setError(null)
        }
      } else {
        setData(null)
        setError(viewResult.error || cohortResult.error || 'Unable to load this cohort student view.')
      }
      setLoading(false)
    })
  }, [id, studentId])

  const activeSection = useMemo<PreviewSection>(() => {
    const tail = location.pathname.split('/student-view/')[1]?.split('/')[0] || 'dashboard'
    const requestedSection = sections.includes(tail as PreviewSection) ? tail as PreviewSection : 'dashboard'
    return previewSectionsForCohort(data?.cohort.cohort_type).includes(requestedSection) ? requestedSection : 'materials'
  }, [data?.cohort.cohort_type, location.pathname])

  useEffect(() => {
    const requestedSection = location.pathname.split('/student-view/')[1]?.split('/')[0]
    if (!data || data.cohort.id !== Number(id) || data.cohort.cohort_type !== 'alumni' || requestedSection !== 'recordings') return

    navigate(
      {
        pathname: `/admin/cohorts/${data.cohort.id}/student-view/materials`,
        search: location.search,
      },
      { replace: true },
    )
  }, [data, id, location.pathname, location.search, navigate])

  if (loading) return <LoadingSpinner message="Loading cohort student view..." />

  if (error || !data) {
    return (
      <EmptyState
        icon={WifiOff}
        title="Could not load student view"
        description={error || 'The cohort student view is unavailable right now.'}
      />
    )
  }

  return (
    <PreviewShell data={data} activeSection={activeSection} students={students} selectedStudent={selectedStudent}>
      <PreviewContent data={data} activeSection={activeSection} />
    </PreviewShell>
  )
}

function PreviewShell({
  data,
  activeSection,
  children,
  students,
  selectedStudent,
}: {
  data: CohortStudentViewData
  activeSection: PreviewSection
  children: React.ReactNode
  students: CohortStudent[]
  selectedStudent: CohortStudent | null
}) {
  const basePath = `/admin/cohorts/${data.cohort.id}/student-view`
  const navigate = useNavigate()
  const previewName = selectedStudent?.full_name || selectedStudent?.email || 'Student Preview'
  const studentQuery = selectedStudent ? `?student_id=${selectedStudent.user_id}` : ''
  const sectionPath = (section: PreviewSection) => `${section === 'dashboard' ? basePath : `${basePath}/${section}`}${studentQuery}`
  const availableSections = previewSectionsForCohort(data.cohort.cohort_type)

  function keepPreviewNavigationContained(event: MouseEvent<HTMLDivElement>) {
    const link = (event.target as HTMLElement).closest('a')
    if (!link || link.target === '_blank' || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const url = new URL(link.href, window.location.origin)
    if (url.origin !== window.location.origin || url.pathname.startsWith(basePath) || url.pathname.startsWith('/admin/')) return
    const section = url.pathname.startsWith('/recordings') ? 'recordings'
      : url.pathname.startsWith('/resources') ? 'resources'
      : url.pathname.startsWith('/announcements') ? 'announcements'
      : url.pathname.startsWith('/messages') ? 'messages'
      : url.pathname.startsWith('/profile') ? 'profile'
      : url.pathname.startsWith('/dashboard') ? 'dashboard'
      : 'materials'
    event.preventDefault()
    navigate(sectionPath(section))
  }

  return (
    <div onClickCapture={keepPreviewNavigationContained} className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#ffffff_46%)]">
      <aside className="hidden lg:fixed lg:inset-y-0 lg:flex lg:w-64 lg:flex-col lg:border-r lg:border-line lg:bg-surface-raised">
        <div className="flex h-14 items-center border-b border-line px-6">
          <div className="flex min-w-0 items-center gap-2 text-ink">
            <img src={LOGO_SRC} alt="" width={28} height={28} className="h-7 w-7 shrink-0 rounded-md object-contain" />
            <span className="truncate font-semibold">{PRODUCT_NAME}</span>
          </div>
        </div>
        <nav className="flex-1 space-y-1 p-4">
          {availableSections.map((section) => {
            const item = sectionConfig[section]
            const active = section === activeSection
            const Icon = item.icon
            return (
              <Link
                key={section}
                to={sectionPath(section)}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors duration-150 ${
                  active
                    ? 'nav-selected'
                    : 'text-ink-secondary hover:bg-surface-sunken hover:text-ink'
                }`}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
                {item.label}
              </Link>
            )
          })}
        </nav>
        <div className="border-t border-line p-4">
          <Link
            to={`/admin/cohorts/${data.cohort.id}`}
            className="flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold text-ink-secondary transition-colors duration-150 hover:bg-surface-sunken hover:text-ink"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
            Back to cohort
          </Link>
        </div>
        <div className="border-t border-line p-4">
          <div className="flex items-center gap-3 rounded-xl bg-surface-sunken px-3 py-3">
            <Avatar name={selectedStudent ? previewName : 'Student Preview'} size="md" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink" title={previewName}>{previewName}</p>
              <p className="truncate text-xs text-ink-muted">Student</p>
            </div>
          </div>
        </div>
        <div className="px-4 pb-3 text-center">
          <span className="text-xs text-ink-muted">Built by <span className="font-medium">Shimizu Technology</span></span>
        </div>
      </aside>

      <header className="sticky top-0 z-40 border-b border-line bg-surface-raised lg:hidden">
        <div className="flex h-14 items-center gap-2 px-4">
          <img src={LOGO_SRC} alt="" width={28} height={28} className="h-7 w-7 shrink-0 rounded-md object-contain" />
          <span className="font-semibold text-ink">{PRODUCT_NAME}</span>
        </div>
        <nav className="flex gap-2 overflow-x-auto px-4 pb-3">
          {availableSections.map((section) => {
            const item = sectionConfig[section]
            const active = section === activeSection
            const Icon = item.icon
            return (
              <Link
                key={section}
                to={sectionPath(section)}
                aria-current={active ? 'page' : undefined}
                className={`inline-flex min-h-11 shrink-0 items-center gap-2 px-3 py-2 text-sm font-semibold transition-colors duration-150 ${
                  active ? 'tab-selected' : 'text-ink-secondary hover:text-ink'
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {item.label}
              </Link>
            )
          })}
        </nav>
      </header>

      <main className="min-w-0 lg:ml-64">
        <div className="p-4 lg:p-8 xl:p-10">
          <PreviewBanner data={data} students={students} selectedStudent={selectedStudent} />
          <div className="mt-6">{children}</div>
        </div>
      </main>
    </div>
  )
}

function PreviewBanner({ data, students, selectedStudent }: { data: CohortStudentViewData; students: CohortStudent[]; selectedStudent: CohortStudent | null }) {
  const navigate = useNavigate()
  const location = useLocation()
  return (
    <div className="overflow-hidden rounded-2xl border border-info-200 bg-info-50">
      <div className="px-4 py-4 sm:px-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-info-800">{selectedStudent ? 'Read-only enrollment preview' : 'Read-only cohort template preview'}</p>
          <h1 className="mt-1 text-xl font-bold text-ink [overflow-wrap:anywhere]">{data.cohort.name}</h1>
          <p className="text-sm text-ink-secondary [overflow-wrap:anywhere]">
            {selectedStudent ? `${selectedStudent.full_name || selectedStudent.email} · actual learning progress and access, with private messages hidden` : `Shared student template for ${data.cohort.curriculum_name} · not a specific student's account`} · generated {formatDate(data.generated_at)}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:min-w-64"><select aria-label="Preview student enrollment" value={selectedStudent?.user_id || ''} onChange={(event) => { const value = Number(event.target.value); navigate(value ? `${location.pathname}?student_id=${value}` : location.pathname) }} className="app-control w-full font-semibold"><option value="">Cohort template</option>{students.map((student) => <option key={student.enrollment_id} value={student.user_id}>{student.full_name || student.email}</option>)}</select><LinkButton to={`/admin/cohorts/${data.cohort.id}`} variant="secondary"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to cohort</LinkButton></div>
      </div>
      </div>
    </div>
  )
}

function mergeStudentProgress(view: CohortStudentViewData, progress: StudentProgressResponse): CohortStudentViewData {
  const progressModules = new Map(progress.modules.map((module) => [module.id, module]))
  const dashboardModules = (view.dashboard.modules || []).map((module) => {
    const actual = progressModules.get(module.id)
    if (!actual) return module
    const lessons = module.lessons.map((lesson) => {
      const actualLesson = actual.lessons.find((item) => item.id === lesson.id)
      return actualLesson ? { ...lesson, required: actualLesson.required, available: actualLesson.available, completed: actualLesson.completed, total_blocks: actualLesson.total_blocks, completed_blocks: actualLesson.completed_blocks } : lesson
    })
    return { ...module, progress_percentage: actual.progress_percentage, completed_blocks: actual.completed_blocks, total_blocks: actual.total_blocks, lessons }
  })
  const modules = view.modules.map((module) => {
    const actual = progressModules.get(module.id)
    if (!actual) return module
    return { ...module, available: actual.lessons.some((lesson) => lesson.available), lessons: module.lessons.map((lesson) => ({ ...lesson, required: actual.lessons.find((item) => item.id === lesson.id)?.required ?? lesson.required, available: actual.lessons.find((item) => item.id === lesson.id)?.available ?? lesson.available })) }
  })
  const nextId = progress.personal_plan?.next_lesson?.lesson_id
  const allLessons = dashboardModules.flatMap((module) => module.lessons)
  const continueLesson = allLessons.find((lesson) => lesson.id === nextId) || allLessons.find((lesson) => lesson.required && lesson.available && !lesson.completed)
  return {
    ...view,
    modules,
    weekly_plan: progress.weekly_plan ?? view.weekly_plan,
    dashboard: {
      ...view.dashboard,
      personal_plan: progress.personal_plan,
      capabilities: progress.weekly_plan?.capabilities ?? view.dashboard.capabilities,
      action_items: progress.weekly_plan ? (progress.weekly_plan.redos || []).slice(0, 5).map((redo) => ({
        type: 'redo', submission_id: redo.submission_id, content_block_id: redo.content_block_id,
        cohort_id: progress.cohort.id, lesson_id: redo.lesson_id, lesson_title: redo.lesson_title,
        content_block_title: redo.title, feedback: redo.feedback, submissions_closed: redo.state === 'closed',
      })) : view.dashboard.action_items,
      user: { id: progress.user.id, full_name: progress.user.full_name, role: 'student' },
      course_access: progress.cohort.course_delivery ? {
        course_delivery: progress.cohort.course_delivery,
        access_expires_at: progress.enrollment.access_expires_at || null,
        support_expires_at: progress.enrollment.support_expires_at || null,
      } : null,
      overall_progress: progress.overall_progress,
      modules: dashboardModules,
      continue_lesson: continueLesson ? { id: continueLesson.id, title: continueLesson.title } : null,
    },
  }
}

function PreviewContent({ data, activeSection }: { data: CohortStudentViewData; activeSection: PreviewSection }) {
  if (activeSection === 'dashboard') {
    return (
      <Dashboard
        previewData={data.dashboard}
        previewWeeklyPlan={data.weekly_plan}
        disableStaffRedirect
      />
    )
  }

  if (activeSection === 'materials') {
    return (
      <Materials
        previewData={data.dashboard}
        disableStaffRedirect
      />
    )
  }
  if (activeSection === 'resources') return <ResourcesPreview data={data} />
  if (activeSection === 'recordings') return <RecordingsPreview data={data} />
  if (activeSection === 'announcements') return <AnnouncementsPreview data={data} />
  if (activeSection === 'messages') return <MessagesPreview data={data} />
  return <ProfilePreview data={data} />
}

function ResourcesPreview({ data }: { data: CohortStudentViewData }) {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="app-eyebrow">Support your learning</p>
        <h1 className="app-title">Class resources</h1>
        <p className="mt-1 text-sm text-ink-muted">Important links for this class.</p>
      </div>
      {data.resources.length === 0 ? (
        <EmptyState icon={Link2} title="No resources yet" description="Class resources will appear here once an instructor adds them." />
      ) : (
        <div className="space-y-3">
          {data.resources.map((resource) => (
            <a
              key={resource.id}
              href={sanitizeUrl(resource.url)}
              target="_blank"
              rel="noopener noreferrer"
              className="app-surface pressable block p-5 hover:border-line-strong hover:bg-surface-sunken"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-ink">{resource.title}</h2>
                  {resource.description && <p className="mt-1 text-sm text-ink-secondary">{resource.description}</p>}
                  <p className="mt-1 break-all text-xs text-ink-muted">{resource.url}</p>
                </div>
                <ExternalLink className="mt-1 h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

function AnnouncementsPreview({ data }: { data: CohortStudentViewData }) {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <p className="app-eyebrow">Communication</p>
        <h1 className="app-title">Updates</h1>
        <p className="mt-1 text-sm text-ink-muted">Class updates, pinned notices, and important CSG messages.</p>
      </div>
      {data.announcements.length === 0 ? (
        <div className="app-surface p-8 text-center text-sm text-ink-muted">
          No announcements match these filters.
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-3">
            {data.announcements.map((announcement) => (
              <article key={announcement.id} className="app-surface p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold text-ink">{announcement.title}</h2>
                  {announcement.pinned && (
                    <Badge>Pinned</Badge>
                  )}
                </div>
                <p className="mt-1 text-xs tabular-nums text-ink-muted">
                  {announcement.author?.full_name || announcement.cohort_name || 'CSG'} · {formatDate(announcement.published_at)}
                </p>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-ink-secondary">{announcement.body}</p>
              </article>
            ))}
          </div>
          <aside className="app-surface p-4 lg:sticky lg:top-6 lg:self-start">
            <h2 className="text-base font-semibold text-ink">Inbox status</h2>
            <div className="mt-3 rounded-xl bg-surface-sunken px-3 py-2 text-ink-secondary">
              <p className="font-medium">Dashboard behavior</p>
              <p className="mt-2 text-sm leading-6">Pinned notices stay on the dashboard. Regular notices disappear from the dashboard once they are read.</p>
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}

function RecordingsPreview({ data }: { data: CohortStudentViewData }) {
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <p className="app-eyebrow">Review and revisit</p>
        <h1 className="app-title">Class recordings</h1>
        <p className="mt-1 text-sm tabular-nums text-ink-muted">{data.recordings.items.length} recording{data.recordings.items.length === 1 ? '' : 's'} available</p>
      </div>
      {data.recordings.items.length === 0 ? (
        <EmptyState icon={PlayCircle} title="No recordings yet" description="Class recordings will appear here once an instructor adds them." />
      ) : (
        <div className="app-surface p-3">
          <div className="space-y-1">
            {data.recordings.items.map((recording, index) => (
              <div key={recording.id} className="rounded-xl px-3 py-2.5">
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 w-5 shrink-0 text-right text-xs font-medium tabular-nums text-ink-muted">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium leading-snug text-ink" title={recording.title}>{recording.title}</p>
                    <p className="mt-0.5 text-xs capitalize tabular-nums text-ink-muted">
                      {recording.source} · {formatDate(recording.recorded_date || recording.date)}
                    </p>
                  </div>
                  {recording.url && (
                    <a href={sanitizeUrl(recording.url)} target="_blank" rel="noopener noreferrer" aria-label={`Open ${recording.title} in a new tab`} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-ink-secondary transition-colors duration-150 hover:bg-surface-sunken hover:text-ink">
                      <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function MessagesPreview({ data }: { data: CohortStudentViewData }) {
  return (
    <div className="mx-auto max-w-5xl">
      <div className="app-surface p-8 text-center">
        <MessageCircle className="mx-auto h-10 w-10 text-ink-muted" aria-hidden="true" />
        <h1 className="mt-3 text-xl font-semibold text-ink">Messages preview</h1>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-ink-secondary">
          Messages are tied to a real user, memberships, read receipts, and direct conversations. This read-only cohort preview keeps the student sidebar in place, but does not impersonate a student or expose a specific student's private messages.
        </p>
        <p className="mt-4 text-sm font-medium text-ink-secondary">{data.cohort.name}</p>
      </div>
    </div>
  )
}

function ProfilePreview({ data }: { data: CohortStudentViewData }) {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="app-surface p-6">
        <div className="flex items-center gap-4">
          <Avatar name="Student Preview" size="lg" />
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-ink">Student Preview</h1>
            <p className="text-sm text-ink-muted">{data.cohort.name}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
