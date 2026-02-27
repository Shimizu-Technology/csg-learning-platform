import { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, ChevronLeft } from 'lucide-react'
import { api } from '../../lib/api'
import { ContentBlockRenderer } from '../../components/shared/ContentBlockRenderer'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { useAuthContext } from '../../contexts/AuthContext'

interface LessonData {
  id: number
  module_id: number
  title: string
  lesson_type: string
  position: number
  release_day: number
  required: boolean
  content_blocks: Array<any>
  prev_lesson: { id: number; title: string } | null
  next_lesson: { id: number; title: string } | null
}

export function LessonView() {
  const { id } = useParams<{ id: string }>()
  const [lesson, setLesson] = useState<LessonData | null>(null)
  const [loading, setLoading] = useState(true)
  const { user } = useAuthContext()

  const loadLesson = useCallback(() => {
    if (!id) return
    setLoading(true)
    api.getLesson(Number(id)).then((res) => {
      if (res.data) setLesson(res.data.lesson)
      setLoading(false)
    })
  }, [id])

  useEffect(() => {
    loadLesson()
  }, [loadLesson])

  if (loading) return <LoadingSpinner message="Loading lesson..." />
  if (!lesson) return <div className="text-center text-slate-500 py-12">Lesson not found</div>

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Back link */}
      <Link
        to={`/modules/${lesson.module_id}`}
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to Module
      </Link>

      {/* Lesson header */}
      <div className="rounded-2xl bg-white border border-slate-200 p-6">
        <h1 className="text-xl font-bold text-slate-900">{lesson.title}</h1>
        <div className="mt-1 flex items-center gap-2 text-sm text-slate-500">
          <span className="capitalize">{lesson.lesson_type}</span>
          <span>· {lesson.content_blocks.length} blocks</span>
          {lesson.required && <span className="text-primary-500 font-medium">Required</span>}
        </div>
      </div>

      {/* Content blocks */}
      <div className="space-y-4">
        {lesson.content_blocks.map((block: any) => (
          <ContentBlockRenderer
            key={block.id}
            block={block}
            isStaff={user?.is_staff}
            onProgressUpdate={loadLesson}
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
    </div>
  )
}
