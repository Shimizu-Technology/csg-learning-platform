import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft,
  User,
  Github,
  Clock,
  CheckCircle,
  Circle,
  ChevronDown,
  ChevronRight,
  BookOpen,
  Code,
  PlayCircle,
  FileText,
  AlertCircle,
} from 'lucide-react'
import { api } from '../../lib/api'
import { ProgressBar } from '../../components/shared/ProgressBar'
import { ProgressRing } from '../../components/shared/ProgressRing'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'

// Block type icon mapping
const BLOCK_ICONS: Record<string, React.ElementType> = {
  reading: FileText,
  video: PlayCircle,
  exercise: Code,
  code_challenge: Code,
  quiz: AlertCircle,
  assignment: BookOpen,
}

const BLOCK_COLORS: Record<string, string> = {
  reading: 'text-blue-500',
  video: 'text-purple-500',
  exercise: 'text-amber-500',
  code_challenge: 'text-orange-500',
  quiz: 'text-green-500',
  assignment: 'text-indigo-500',
}

const GRADE_STYLES: Record<string, string> = {
  A: 'bg-green-100 text-green-700 border-green-200',
  B: 'bg-blue-100 text-blue-700 border-blue-200',
  C: 'bg-amber-100 text-amber-700 border-amber-200',
  R: 'bg-red-100 text-red-700 border-red-200',
}

