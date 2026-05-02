import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, BookOpenText, CheckCircle2, Clock, Eye, Lock } from 'lucide-react'
import { api } from '../../lib/api'
import type { StudentProgressResponse } from '../../types/api'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { EmptyState } from '../../components/shared/EmptyState'
import { ProgressBar } from '../../components/shared/ProgressBar'

export function StudentPreview() {
  const { id } = useParams<{ id: string }>()
  const [data, setData] = useState<StudentProgressResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return

    setLoading(true)
    api.getStudentProgress(Number(id)).then((res) => {
      if (res.data) {
        setData(res.data)
        setError(null)
      } else {
        setError(res.error || 'Unable to load this student preview.')
      }
      setLoading(false)
    })
  }, [id])

  if (loading) return <LoadingSpinner message="Loading student preview..." />

  if (error || !data) {
    return (
      <EmptyState
        icon={Eye}
        title="Could not load preview"
        description={error || 'The student preview is unavailable right now.'}
      />
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="rounded-2xl border border-primary-200 bg-primary-50 px-4 py-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary-700">Read-only student view</p>
            <h1 className="mt-1 text-xl font-bold text-slate-900">{data.user.full_name}</h1>
            <p className="text-sm text-slate-600">
              Previewing what this student can see in {data.cohort.name}. Actions that would change student data are intentionally unavailable.
            </p>
          </div>
          <Link
            to={`/admin/students/${data.user.id}`}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-primary-100 hover:bg-primary-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to admin view
          </Link>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-primary-600">{data.cohort.name}</p>
            <h2 className="text-2xl font-bold text-slate-900">Materials preview</h2>
            <p className="mt-1 text-sm text-slate-500">
              {data.overall_progress.completed}/{data.overall_progress.total} blocks completed
            </p>
          </div>
          <div className="sm:min-w-[260px]">
            <ProgressBar value={data.overall_progress.percentage} />
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {data.modules.map((mod) => (
          <section key={mod.id} className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="font-semibold text-slate-900">{mod.name}</h3>
                <p className="mt-0.5 text-sm capitalize text-slate-500">{mod.module_type.replaceAll('_', ' ')}</p>
              </div>
              <div className="sm:min-w-[220px]">
                <ProgressBar value={mod.completed_blocks} max={mod.total_blocks} showPercentage={false} size="sm" />
                <p className="mt-1 text-right text-xs text-slate-400">
                  {mod.completed_blocks}/{mod.total_blocks} blocks
                </p>
              </div>
            </div>

            <div className="mt-4 divide-y divide-slate-100">
              {mod.lessons.map((lesson) => (
                <div key={lesson.id} className="flex items-center gap-3 py-3">
                  <div className="shrink-0">
                    {lesson.completed ? (
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                    ) : lesson.available ? (
                      <Clock className="h-5 w-5 text-primary-500" />
                    ) : (
                      <Lock className="h-5 w-5 text-slate-400" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">{lesson.title}</p>
                    <p className="mt-0.5 text-xs capitalize text-slate-500">
                      {lesson.lesson_type.replaceAll('_', ' ')} · {lesson.completed_blocks}/{lesson.total_blocks} blocks
                    </p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                    {lesson.available ? 'Visible' : 'Locked'}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-4 text-sm text-slate-500">
        <BookOpenText className="mr-2 inline h-4 w-4 text-slate-400" />
        This preview is intentionally read-only. It does not submit work, mark lessons complete, send messages, edit profile data, or update watch progress.
      </div>
    </div>
  )
}
