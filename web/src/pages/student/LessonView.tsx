import { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, ChevronLeft, Lock, RotateCcw } from 'lucide-react'
import { api } from '../../lib/api'
import { ContentBlockRenderer } from '../../components/shared/ContentBlockRenderer'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { useAuthContext } from '../../contexts/AuthContext'
import { formatShortDateTime } from '../../lib/format'

interface LessonData {
  id: number
  module_id: number
  title: string
  lesson_type: string
  position: number
  release_day: number
  required: boolean
  requires_submission?: boolean
  requires_github?: boolean
  repository_name?: string
  submission_window?: {
    week_number: number
    submissions_close_at: string | null
    submissions_closed: boolean
    status: 'open' | 'scheduled' | 'closed'
  }
  content_blocks: Array<any>
  prev_lesson: { id: number; title: string } | null
  next_lesson: { id: number; title: string } | null
}

export function LessonView() {
  const { id } = useParams<{ id: string }>()
  const [lesson, setLesson] = useState<LessonData | null>(null)
  const [loading, setLoading] = useState(true)
  const { user } = useAuthContext()

  const loadLesson = useCallback((options?: { silent?: boolean }) => {
    if (!id) return
    if (!options?.silent) setLoading(true)
    api.getLesson(Number(id)).then((res) => {
      if (res.data) setLesson(res.data.lesson)
      if (!options?.silent) setLoading(false)
    })
  }, [id])

  useEffect(() => {
    loadLesson()
  }, [loadLesson])

  if (loading) return <LoadingSpinner message="Loading lesson..." />
  if (!lesson) return <div className="text-center text-slate-500 py-12">Lesson not found</div>

  const redoBlocks = lesson.content_blocks.filter((block: any) => block.submissions?.[0]?.grade === 'R')

  return (
    <article className="app-page max-w-3xl">
      {/* Back link */}
      <Link
        to={`/modules/${lesson.module_id}`}
        className="inline-flex min-h-11 items-center gap-1 rounded-xl px-2 text-sm font-bold text-slate-500 hover:bg-slate-100 hover:text-slate-900"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to Module
      </Link>

      {/* Lesson header */}
      <header className="relative overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-[0_16px_50px_rgba(15,23,42,0.05)] before:absolute before:inset-y-0 before:left-0 before:w-1.5 before:bg-primary-600">
        <p className="app-eyebrow">Lesson</p>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-950 sm:text-3xl">{lesson.title}</h1>
        <div className="mt-1 flex items-center gap-2 text-sm text-slate-500">
          <span className="capitalize">{lesson.lesson_type}</span>
          <span>· {lesson.content_blocks.length} blocks</span>
          {lesson.required && <span className="text-primary-500 font-medium">Required</span>}
        </div>
      </header>

      {lesson.submission_window?.submissions_close_at && (
        <div className={`rounded-2xl border p-4 ${lesson.submission_window.submissions_closed ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
          <div className="flex items-start gap-3">
            <Lock className={`mt-0.5 h-5 w-5 shrink-0 ${lesson.submission_window.submissions_closed ? 'text-red-600' : 'text-amber-600'}`} />
            <div>
              <h2 className={`text-sm font-semibold ${lesson.submission_window.submissions_closed ? 'text-red-800' : 'text-amber-800'}`}>
                {lesson.submission_window.submissions_closed ? `Week ${lesson.submission_window.week_number} submissions are closed` : `Week ${lesson.submission_window.week_number} submissions close soon`}
              </h2>
              <p className={`mt-1 text-sm ${lesson.submission_window.submissions_closed ? 'text-red-700' : 'text-amber-700'}`}>
                {lesson.submission_window.submissions_closed
                  ? `Submissions closed ${formatShortDateTime(lesson.submission_window.submissions_close_at)}. You can still review videos, readings, and feedback, but new work cannot be submitted.`
                  : `Submissions close ${formatShortDateTime(lesson.submission_window.submissions_close_at)}.`}
              </p>
            </div>
          </div>
        </div>
      )}

      {redoBlocks.length > 0 && (
        <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4">
          <div className="flex items-start gap-3">
            <RotateCcw className="h-5 w-5 text-orange-600 shrink-0 mt-0.5" />
            <div>
              <h2 className="text-sm font-semibold text-orange-800">Redo requested in this lesson</h2>
              <p className="mt-1 text-sm text-orange-700">
                You have {redoBlocks.length} block{redoBlocks.length > 1 ? 's' : ''} that need an updated submission. Review the feedback below and resubmit your work.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Content blocks */}
      <div className="space-y-4">
        {lesson.content_blocks.map((block: any) => (
          <ContentBlockRenderer
            key={block.id}
            block={block}
            isStaff={user?.is_staff}
            requiresGithub={lesson.requires_github}
            requiresSubmission={lesson.requires_submission}
            repositoryName={lesson.repository_name}
            submissionsLocked={lesson.submission_window?.submissions_closed || false}
            submissionsCloseAt={lesson.submission_window?.submissions_close_at || null}
            submissionWeekNumber={lesson.submission_window?.week_number}
            onProgressUpdate={() => loadLesson({ silent: true })}
          />
        ))}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between pt-4 border-t border-slate-200">
        {lesson.prev_lesson ? (
          <Link
            to={`/lessons/${lesson.prev_lesson.id}`}
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">{lesson.prev_lesson.title}</span>
            <span className="sm:hidden">Previous</span>
          </Link>
        ) : (
          <div />
        )}
        {lesson.next_lesson ? (
          <Link
            to={`/lessons/${lesson.next_lesson.id}`}
            className="inline-flex items-center gap-2 rounded-lg bg-primary-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-600 transition-colors"
          >
            <span className="hidden sm:inline">{lesson.next_lesson.title}</span>
            <span className="sm:hidden">Next</span>
            <ArrowRight className="h-4 w-4" />
          </Link>
        ) : (
          <Link
            to={`/modules/${lesson.module_id}`}
            className="inline-flex items-center gap-2 rounded-lg bg-success-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-success-600 transition-colors"
          >
            Back to Module
          </Link>
        )}
      </div>
    </article>
  )
}
