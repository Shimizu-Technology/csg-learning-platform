import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  BookOpenText,
  CheckCircle2,
  Clock,
  ExternalLink,
  Eye,
  FileText,
  Link2,
  Lock,
  Megaphone,
  Video,
} from 'lucide-react'
import { api } from '../../lib/api'
import type { CohortStudentView as CohortStudentViewData, CohortStudentViewModule } from '../../types/api'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { EmptyState } from '../../components/shared/EmptyState'

function formatDate(dateStr?: string | null) {
  if (!dateStr) return 'Not scheduled'

  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return 'Not scheduled'

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatType(value: string) {
  return value.replaceAll('_', ' ')
}

function StatusPill({ available }: { available: boolean }) {
  return available ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-700 ring-1 ring-green-200">
      <CheckCircle2 className="h-3.5 w-3.5" />
      Visible
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
      <Lock className="h-3.5 w-3.5" />
      Locked
    </span>
  )
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-2xl font-bold text-slate-900">{value}</p>
      <p className="mt-1 text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{label}</p>
    </div>
  )
}

function ModuleSection({ mod }: { mod: CohortStudentViewModule }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold text-slate-900">{mod.name}</h2>
            <StatusPill available={mod.available} />
          </div>
          <p className="mt-1 text-sm capitalize text-slate-500">
            {formatType(mod.module_type)} · starts {formatDate(mod.module_start_date)}
          </p>
          {mod.repository_name && (
            <p className="mt-1 text-xs text-slate-500">
              Repository: <span className="font-medium text-slate-700">{mod.repository_name}</span>
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm sm:min-w-48">
          <div className="rounded-xl bg-slate-50 px-3 py-2">
            <p className="font-semibold text-slate-900">{mod.visible_lessons_count}</p>
            <p className="text-xs text-slate-500">visible</p>
          </div>
          <div className="rounded-xl bg-slate-50 px-3 py-2">
            <p className="font-semibold text-slate-900">{mod.locked_lessons_count}</p>
            <p className="text-xs text-slate-500">locked</p>
          </div>
        </div>
      </div>

      <div className="mt-4 divide-y divide-slate-100">
        {mod.lessons.map((lesson) => (
          <div key={lesson.id} className="grid gap-3 py-3 sm:grid-cols-[24px_minmax(0,1fr)_auto] sm:items-center">
            <div className="hidden sm:block">
              {lesson.available ? (
                <Clock className="h-5 w-5 text-primary-500" />
              ) : (
                <Lock className="h-5 w-5 text-slate-400" />
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">{lesson.title}</p>
              <p className="mt-1 text-xs capitalize text-slate-500">
                {formatType(lesson.lesson_type)} · {lesson.content_blocks_count} blocks · unlocks {formatDate(lesson.unlock_date)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {lesson.requires_submission && (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary-50 px-2 py-1 text-xs font-medium text-primary-700">
                  <FileText className="h-3.5 w-3.5" />
                  {formatType(lesson.submission_type)}
                </span>
              )}
              <StatusPill available={lesson.available} />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

export function CohortStudentView() {
  const { id } = useParams<{ id: string }>()
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

  if (loading) return <LoadingSpinner message="Loading cohort student view..." />

  if (error || !data) {
    return (
      <EmptyState
        icon={Eye}
        title="Could not load student view"
        description={error || 'The cohort student view is unavailable right now.'}
      />
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="rounded-2xl border border-primary-200 bg-primary-50 px-4 py-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary-700">Read-only cohort student view</p>
            <h1 className="mt-1 text-xl font-bold text-slate-900">{data.cohort.name}</h1>
            <p className="text-sm text-slate-600">
              {data.cohort.curriculum_name} · {data.cohort.active_count} active students · generated {formatDate(data.generated_at)}
            </p>
          </div>
          <Link
            to={`/admin/cohorts/${data.cohort.id}`}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-primary-100 hover:bg-primary-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to cohort
          </Link>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <SummaryCard label="assigned modules" value={data.summary.assigned_modules} />
        <SummaryCard label="visible modules" value={data.summary.available_modules} />
        <SummaryCard label="locked modules" value={data.summary.locked_modules} />
        <SummaryCard label="total lessons" value={data.summary.total_lessons} />
        <SummaryCard label="visible lessons" value={data.summary.visible_lessons} />
        <SummaryCard label="locked lessons" value={data.summary.locked_lessons} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          {data.modules.length > 0 ? (
            data.modules.map((mod) => <ModuleSection key={mod.id} mod={mod} />)
          ) : (
            <EmptyState
              icon={BookOpenText}
              title="No curriculum modules yet"
              description="This cohort does not have modules to preview yet."
            />
          )}
        </div>

        <aside className="space-y-4">
          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-2">
              <Megaphone className="h-4 w-4 text-primary-600" />
              <h2 className="font-semibold text-slate-900">Announcements</h2>
            </div>
            <div className="mt-3 space-y-3">
              {data.announcements.length > 0 ? data.announcements.map((announcement) => (
                <article key={announcement.id} className="rounded-xl bg-slate-50 p-3">
                  <p className="text-sm font-semibold text-slate-900">{announcement.title}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-slate-500">{announcement.body}</p>
                </article>
              )) : (
                <p className="text-sm text-slate-500">No visible announcements.</p>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-2">
              <Link2 className="h-4 w-4 text-primary-600" />
              <h2 className="font-semibold text-slate-900">Resources</h2>
            </div>
            <div className="mt-3 space-y-2">
              {data.resources.length > 0 ? data.resources.map((resource, index) => (
                <a
                  key={`${resource.title}-${index}`}
                  href={resource.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-start justify-between gap-3 rounded-xl bg-slate-50 p-3 text-sm font-medium text-slate-800 hover:bg-slate-100"
                >
                  <span className="min-w-0 flex-1 truncate">{resource.title}</span>
                  <ExternalLink className="h-4 w-4 shrink-0 text-slate-400" />
                </a>
              )) : (
                <p className="text-sm text-slate-500">No visible resources.</p>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-2">
              <Video className="h-4 w-4 text-primary-600" />
              <h2 className="font-semibold text-slate-900">Recordings</h2>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {data.recordings.uploaded_count} uploaded · {data.recordings.legacy_count} linked
            </p>
            <div className="mt-3 space-y-2">
              {data.recordings.items.length > 0 ? data.recordings.items.map((recording) => (
                <div key={recording.id} className="rounded-xl bg-slate-50 p-3">
                  <p className="text-sm font-semibold text-slate-900">{recording.title}</p>
                  <p className="mt-1 text-xs capitalize text-slate-500">
                    {recording.source} · {formatDate(recording.recorded_date || recording.date)}
                  </p>
                </div>
              )) : (
                <p className="text-sm text-slate-500">No visible recordings.</p>
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}
