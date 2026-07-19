import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Bell,
  BookOpenText,
  ExternalLink,
  GraduationCap,
  LayoutDashboard,
  Link2,
  MessageCircle,
  PlayCircle,
  User,
  WifiOff,
} from 'lucide-react'
import { api } from '../../lib/api'
import type { CohortStudentView as CohortStudentViewData } from '../../types/api'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { EmptyState } from '../../components/shared/EmptyState'
import { Dashboard } from '../student/Dashboard'
import { Materials } from '../student/Materials'
import { sanitizeUrl } from '../../lib/sanitizeUrl'

function formatDate(dateStr?: string | null) {
  if (!dateStr) return 'Not scheduled'

  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return 'Not scheduled'

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
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

export function CohortStudentView() {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const [data, setData] = useState<CohortStudentViewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return

    setLoading(true)
    api.getCohortStudentView(Number(id)).then((res) => {
      if (res.data?.student_view) {
        setData(res.data.student_view)
        setError(null)
      } else {
        setError(res.error || 'Unable to load this cohort student view.')
      }
      setLoading(false)
    })
  }, [id])

  const activeSection = useMemo<PreviewSection>(() => {
    const tail = location.pathname.split('/student-view/')[1]?.split('/')[0] || 'dashboard'
    return sections.includes(tail as PreviewSection) ? tail as PreviewSection : 'dashboard'
  }, [location.pathname])

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
    <PreviewShell data={data} activeSection={activeSection}>
      <PreviewContent data={data} activeSection={activeSection} />
    </PreviewShell>
  )
}

