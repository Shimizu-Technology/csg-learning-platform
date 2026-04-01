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
  Lock,
  Unlock,
  Save,
} from 'lucide-react'
import { api } from '../../lib/api'
import { ProgressBar } from '../../components/shared/ProgressBar'
import { ProgressRing } from '../../components/shared/ProgressRing'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'

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

interface ModuleAssignment {
  id: number
  module_id: number
  module_name: string
  module_type: string
  unlocked: boolean
  unlock_date_override: string | null
  available: boolean
  next_unlock_date: string | null
}

interface ProgressData {
  enrollment: {
    id: number
    status: string
    module_assignments: ModuleAssignment[]
  }
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
      lesson_assignment: {
        id: number
        unlocked: boolean
        unlock_date_override: string | null
      } | null
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

function toDateInputValue(dateStr: string | null): string {
  if (!dateStr) return ''
  return new Date(dateStr).toISOString().slice(0, 10)
}

function LessonRow({
  lesson,
  form,
  saving,
  onUpdate,
  onSave,
}: {
  lesson: ProgressData['modules'][0]['lessons'][0]
  form: { unlocked: boolean; unlock_date_override: string }
  saving: boolean
  onUpdate: (patch: Partial<{ unlocked: boolean; unlock_date_override: string }>) => void
  onSave: () => void
}) {
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

      {expanded && (
        <div className="border-t border-slate-200 bg-slate-50">
          <div className="px-5 py-3 border-b border-slate-200 bg-white/70 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Lesson Override</p>
                <p className="text-xs text-slate-400">Use this only for student-specific exceptions.</p>
              </div>
              <button
                onClick={onSave}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-primary-500 px-3 py-2 text-xs font-medium text-white hover:bg-primary-600 disabled:opacity-50 transition-colors"
              >
                <Save className="h-3.5 w-3.5" />
                {saving ? 'Saving...' : 'Save Lesson Override'}
              </button>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.unlocked}
                onChange={(e) => onUpdate({ unlocked: e.target.checked })}
                className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
              />
              Unlock this lesson for this student
            </label>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Lesson unlock date override</label>
              <input
                type="date"
                value={form.unlock_date_override}
                onChange={(e) => onUpdate({ unlock_date_override: e.target.value })}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <p className="mt-1 text-xs text-slate-400">Leave blank to use module/default schedule. A lesson-specific override wins over module timing.</p>
            </div>
          </div>
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
  const [assignmentForms, setAssignmentForms] = useState<Record<number, { unlocked: boolean; unlock_date_override: string }>>({})
  const [lessonAssignmentForms, setLessonAssignmentForms] = useState<Record<number, { id?: number; unlocked: boolean; unlock_date_override: string }>>({})
  const [savingAssignmentId, setSavingAssignmentId] = useState<number | null>(null)
  const [savingLessonId, setSavingLessonId] = useState<number | null>(null)
  const [assignmentMessage, setAssignmentMessage] = useState('')

  useEffect(() => {
    if (!id) return
    api.getStudentProgress(Number(id)).then((res) => {
      if (res.data) {
        setData(res.data)
        if (res.data.enrollment?.module_assignments) {
          const nextForms: Record<number, { unlocked: boolean; unlock_date_override: string }> = {}
          res.data.enrollment.module_assignments.forEach((assignment: ModuleAssignment) => {
            nextForms[assignment.id] = {
              unlocked: assignment.unlocked,
              unlock_date_override: toDateInputValue(assignment.unlock_date_override),
            }
          })
          setAssignmentForms(nextForms)
        }
        if (res.data.modules) {
          const nextLessonForms: Record<number, { id?: number; unlocked: boolean; unlock_date_override: string }> = {}
          res.data.modules.forEach((mod: ProgressData['modules'][0]) => {
            mod.lessons.forEach((lesson) => {
              nextLessonForms[lesson.id] = {
                id: lesson.lesson_assignment?.id,
                unlocked: lesson.lesson_assignment?.unlocked || false,
                unlock_date_override: toDateInputValue(lesson.lesson_assignment?.unlock_date_override || null),
              }
            })
          })
          setLessonAssignmentForms(nextLessonForms)
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

  const updateAssignmentForm = (assignmentId: number, patch: Partial<{ unlocked: boolean; unlock_date_override: string }>) => {
    setAssignmentForms((prev) => ({
      ...prev,
      [assignmentId]: {
        ...prev[assignmentId],
        ...patch,
      },
    }))
  }

  const updateLessonAssignmentForm = (lessonId: number, patch: Partial<{ unlocked: boolean; unlock_date_override: string }>) => {
    setLessonAssignmentForms((prev) => ({
      ...prev,
      [lessonId]: {
        ...prev[lessonId],
        ...patch,
      },
    }))
  }

  const saveAssignment = async (assignment: ModuleAssignment) => {
    const form = assignmentForms[assignment.id]
    if (!form) return

    setSavingAssignmentId(assignment.id)
    setAssignmentMessage('')
    const res = await api.updateModuleAssignment(assignment.id, {
      unlocked: form.unlocked,
      unlock_date_override: form.unlock_date_override || null,
    })

    if (res.error) {
      setAssignmentMessage(res.error)
      setSavingAssignmentId(null)
      return
    }

    const assignmentData = res.data?.module_assignment
    if (assignmentData) {
      setData((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          enrollment: {
            ...prev.enrollment,
            module_assignments: prev.enrollment.module_assignments.map((existing) =>
              existing.id === assignment.id
                ? {
                    ...existing,
                    unlocked: assignmentData.unlocked,
                    unlock_date_override: assignmentData.unlock_date_override,
                    next_unlock_date: assignmentData.unlock_date_override || existing.next_unlock_date,
                    available: assignmentData.unlocked ? existing.available : false,
                  }
                : existing
            ),
          },
        }
      })
    }

    setAssignmentMessage(`Saved override for ${assignment.module_name}`)
    if (id) {
      const refreshed = await api.getStudentProgress(Number(id))
      if (refreshed.data) {
        setData(refreshed.data)
        const nextForms: Record<number, { unlocked: boolean; unlock_date_override: string }> = {}
        refreshed.data.enrollment.module_assignments.forEach((nextAssignment: ModuleAssignment) => {
          nextForms[nextAssignment.id] = {
            unlocked: nextAssignment.unlocked,
            unlock_date_override: toDateInputValue(nextAssignment.unlock_date_override),
          }
        })
        setAssignmentForms(nextForms)
        const nextLessonForms: Record<number, { id?: number; unlocked: boolean; unlock_date_override: string }> = {}
        refreshed.data.modules.forEach((mod: ProgressData['modules'][0]) => {
          mod.lessons.forEach((lesson) => {
            nextLessonForms[lesson.id] = {
              id: lesson.lesson_assignment?.id,
              unlocked: lesson.lesson_assignment?.unlocked || false,
              unlock_date_override: toDateInputValue(lesson.lesson_assignment?.unlock_date_override || null),
            }
          })
        })
        setLessonAssignmentForms(nextLessonForms)
      }
    }
    setSavingAssignmentId(null)
  }

  const saveLessonAssignment = async (lesson: ProgressData['modules'][0]['lessons'][0]) => {
    const form = lessonAssignmentForms[lesson.id]
    if (!form) return

    setSavingLessonId(lesson.id)
    setAssignmentMessage('')

    const payload = {
      lesson_id: lesson.id,
      unlocked: form.unlocked,
      unlock_date_override: form.unlock_date_override || null,
    }

    const res = form.id
      ? await api.updateLessonAssignment(form.id, payload)
      : await api.createLessonAssignment(enrollment.id, payload)

    if (res.error) {
      setAssignmentMessage(res.error)
      setSavingLessonId(null)
      return
    }

    setAssignmentMessage(`Saved lesson override for ${lesson.title}`)
    if (id) {
      const refreshed = await api.getStudentProgress(Number(id))
      if (refreshed.data) {
        setData(refreshed.data)
        const nextForms: Record<number, { unlocked: boolean; unlock_date_override: string }> = {}
        refreshed.data.enrollment.module_assignments.forEach((nextAssignment: ModuleAssignment) => {
          nextForms[nextAssignment.id] = {
            unlocked: nextAssignment.unlocked,
            unlock_date_override: toDateInputValue(nextAssignment.unlock_date_override),
          }
        })
        setAssignmentForms(nextForms)
        const nextLessonForms: Record<number, { id?: number; unlocked: boolean; unlock_date_override: string }> = {}
        refreshed.data.modules.forEach((mod: ProgressData['modules'][0]) => {
          mod.lessons.forEach((nextLesson) => {
            nextLessonForms[nextLesson.id] = {
              id: nextLesson.lesson_assignment?.id,
              unlocked: nextLesson.lesson_assignment?.unlocked || false,
              unlock_date_override: toDateInputValue(nextLesson.lesson_assignment?.unlock_date_override || null),
            }
          })
        })
        setLessonAssignmentForms(nextLessonForms)
      }
    }
    setSavingLessonId(null)
  }

  if (loading) return <LoadingSpinner message="Loading student progress..." />
  if (error) return (
    <div className="text-center py-12 text-red-500">
      <AlertCircle className="h-8 w-8 mx-auto mb-3 opacity-50" />
      <p>{error}</p>
    </div>
  )
  if (!data) return null

  const { enrollment, user, cohort, overall_progress, modules, recent_activity } = data

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <Link
        to="/admin/students"
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Students
      </Link>

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
              {cohort.name} · Started {formatDate(cohort.start_date)} · Enrollment {enrollment.status}
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

      {assignmentMessage && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          {assignmentMessage}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-4">
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
                        <LessonRow
                          key={lesson.id}
                          lesson={lesson}
                          form={lessonAssignmentForms[lesson.id] || {
                            unlocked: lesson.lesson_assignment?.unlocked || false,
                            unlock_date_override: toDateInputValue(lesson.lesson_assignment?.unlock_date_override || null),
                          }}
                          saving={savingLessonId === lesson.id}
                          onUpdate={(patch) => updateLessonAssignmentForm(lesson.id, patch)}
                          onSave={() => saveLessonAssignment(lesson)}
                        />
                      ))
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Module Access</h2>
            <p className="text-sm text-slate-500 mt-1">
              Control per-student unlocks and override dates.
            </p>
          </div>
          <div className="rounded-2xl bg-white border border-slate-200 divide-y divide-slate-100">
            {enrollment.module_assignments.map((assignment) => {
              const form = assignmentForms[assignment.id] || {
                unlocked: assignment.unlocked,
                unlock_date_override: toDateInputValue(assignment.unlock_date_override),
              }
              const saving = savingAssignmentId === assignment.id
              return (
                <div key={assignment.id} className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{assignment.module_name}</p>
                      <p className="text-xs text-slate-500 capitalize">
                        {assignment.module_type.replace('_', ' ')}
                        {assignment.available
                          ? ' · available now'
                          : assignment.next_unlock_date
                            ? ` · scheduled ${formatDate(assignment.next_unlock_date)}`
                            : ' · locked'}
                      </p>
                    </div>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${form.unlocked ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}>
                      {form.unlocked ? <Unlock className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                      {form.unlocked ? 'Unlocked' : 'Locked'}
                    </span>
                  </div>

                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={form.unlocked}
                      onChange={(e) => updateAssignmentForm(assignment.id, { unlocked: e.target.checked })}
                      className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                    />
                    Allow access to this module
                  </label>

                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Unlock date override</label>
                    <input
                      type="date"
                      value={form.unlock_date_override}
                      onChange={(e) => updateAssignmentForm(assignment.id, { unlock_date_override: e.target.value })}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                    <p className="mt-1 text-xs text-slate-400">
                      Leave blank to use the module and lesson schedule.
                    </p>
                  </div>

                  <button
                    onClick={() => saveAssignment(assignment)}
                    disabled={saving}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50 transition-colors"
                  >
                    <Save className="h-4 w-4" />
                    {saving ? 'Saving...' : 'Save Access'}
                  </button>
                </div>
              )
            })}
          </div>

          <div>
            <h2 className="text-lg font-semibold text-slate-900">Recent Activity</h2>
          </div>
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
