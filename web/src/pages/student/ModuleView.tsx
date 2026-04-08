import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { CheckCircle2, ArrowLeft, Play, Code, FileText, BookOpen } from 'lucide-react'
import { api } from '../../lib/api'
import { ProgressBar } from '../../components/shared/ProgressBar'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'

interface ModuleData {
  id: number
  name: string
  module_type: string
  description: string | null
  lessons: Array<{
    id: number
    title: string
    lesson_type: string
    position: number
    release_day: number
    required: boolean
    content_blocks: Array<{
      id: number
      block_type: string
      title: string | null
    }>
  }>
}

const lessonTypeIcons: Record<string, React.ReactNode> = {
  video: <Play className="h-4 w-4" />,
  exercise: <Code className="h-4 w-4" />,
  reading: <FileText className="h-4 w-4" />,
  project: <BookOpen className="h-4 w-4" />,
  checkpoint: <CheckCircle2 className="h-4 w-4" />,
}

export function ModuleView() {
  const { id } = useParams<{ id: string }>()
  const [mod, setMod] = useState<ModuleData | null>(null)
  const [loading, setLoading] = useState(true)
  const [progressData, setProgressData] = useState<Record<number, string>>({})

  useEffect(() => {
    if (!id) return

    Promise.all([
      api.getModule(Number(id)),
      api.getDashboard(),
    ]).then(([modRes, dashRes]) => {
      if (modRes.data) setMod(modRes.data.module)

      // Build progress map from dashboard data
      if (dashRes.data?.dashboard?.modules) {
        const targetMod = dashRes.data.dashboard.modules.find((m: any) => m.id === Number(id))
        if (targetMod) {
          const map: Record<number, string> = {}
          targetMod.lessons.forEach((l: any) => {
            map[l.id] = l.completed ? 'completed' : l.available ? 'available' : 'locked'
          })
          setProgressData(map)
        }
      }

      setLoading(false)
    })
  }, [id])

  if (loading) return <LoadingSpinner message="Loading module..." />
  if (!mod) return <div className="text-center text-slate-500 py-12">Module not found</div>

  // Group lessons by release_day
  const lessonsByDay = mod.lessons.reduce<Record<number, typeof mod.lessons>>((acc, lesson) => {
    const day = lesson.release_day
    if (!acc[day]) acc[day] = []
    acc[day].push(lesson)
    return acc
  }, {})

  const availableLessons = mod.lessons.filter((l) => (progressData[l.id] || 'available') !== 'locked')
  const totalLessons = availableLessons.length
  const completedLessons = availableLessons.filter((l) => progressData[l.id] === 'completed').length

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div>
        <Link to="/" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-4">
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </Link>
        <div className="rounded-2xl bg-white border border-slate-200 p-6">
          <h1 className="text-2xl font-bold text-slate-900">{mod.name}</h1>
          {mod.description && <p className="mt-2 text-slate-500">{mod.description}</p>}
          <div className="mt-4">
            <ProgressBar value={completedLessons} max={totalLessons} label="Progress" />
          </div>
        </div>
      </div>

      {/* Lessons by day — only show days that have at least one unlocked lesson */}
      <div className="space-y-6">
        {Object.entries(lessonsByDay)
          .sort(([a], [b]) => Number(a) - Number(b))
          .filter(([, lessons]) => lessons.some((lesson) => (progressData[lesson.id] || 'available') !== 'locked'))
          .map(([day, lessons]) => {
            const visibleLessons = lessons.filter((lesson) => (progressData[lesson.id] || 'available') !== 'locked')
            return (
              <div key={day}>
                <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">
                  {Number(day) === 0 ? 'Introduction' : `Day ${day}`}
                </h3>
                <div className="space-y-2">
                  {visibleLessons.map((lesson) => {
                    const isCompleted = progressData[lesson.id] === 'completed'

                    return (
                      <Link
                        key={lesson.id}
                        to={`/lessons/${lesson.id}`}
                        className="flex items-center gap-3 rounded-2xl bg-white border border-slate-200 p-4 hover:border-primary-200 hover:shadow-sm transition-all"
                      >
                        <div className={`shrink-0 ${isCompleted ? 'text-success-500' : 'text-slate-400'}`}>
                          {isCompleted ? <CheckCircle2 className="h-5 w-5" /> : lessonTypeIcons[lesson.lesson_type] || <FileText className="h-5 w-5" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium ${isCompleted ? 'text-slate-500' : 'text-slate-900'}`}>
                            {lesson.title}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-slate-400 capitalize">{lesson.lesson_type}</span>
                            <span className="text-xs text-slate-400">· {lesson.content_blocks.length} blocks</span>
                          </div>
                        </div>
                        {isCompleted && (
                          <span className="text-xs font-medium text-success-600 bg-success-50 px-2 py-0.5 rounded-full">Done</span>
                        )}
                      </Link>
                    )
                  })}
                </div>
              </div>
            )
          })}
      </div>
    </div>
  )
}