function PreviewShell({
  data,
  activeSection,
  children,
}: {
  data: CohortStudentViewData
  activeSection: PreviewSection
  children: React.ReactNode
}) {
  const basePath = `/admin/cohorts/${data.cohort.id}/student-view`

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#ffffff_46%)]">
      <aside className="hidden lg:fixed lg:inset-y-0 lg:flex lg:w-64 lg:flex-col lg:border-r lg:border-slate-200 lg:bg-white">
        <div className="flex h-14 items-center border-b border-slate-200 px-6">
          <div className="flex min-w-0 items-center gap-2 text-slate-900">
            <GraduationCap className="h-6 w-6 shrink-0 text-primary-500" />
            <span className="truncate font-semibold">CSG Learning Hub</span>
          </div>
        </div>
        <nav className="flex-1 space-y-1 p-4">
          {sections.map((section) => {
            const item = sectionConfig[section]
            const active = section === activeSection
            const Icon = item.icon
            return (
              <Link
                key={section}
                to={section === 'dashboard' ? basePath : `${basePath}/${section}`}
                className={`flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${
                  active
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className="h-5 w-5" />
                {item.label}
              </Link>
            )
          })}
        </nav>
        <div className="border-t border-slate-200 p-4">
          <Link
            to={`/admin/cohorts/${data.cohort.id}`}
            className="flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          >
            <ArrowLeft className="h-5 w-5" />
            Back to cohort
          </Link>
        </div>
        <div className="border-t border-slate-200 p-4">
          <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">SP</div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-900">Student Preview</p>
              <p className="truncate text-xs text-slate-500">Student</p>
            </div>
          </div>
        </div>
        <div className="px-4 pb-3 text-center">
          <span className="text-xs text-slate-400">Built by <span className="font-medium">Shimizu Technology</span></span>
        </div>
      </aside>

      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white lg:hidden">
        <div className="flex h-14 items-center gap-2 px-4">
          <GraduationCap className="h-6 w-6 text-primary-500" />
          <span className="font-semibold text-slate-900">CSG Learning Hub</span>
        </div>
        <nav className="flex gap-2 overflow-x-auto px-4 pb-3">
          {sections.map((section) => {
            const item = sectionConfig[section]
            const active = section === activeSection
            const Icon = item.icon
            return (
              <Link
                key={section}
                to={section === 'dashboard' ? basePath : `${basePath}/${section}`}
                className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold ${
                  active ? 'bg-primary-50 text-primary-700' : 'text-slate-600'
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            )
          })}
        </nav>
      </header>

      <main className="min-w-0 lg:ml-64">
        <div className="p-4 lg:p-8 xl:p-10">
          <PreviewBanner data={data} />
          <div className="mt-6">{children}</div>
        </div>
      </main>
    </div>
  )
}

function PreviewBanner({ data }: { data: CohortStudentViewData }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-primary-200 bg-white shadow-sm shadow-slate-200/40">
      <div className="h-1 bg-primary-500" />
      <div className="px-4 py-4 sm:px-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary-700">Read-only cohort student view</p>
          <h1 className="mt-1 text-xl font-bold text-slate-900">{data.cohort.name}</h1>
          <p className="text-sm text-slate-600">
            Generic student experience for {data.cohort.curriculum_name} · {data.cohort.active_count} active students · generated {formatDate(data.generated_at)}
          </p>
        </div>
        <Link
          to={`/admin/cohorts/${data.cohort.id}`}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to cohort
        </Link>
      </div>
      </div>
    </div>
  )
}

function PreviewContent({ data, activeSection }: { data: CohortStudentViewData; activeSection: PreviewSection }) {
  if (activeSection === 'dashboard') {
    return (
      <Dashboard
        previewData={data.dashboard}
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
        <p className="mt-1 text-sm text-slate-500">Important links for this class.</p>
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
              className="block rounded-2xl border border-slate-200 bg-white p-5 transition-all hover:border-primary-200 hover:shadow-sm"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-slate-900">{resource.title}</h2>
                  {resource.description && <p className="mt-1 text-sm text-slate-600">{resource.description}</p>}
                  <p className="mt-1 break-all text-xs text-slate-400">{resource.url}</p>
                </div>
                <ExternalLink className="mt-1 h-4 w-4 shrink-0 text-slate-400" />
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
        <p className="text-sm font-medium text-primary-600">Communication</p>
        <h1 className="app-title">Updates</h1>
        <p className="mt-1 text-sm text-slate-500">Class updates, pinned notices, and important CSG messages.</p>
      </div>
      {data.announcements.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          No announcements match these filters.
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-3">
            {data.announcements.map((announcement) => (
              <article key={announcement.id} className="rounded-lg border border-primary-200 bg-white p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold text-slate-900">{announcement.title}</h2>
                  {announcement.pinned && (
                    <span className="rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700">Pinned</span>
                  )}
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {announcement.author?.full_name || announcement.cohort_name || 'CSG'} · {formatDate(announcement.published_at)}
                </p>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{announcement.body}</p>
              </article>
            ))}
          </div>
          <aside className="rounded-lg border border-slate-200 bg-white p-4 lg:sticky lg:top-6 lg:self-start">
            <h2 className="font-semibold text-slate-900">Inbox status</h2>
            <div className="mt-3 rounded-lg bg-primary-50 px-3 py-2 text-primary-800">
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
        <p className="mt-1 text-sm text-slate-500">{data.recordings.items.length} recording{data.recordings.items.length === 1 ? '' : 's'} available</p>
      </div>
      {data.recordings.items.length === 0 ? (
        <EmptyState icon={PlayCircle} title="No recordings yet" description="Class recordings will appear here once an instructor adds them." />
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white p-3">
          <div className="space-y-1">
            {data.recordings.items.map((recording, index) => (
              <div key={recording.id} className="rounded-xl px-3 py-2.5">
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 w-5 shrink-0 text-right text-[11px] font-medium text-slate-400">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium leading-snug text-slate-900">{recording.title}</p>
                    <p className="mt-0.5 text-[11px] capitalize text-slate-400">
                      {recording.source} · {formatDate(recording.recorded_date || recording.date)}
                    </p>
                  </div>
                  {recording.url && (
                    <a href={sanitizeUrl(recording.url)} target="_blank" rel="noopener noreferrer" aria-label={`Open ${recording.title} in a new tab`} className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-50 hover:text-primary-600">
                      <ExternalLink className="h-4 w-4" />
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
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <MessageCircle className="mx-auto h-10 w-10 text-slate-300" />
        <h1 className="mt-3 text-xl font-semibold text-slate-900">Messages preview</h1>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500">
          Messages are tied to a real user, memberships, read receipts, and direct conversations. This read-only cohort preview keeps the student sidebar in place, but does not impersonate a student or expose a specific student's private messages.
        </p>
        <p className="mt-4 text-sm font-medium text-slate-700">{data.cohort.name}</p>
      </div>
    </div>
  )
}

function ProfilePreview({ data }: { data: CohortStudentViewData }) {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">SP</div>
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Student Preview</h1>
            <p className="text-sm text-slate-500">{data.cohort.name}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