interface ProgressData {
  user: {
    id: number
    full_name: string
    email: string
    github_username: string | null
    avatar_url: string | null
    last_sign_in_at: string | null
  }
  cohort: {
    id: number
    name: string
    start_date: string
    status: string
  }
  overall_progress: {
    completed: number
    total: number
    percentage: number
  }
  modules: Array<{
    id: number
    name: string
    module_type: string
    position: number
    total_blocks: number
    completed_blocks: number
    progress_percentage: number
    lessons: Array<{
      id: number
      title: string
      lesson_type: string
      position: number
      release_day: number
      required: boolean
      available: boolean
      unlock_date: string | null
      total_blocks: number
      completed_blocks: number
      completed: boolean
      blocks: Array<{
        id: number
        title: string
        block_type: string
        position: number
        status: string
        completed_at: string | null
        submission: {
          id: number
          grade: string | null
          feedback: string | null
          submitted_at: string
          graded_at: string | null
        } | null
      }>
    }>
  }>
  recent_activity: Array<{
    content_block_id: number
    block_title: string
    block_type: string
    completed_at: string
  }>
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatRelative(dateStr: string | null): string {
  if (!dateStr) return 'Never'
  const d = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / 86400000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays} days ago`
  return formatDate(dateStr)
}

function LessonRow({ lesson }: { lesson: ProgressData['modules'][0]['lessons'][0] }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      <div className="flex items-center gap-3 p-4 hover:bg-slate-50 transition-colors">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex flex-1 items-center gap-3 text-left min-w-0"
        >
          {lesson.completed ? (
            <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
          ) : lesson.available ? (
            <Circle className="h-4 w-4 text-slate-300 shrink-0" />
          ) : (
            <Clock className="h-4 w-4 text-slate-200 shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-slate-900 truncate">{lesson.title}</span>
              {lesson.required && (
                <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 bg-primary-100 text-primary-700 rounded">
                  Required
                </span>
              )}
              {!lesson.available && (
                <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded">
                  Locked
                </span>
              )}
            </div>
            <div className="mt-1 flex items-center gap-3">
              <span className="text-xs text-slate-500">
                {lesson.completed_blocks}/{lesson.total_blocks} blocks
              </span>
              {lesson.total_blocks > 0 && (
                <div className="flex-1 max-w-32">
                  <ProgressBar
                    value={lesson.total_blocks > 0 ? Math.round((lesson.completed_blocks / lesson.total_blocks) * 100) : 0}
                    size="sm"
                    showPercentage={false}
                  />
                </div>
              )}
            </div>
          </div>
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />
          )}
        </button>
        <Link
          to={`/lessons/${lesson.id}`}
          className="text-xs text-primary-600 hover:underline shrink-0 ml-3"
        >
          View
        </Link>
      </div>

      {expanded && lesson.blocks.length > 0 && (
        <div className="border-t border-slate-200 bg-slate-50">
          {lesson.blocks.map((block) => {
            const Icon = BLOCK_ICONS[block.block_type] || FileText
            const colorClass = BLOCK_COLORS[block.block_type] || 'text-slate-400'
            return (
              <div
                key={block.id}
                className="flex items-center gap-3 px-5 py-2.5 border-b border-slate-100 last:border-0"
              >
                <Icon className={`h-3.5 w-3.5 shrink-0 ${colorClass}`} />
                <span className="flex-1 text-xs text-slate-700 truncate">{block.title}</span>
                <span className="text-xs text-slate-400 capitalize w-24 text-right shrink-0">
                  {block.block_type.replace('_', ' ')}
                </span>
                {block.submission && (
                  <span
                    className={`text-xs font-semibold px-1.5 py-0.5 rounded border ${GRADE_STYLES[block.submission.grade || ''] || 'bg-slate-100 text-slate-500 border-slate-200'}`}
                  >
                    {block.submission.grade || 'Submitted'}
                  </span>
                )}
                {block.status === 'completed' ? (
                  <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />
                ) : block.status === 'in_progress' ? (
                  <div className="h-3.5 w-3.5 rounded-full border-2 border-primary-400 shrink-0" />
                ) : (
                  <Circle className="h-3.5 w-3.5 text-slate-200 shrink-0" />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function StudentDetail() {
  const { id } = useParams<{ id: string }>()
  const [data, setData] = useState<ProgressData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expandedModules, setExpandedModules] = useState<Set<number>>(new Set())

  useEffect(() => {
    if (!id) return
    api.getStudentProgress(Number(id)).then((res) => {
      if (res.data) {
        setData(res.data)
        // Auto-expand in-progress module
        if (res.data.modules) {
          const inProgress = res.data.modules.find(
            (m: ProgressData['modules'][0]) =>
              m.progress_percentage > 0 && m.progress_percentage < 100
          )
          if (inProgress) {
            setExpandedModules(new Set([inProgress.id]))
          }
        }
      } else {
        setError(res.error || 'Failed to load student progress')
      }
      setLoading(false)
    })
  }, [id])

  const toggleModule = (moduleId: number) => {
    setExpandedModules((prev) => {
      const next = new Set(prev)
      if (next.has(moduleId)) next.delete(moduleId)
      else next.add(moduleId)
      return next
    })
  }

  if (loading) return <LoadingSpinner message="Loading student progress..." />
  if (error) return (
    <div className="text-center py-12 text-red-500">
      <AlertCircle className="h-8 w-8 mx-auto mb-3 opacity-50" />
      <p>{error}</p>
    </div>
  )
  if (!data) return null

  const { user, cohort, overall_progress, modules, recent_activity } = data

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Back link */}
      <Link
        to="/admin/students"
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Students
      </Link>

      {/* Student header */}
      <div className="rounded-2xl bg-white border border-slate-200 p-6">
        <div className="flex flex-col sm:flex-row sm:items-start gap-4">
          <div className="shrink-0">
            {user.avatar_url ? (
              <img
                src={user.avatar_url}
                alt={user.full_name}
                className="h-14 w-14 rounded-full object-cover"
              />
            ) : (
              <div className="h-14 w-14 rounded-full bg-primary-100 flex items-center justify-center">
                <User className="h-7 w-7 text-primary-600" />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-slate-900">{user.full_name}</h1>
            <p className="text-sm text-slate-500">{user.email}</p>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-slate-500">
              {user.github_username && (
                <a
                  href={`https://github.com/${user.github_username}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-primary-600 hover:underline"
                >
                  <Github className="h-3.5 w-3.5" />
                  @{user.github_username}
                </a>
              )}
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                Last active: {formatRelative(user.last_sign_in_at)}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              {cohort.name} · Started {formatDate(cohort.start_date)}
            </p>
          </div>
          <div className="shrink-0 text-center">
            <ProgressRing percentage={overall_progress.percentage} size={80} label="Overall" />
            <p className="mt-1 text-xs text-slate-500">
              {overall_progress.completed}/{overall_progress.total} blocks
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Modules + lessons (2/3 width) */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-lg font-semibold text-slate-900">Course Progress</h2>
          {modules.map((mod) => {
            const isExpanded = expandedModules.has(mod.id)
            return (
              <div key={mod.id} className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
                <button
                  onClick={() => toggleModule(mod.id)}
                  className="w-full flex items-center gap-3 p-5 hover:bg-slate-50 transition-colors text-left"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900 truncate">{mod.name}</span>
                      <span className="text-sm text-slate-500 shrink-0">
                        {mod.completed_blocks}/{mod.total_blocks}
                      </span>
                    </div>
                    <div className="mt-2">
                      <ProgressBar value={Math.round(mod.progress_percentage)} size="sm" showPercentage={false} />
                    </div>
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-slate-100 p-4 space-y-3">
                    {mod.lessons.length === 0 ? (
                      <p className="text-sm text-slate-400 text-center py-4">No lessons yet</p>
                    ) : (
                      mod.lessons.map((lesson) => (
                        <LessonRow key={lesson.id} lesson={lesson} />
                      ))
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Recent activity (1/3 width) */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-900">Recent Activity</h2>
          <div className="rounded-2xl bg-white border border-slate-200 divide-y divide-slate-100">
            {recent_activity.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-6">No activity yet</p>
            ) : (
              recent_activity.map((activity) => {
                const Icon = BLOCK_ICONS[activity.block_type] || FileText
                const colorClass = BLOCK_COLORS[activity.block_type] || 'text-slate-400'
                return (
                  <div key={activity.content_block_id} className="flex items-start gap-3 p-4">
                    <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${colorClass}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-800 truncate">{activity.block_title}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {formatRelative(activity.completed_at)}
                      </p>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
