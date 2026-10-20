import { useEffect, useMemo, useState } from 'react'
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
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
  Plus,
  Trash2,
  Film,
  Eye,
  RotateCcw,
} from 'lucide-react'
import { api } from '../../lib/api'
import { cohortStudentPath } from '../../lib/routes'
import { ProgressBar } from '../../components/shared/ProgressBar'
import { ProgressRing } from '../../components/shared/ProgressRing'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { useToast } from '../../contexts/ToastContext'
import { presenceStatus, usePresenceNow } from '../../lib/presence'
import { subscribeToStaffPresence } from '../../lib/realtime'
import { PresenceBadge, PresenceDot } from '../../components/shared/PresenceBadge'
import { useConfirm } from '../../contexts/ConfirmContext'
import { useAuthContext } from '../../contexts/AuthContext'
import { formatShortDate, formatShortDateTime } from '../../lib/format'
import { Avatar } from '../../components/ui/Avatar'
import { Badge, type BadgeTone } from '../../components/ui/Badge'
import { Button, LinkButton } from '../../components/ui/Button'
import { TextButton } from '../../components/ui/Choice'

const BLOCK_ICONS: Record<string, React.ElementType> = {
  reading: FileText,
  video: PlayCircle,
  exercise: Code,
  code_challenge: Code,
  quiz: AlertCircle,
  assignment: BookOpen,
}

// Block types are told apart by icon; colour stays neutral (status colours are reserved for state).
const BLOCK_COLOR = 'text-ink-muted'

const GRADE_TONES: Record<string, BadgeTone> = {
  A: 'success',
  B: 'success',
  C: 'success',
  R: 'warning',
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
    last_seen_at: string | null
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

interface EnrollmentRouteChoice {
  user: { full_name: string; email: string }
  enrollments: Array<{
    id: number
    cohort_id: number
    cohort_name: string
    status: string
    enrolled_at: string | null
  }>
}

function formatDate(dateStr: string | null): string {
  return formatShortDate(dateStr, '—')
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

interface LessonVideoProgress {
  content_block_id: number
  duration_seconds: number | null
  total_watched_seconds: number
  progress_percentage: number
  completed: boolean
  completed_at: string | null
  last_watched_at: string | null
}

interface RecordingProgress {
  recording_id: number
  recording_title: string
  cohort_id: number
  duration_seconds: number | null
  total_watched_seconds: number
  progress_percentage: number
  completed: boolean
  last_watched_at: string | null
}

function formatWatchedDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `<1m`
}

function formatLastActive(iso: string | null | undefined): string {
  if (!iso) return 'Never'
  const date = new Date(iso)
  const diffMs = Date.now() - date.getTime()
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return formatShortDate(date)
}

interface WatchProgressDetailsProps {
  progressPercentage: number
  completed: boolean
  totalWatchedSeconds: number
  durationSeconds: number | null
  lastActiveAt?: string | null
  layout?: 'inline' | 'block'
}

// Rich progress strip used inline beneath a video / recording row. Shows the
// status pill, a thin progress bar, watched/total minutes, and last-active —
// the same level of detail the standalone watch progress page used to have,
// but folded directly into the curriculum tree.
function WatchProgressDetails({
  progressPercentage,
  completed,
  totalWatchedSeconds,
  durationSeconds,
  lastActiveAt,
  layout = 'inline',
}: WatchProgressDetailsProps) {
  const pct = Math.round(progressPercentage)
  const watched = formatWatchedDuration(totalWatchedSeconds)
  const total = formatWatchedDuration(durationSeconds)

  const statusLabel = completed ? 'Watched' : pct > 0 ? 'In progress' : 'Not started'
  const statusTone: BadgeTone = completed ? 'success' : 'neutral'
  const barTone = completed ? 'bg-success-600' : pct > 0 ? 'bg-ink-secondary' : 'bg-line-strong'

  return (
    <div
      className={
        layout === 'block'
          ? 'flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted'
          : 'flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted mt-1'
      }
    >
      <Badge tone={statusTone} icon={<Eye className="h-3 w-3" aria-hidden="true" />} className="tabular-nums">
        {statusLabel} · {pct}%
      </Badge>
      <div className="flex items-center gap-1.5 min-w-[80px] flex-1 max-w-[160px]">
        <div className="h-1 flex-1 rounded-full bg-surface-sunken overflow-hidden">
          <div
            className={`h-full rounded-full ${barTone}`}
            style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
          />
        </div>
      </div>
      <span className="tabular-nums" title={`Watched ${watched} of ${total}`}>
        <span className="text-ink-secondary font-medium">{watched}</span>
        <span className="text-ink-muted"> / {total}</span>
      </span>
      <span className="tabular-nums" title={lastActiveAt ? formatShortDateTime(lastActiveAt) : 'Never watched'}>
        Last active: <span className="text-ink-secondary">{formatLastActive(lastActiveAt)}</span>
      </span>
    </div>
  )
}

function LessonRow({
  lesson,
  form,
  saving,
  onUpdate,
  onSave,
  videoProgressByBlockId,
}: {
  lesson: ProgressData['modules'][0]['lessons'][0]
  form: { unlocked: boolean; unlock_date_override: string }
  saving: boolean
  onUpdate: (patch: Partial<{ unlocked: boolean; unlock_date_override: string }>) => void
  onSave: () => void
  videoProgressByBlockId: Map<number, LessonVideoProgress>
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="border border-line rounded-xl overflow-hidden">
      <div className="flex items-center gap-3 p-4 transition-colors duration-150 hover:bg-surface-sunken">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          className="pressable flex min-h-11 flex-1 items-center gap-3 rounded-lg text-left min-w-0"
        >
          {lesson.completed ? (
            <CheckCircle className="h-4 w-4 text-success-600 shrink-0" aria-hidden="true" />
          ) : lesson.available ? (
            <Circle className="h-4 w-4 text-ink-muted shrink-0" aria-hidden="true" />
          ) : (
            <Clock className="h-4 w-4 text-ink-muted shrink-0" aria-hidden="true" />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span className="text-sm font-medium text-ink truncate" title={lesson.title}>{lesson.title}</span>
              {lesson.required && (
                <Badge>Required</Badge>
              )}
              {!lesson.available && (
                <Badge icon={<Lock className="h-3 w-3" aria-hidden="true" />}>Locked</Badge>
              )}
            </div>
            <div className="mt-1 flex items-center gap-3">
              <span className="text-xs tabular-nums text-ink-muted">
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
            <ChevronDown className="h-4 w-4 text-ink-muted shrink-0" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-4 w-4 text-ink-muted shrink-0" aria-hidden="true" />
          )}
        </button>
        <Link
          to={`/lessons/${lesson.id}`}
          className="app-link inline-flex min-h-11 shrink-0 items-center px-2 text-xs"
        >
          View
        </Link>
      </div>

      {expanded && (
        <div className="border-t border-line bg-surface-sunken">
          <div className="px-5 py-3 border-b border-line bg-surface-raised space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-ink-muted">Lesson override</p>
                <p className="text-xs text-ink-muted">Use this only for student-specific exceptions.</p>
              </div>
              <Button size="sm" onClick={onSave} disabled={saving}>
                <Save className="h-3.5 w-3.5" aria-hidden="true" />
                {saving ? 'Saving...' : 'Save lesson override'}
              </Button>
            </div>
            <label className="flex min-h-11 items-center gap-2 text-sm text-ink-secondary">
              <input
                type="checkbox"
                checked={form.unlocked}
                onChange={(e) => onUpdate({ unlocked: e.target.checked })}
                className="h-4 w-4 rounded border-line-strong"
              />
              Unlock this lesson for this student
            </label>
            <div>
              <label className="block text-xs font-semibold text-ink-secondary mb-1">Lesson unlock date override</label>
              <input
                type="date"
                value={form.unlock_date_override}
                onChange={(e) => onUpdate({ unlock_date_override: e.target.value })}
                className="app-control w-full tabular-nums"
              />
              <p className="mt-1 text-xs text-ink-muted">Leave blank to use module/default schedule. A lesson-specific override wins over module timing.</p>
            </div>
          </div>
          {lesson.blocks.map((block) => {
            const Icon = BLOCK_ICONS[block.block_type] || FileText
            const colorClass = BLOCK_COLOR
            const watchProgress =
              (block.block_type === 'video' || block.block_type === 'recording')
                ? videoProgressByBlockId.get(block.id)
                : undefined
            return (
              <div
                key={block.id}
                className="px-5 py-2.5 border-b border-line last:border-0"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Icon className={`h-3.5 w-3.5 shrink-0 ${colorClass}`} aria-hidden="true" />
                  <span className="min-w-0 flex-1 text-xs text-ink-secondary truncate" title={block.title}>{block.title}</span>
                  <span className="hidden text-xs text-ink-muted capitalize w-20 text-right shrink-0 sm:inline">
                    {block.block_type.replace('_', ' ')}
                  </span>
                  {block.submission && (
                    <Badge tone={block.submission.grade ? GRADE_TONES[block.submission.grade] || 'neutral' : 'pending'}>
                      {block.submission.grade || 'Submitted'}
                    </Badge>
                  )}
                  {block.status === 'completed' ? (
                    <CheckCircle className="h-3.5 w-3.5 text-success-600 shrink-0" aria-label="Completed" />
                  ) : block.status === 'in_progress' ? (
                    <div className="h-3.5 w-3.5 rounded-full border-2 border-ink-muted shrink-0" aria-label="In progress" />
                  ) : (
                    <Circle className="h-3.5 w-3.5 text-line-strong shrink-0" aria-hidden="true" />
                  )}
                </div>
                {watchProgress && (
                  <div className="pl-7 pr-1">
                    <WatchProgressDetails
                      progressPercentage={watchProgress.progress_percentage}
                      completed={watchProgress.completed}
                      totalWatchedSeconds={watchProgress.total_watched_seconds}
                      durationSeconds={watchProgress.duration_seconds}
                      lastActiveAt={watchProgress.last_watched_at || watchProgress.completed_at}
                    />
                  </div>
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
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const legacyCohortId = Number(searchParams.get('cohort_id')) || undefined
  const toast = useToast()
  const confirmAction = useConfirm()
  const { user: currentUser } = useAuthContext()
  const presenceNow = usePresenceNow()
  const [data, setData] = useState<ProgressData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expandedModules, setExpandedModules] = useState<Set<number>>(new Set())
  const [assignmentForms, setAssignmentForms] = useState<Record<number, { unlocked: boolean; unlock_date_override: string }>>({})
  const [lessonAssignmentForms, setLessonAssignmentForms] = useState<Record<number, { id?: number; unlocked: boolean; unlock_date_override: string }>>({})
  const [savingAssignmentId, setSavingAssignmentId] = useState<number | null>(null)
  const [creatingModuleId, setCreatingModuleId] = useState<number | null>(null)
  const [deletingAssignmentId, setDeletingAssignmentId] = useState<number | null>(null)
  const [savingLessonId, setSavingLessonId] = useState<number | null>(null)
  const [assignmentMessage, setAssignmentMessage] = useState('')
  const [editingUser, setEditingUser] = useState(false)
  const [editForm, setEditForm] = useState({ first_name: '', last_name: '', email: '', github_username: '' })
  const [savingUser, setSavingUser] = useState(false)
  const [restartingEnrollment, setRestartingEnrollment] = useState(false)
  const [recordingProgress, setRecordingProgress] = useState<RecordingProgress[]>([])
  const [lessonVideoProgress, setLessonVideoProgress] = useState<LessonVideoProgress[]>([])
  const [enrollmentRouteChoice, setEnrollmentRouteChoice] = useState<EnrollmentRouteChoice | null>(null)
  const legacyMode = searchParams.get('legacy') === '1'

  const notifySuccess = (message: string) => {
    setAssignmentMessage(message)
    toast.success(message)
  }

  const notifyError = (message: string) => {
    setAssignmentMessage(message)
    toast.error(message)
  }

  const lessonVideoProgressByBlockId = useMemo(() => {
    const map = new Map<number, LessonVideoProgress>()
    lessonVideoProgress.forEach((v) => map.set(v.content_block_id, v))
    return map
  }, [lessonVideoProgress])

  const restartEnrollment = async () => {
    if (!data || restartingEnrollment) return

    const confirmed = await confirmAction({
      title: `Restart ${data.user.full_name}'s class progress?`,
      description: `This clears submissions, lesson and recording progress, and student-specific lesson overrides for ${data.cohort.name}. Messages, identity, and work from other curricula stay intact. A recovery snapshot, owned intervention, weekly follow-up, and recovery plan are created automatically.`,
      confirmLabel: 'Restart class progress',
      tone: 'danger',
      confirmationText: data.user.email,
      confirmationLabel: `Type ${data.user.email} to confirm`,
    })
    if (!confirmed) return

    setRestartingEnrollment(true)
    try {
      const response = await api.restartEnrollment(
        data.enrollment.id,
        data.user.email,
        'Restarted from student detail'
      )
      if (response.error) {
        notifyError(response.error)
        return
      }

      const refreshed = await api.getStudentProgress(data.user.id, data.cohort.id)
      if (refreshed.error) {
        notifyError(`Progress restarted, but the refreshed student view could not load: ${refreshed.error}`)
        return
      }
      if (refreshed.data) setData(refreshed.data)
      setRecordingProgress([])
      setLessonVideoProgress([])
      notifySuccess('Class progress restarted. An owned recovery plan and weekly follow-up are ready in the student workspace.')
    } catch (restartError) {
      notifyError(restartError instanceof Error ? restartError.message : 'Could not restart class progress')
    } finally {
      setRestartingEnrollment(false)
    }
  }

  useEffect(() => {
    if (!id || (!legacyMode && !legacyCohortId)) return
    api.getStudentWatchProgress(Number(id), legacyCohortId).then((res) => {
      if (res.data?.watch_progresses) setRecordingProgress(res.data.watch_progresses)
    })
    api.getStudentLessonVideoProgress(Number(id), legacyCohortId).then((res) => {
      if (res.data?.lesson_videos) setLessonVideoProgress(res.data.lesson_videos)
    })
  }, [id, legacyCohortId, legacyMode])

  useEffect(() => {
    if (!id) return

    if (!legacyMode && !legacyCohortId) {
      api.getUser(Number(id)).then((res) => {
        if (!res.data) {
          setError(res.error || 'Failed to load student enrollments')
          setLoading(false)
          return
        }

        const enrollments = [...res.data.enrollments].sort((left, right) => {
          if (left.status === 'active' && right.status !== 'active') return -1
          if (right.status === 'active' && left.status !== 'active') return 1
          return (right.enrolled_at || '').localeCompare(left.enrolled_at || '')
        })
        if (enrollments.length === 1) {
          navigate(cohortStudentPath(enrollments[0].cohort_id, Number(id)), { replace: true })
          return
        }
        if (enrollments.length > 1) {
          setEnrollmentRouteChoice({ user: res.data.user, enrollments })
        } else {
          setError('This student does not have an enrollment workspace yet.')
        }
        setLoading(false)
      })
      return
    }

    api.getStudentProgress(Number(id), legacyCohortId).then((res) => {
      if (res.data) {
        if (!legacyMode) {
          navigate(cohortStudentPath(res.data.cohort.id, res.data.user.id), { replace: true })
          return
        }
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
  }, [id, legacyCohortId, legacyMode, navigate])

  useEffect(() => {
    if (!id) return

    let unsubscribe: (() => void) | undefined
    let active = true
    const studentId = Number(id)

    subscribeToStaffPresence((event) => {
      if (!active || event.user_id !== studentId) return

      setData((current) => {
        if (!current) return current

        return {
          ...current,
          user: {
            ...current.user,
            last_seen_at: event.last_seen_at,
          },
        }
      })
    }).then((nextUnsubscribe) => {
      if (active) unsubscribe = nextUnsubscribe
      else nextUnsubscribe()
    }).catch(() => {
      // Student progress refetches and heartbeat timestamps remain the fallback.
    })

    return () => {
      active = false
      unsubscribe?.()
    }
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
      notifyError(res.error)
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

    notifySuccess(`Saved override for ${assignment.module_name}`)
    if (id) {
      const refreshed = await api.getStudentProgress(Number(id), data?.cohort.id || legacyCohortId)
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
      notifyError(res.error)
      setSavingLessonId(null)
      return
    }

    notifySuccess(`Saved lesson override for ${lesson.title}`)
    if (id) {
      const refreshed = await api.getStudentProgress(Number(id), data?.cohort.id || legacyCohortId)
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
  if (enrollmentRouteChoice) return (
    <div className="app-page max-w-3xl space-y-6">
      <Link to="/admin/students" className="app-link inline-flex min-h-11 items-center gap-1 px-1 text-sm"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Students</Link>
      <section className="app-surface overflow-hidden">
        <div className="border-b border-line p-6">
          <p className="app-eyebrow">Choose an enrollment</p>
          <h1 className="app-title mt-2 [overflow-wrap:anywhere]">{enrollmentRouteChoice.user.full_name}</h1>
          <p className="mt-2 truncate text-sm text-ink-muted" title={enrollmentRouteChoice.user.email}>{enrollmentRouteChoice.user.email}</p>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-ink-secondary">This student belongs to more than one cohort. Choose the enrollment you want so progress, support, messages, and access controls stay in the right context.</p>
        </div>
        <div className="divide-y divide-line">
          {enrollmentRouteChoice.enrollments.map((choice) => (
            <Link key={choice.id} to={cohortStudentPath(choice.cohort_id, Number(id))} className="group pressable flex min-h-20 items-center justify-between gap-4 px-6 py-4 hover:bg-surface-sunken">
              <div className="min-w-0">
                <p className="font-semibold text-ink [overflow-wrap:anywhere]">{choice.cohort_name}</p>
                <p className="mt-1 text-xs tabular-nums text-ink-muted">{choice.enrolled_at ? `Enrolled ${formatShortDate(choice.enrolled_at)}` : 'Enrollment date unavailable'}</p>
              </div>
              <span className="inline-flex shrink-0 items-center gap-2 text-ink-muted group-hover:text-ink"><Badge tone={choice.status === 'active' ? 'success' : 'neutral'} className="capitalize">{choice.status}</Badge><ChevronRight className="h-4 w-4" aria-hidden="true" /></span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
  if (error) return (
    <div role="alert" className="mx-auto mt-6 max-w-xl rounded-2xl border border-danger-200 bg-danger-50 px-4 py-8 text-center text-sm text-danger-700">
      <AlertCircle className="h-8 w-8 mx-auto mb-3" aria-hidden="true" />
      <p>{error}</p>
    </div>
  )
  if (!data) return null

  const { enrollment, user, cohort, overall_progress, modules, recent_activity } = data
  const assignedModuleIds = new Set(enrollment.module_assignments.map((assignment) => assignment.module_id))
  const assignableModules = modules.filter((mod) => !assignedModuleIds.has(mod.id))
  const status = presenceStatus(user.last_seen_at, presenceNow)

  const createModuleAssignment = async (moduleId: number) => {
    setCreatingModuleId(moduleId)
    setAssignmentMessage('')
    const res = await api.createModuleAssignment(enrollment.id, { module_id: moduleId, unlocked: false })
    if (res.error) {
      notifyError(res.error)
      setCreatingModuleId(null)
      return
    }

    if (id) {
      const refreshed = await api.getStudentProgress(Number(id), data?.cohort.id || legacyCohortId)
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

    const moduleName = modules.find((mod) => mod.id === moduleId)?.name || 'module'
    notifySuccess(`Assigned ${moduleName} to ${user.full_name}`)
    setCreatingModuleId(null)
  }

  const deleteModuleAssignment = async (assignment: ModuleAssignment) => {
    setDeletingAssignmentId(assignment.id)
    setAssignmentMessage('')
    const res = await api.deleteModuleAssignment(assignment.id)
    if (res.error) {
      notifyError(res.error)
      setDeletingAssignmentId(null)
      return
    }

    if (id) {
      const refreshed = await api.getStudentProgress(Number(id), data?.cohort.id || legacyCohortId)
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

    notifySuccess(`Removed ${assignment.module_name} from ${user.full_name}`)
    setDeletingAssignmentId(null)
  }

  return (
    <div className="app-page max-w-6xl">
      <Button variant="quiet" size="sm" className="-ml-3 self-start" onClick={() => navigate(-1)}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back
      </Button>

      <section className="app-surface p-6">
        <div className="flex flex-col sm:flex-row sm:items-start gap-4">
          <Avatar name={user.full_name} src={user.avatar_url} size="lg" />
          <div className="flex-1 min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1 className="min-w-0 max-w-full truncate text-xl font-bold text-ink" title={user.full_name}>{user.full_name}</h1>
              <PresenceBadge status={status} className="px-2 py-0.5" />
              {!editingUser && (
                <TextButton
                  className="text-sm"
                  onClick={() => {
                    const nameParts = (user.full_name || '').split(' ')
                    setEditForm({
                      first_name: nameParts[0] || '',
                      last_name: nameParts.slice(1).join(' ') || '',
                      email: user.email || '',
                      github_username: user.github_username || '',
                    })
                    setEditingUser(true)
                  }}
                >
                  Edit
                </TextButton>
              )}
            </div>
            <p className="truncate text-sm text-ink-muted" title={user.email}>{user.email}</p>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-ink-muted">
              {user.github_username ? (
                <a
                  href={`https://github.com/${user.github_username}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="app-link inline-flex min-w-0 items-center gap-1.5 [overflow-wrap:anywhere]"
                >
                  <Github className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  @{user.github_username}
                </a>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-ink-muted">
                  <Github className="h-3.5 w-3.5" aria-hidden="true" />
                  No GitHub username
                </span>
              )}
              <span className="inline-flex items-center gap-1.5 tabular-nums">
                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                Last login: {formatRelative(user.last_sign_in_at)}
              </span>
              <span className="inline-flex items-center gap-1.5 tabular-nums">
                <PresenceDot status={status} className="h-3.5 w-3.5" />
                Last active: {formatRelative(user.last_seen_at)}
              </span>
            </div>
            <p className="mt-1 text-xs tabular-nums text-ink-muted [overflow-wrap:anywhere]">
              {cohort.name} · Started {formatDate(cohort.start_date)} · Enrollment {enrollment.status}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-center text-center">
            <ProgressRing percentage={overall_progress.percentage} size={80} label="Overall" />
            <p className="mt-1 text-xs tabular-nums text-ink-muted">
              {overall_progress.completed}/{overall_progress.total} blocks
            </p>
            <LinkButton
              to={`/admin/cohorts/${cohort.id}/student-view`}
              variant="secondary"
              size="sm"
              className="mt-3"
            >
              <Eye className="h-3.5 w-3.5" aria-hidden="true" />
              Preview cohort template
            </LinkButton>
            {currentUser?.is_admin && (
              <Button
                variant="danger"
                size="sm"
                fullWidth
                className="mt-2"
                onClick={restartEnrollment}
                disabled={restartingEnrollment}
              >
                <RotateCcw className={`h-3.5 w-3.5 ${restartingEnrollment ? 'animate-spin' : ''}`} aria-hidden="true" />
                {restartingEnrollment ? 'Restarting…' : 'Restart class progress'}
              </Button>
            )}
          </div>
        </div>

        {editingUser && (
          <form
            onSubmit={async (e) => {
              e.preventDefault()
              setSavingUser(true)
              setAssignmentMessage('')
              const res = await api.updateUser(user.id, {
                first_name: editForm.first_name.trim() || undefined,
                last_name: editForm.last_name.trim() || undefined,
                github_username: editForm.github_username.trim() || undefined,
              })
              if (res.error) {
                notifyError(`Failed to update: ${res.error}`)
              } else {
                notifySuccess('Student updated')
                setEditingUser(false)
                if (id) {
                  const refreshed = await api.getStudentProgress(Number(id), data?.cohort.id || legacyCohortId)
                  if (refreshed.data) setData(refreshed.data)
                }
              }
              setSavingUser(false)
            }}
            className="mt-4 border-t border-line pt-4 grid grid-cols-1 sm:grid-cols-2 gap-3"
          >
            <div>
              <label className="block text-xs font-semibold text-ink-secondary mb-1">First name</label>
              <input type="text" value={editForm.first_name} onChange={(e) => setEditForm((f) => ({ ...f, first_name: e.target.value }))} className="app-control w-full" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-ink-secondary mb-1">Last name</label>
              <input type="text" value={editForm.last_name} onChange={(e) => setEditForm((f) => ({ ...f, last_name: e.target.value }))} className="app-control w-full" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-ink-secondary mb-1">GitHub username</label>
              <input type="text" value={editForm.github_username} onChange={(e) => setEditForm((f) => ({ ...f, github_username: e.target.value }))} placeholder="e.g., octocat" className="app-control w-full" />
            </div>
            <div className="flex items-end gap-2">
              <Button type="submit" disabled={savingUser}>
                {savingUser ? 'Saving...' : 'Save changes'}
              </Button>
              <Button variant="quiet" onClick={() => setEditingUser(false)}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </section>

      {assignmentMessage && (
        <div role="status" className="rounded-xl border border-line bg-surface-sunken px-4 py-3 text-sm text-ink-secondary">
          {assignmentMessage}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-4">
          <h2 className="text-lg font-bold text-ink">Course progress</h2>
          {modules.map((mod) => {
            const isExpanded = expandedModules.has(mod.id)
            return (
              <div key={mod.id} className="app-surface overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleModule(mod.id)}
                  aria-expanded={isExpanded}
                  className="pressable w-full flex min-h-11 items-center gap-3 p-5 hover:bg-surface-sunken text-left"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-ink-muted shrink-0" aria-hidden="true" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-ink-muted shrink-0" aria-hidden="true" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-ink truncate" title={mod.name}>{mod.name}</span>
                      <span className="text-sm tabular-nums text-ink-muted shrink-0">
                        {mod.completed_blocks}/{mod.total_blocks}
                      </span>
                    </div>
                    <div className="mt-2">
                      <ProgressBar value={Math.round(mod.progress_percentage)} size="sm" showPercentage={false} />
                    </div>
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-line p-4 space-y-3">
                    {mod.lessons.length === 0 ? (
                      <p className="text-sm text-ink-muted text-center py-4">No lessons yet</p>
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
                          videoProgressByBlockId={lessonVideoProgressByBlockId}
                        />
                      ))
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {recordingProgress.length > 0 && (() => {
            const completedCount = recordingProgress.filter((r) => r.completed).length
            const inProgressCount = recordingProgress.filter((r) => !r.completed && r.total_watched_seconds > 0).length
            const totalWatched = recordingProgress.reduce((sum, r) => sum + r.total_watched_seconds, 0)
            return (
              <div className="app-surface overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-line">
                  <div className="flex items-center gap-2">
                    <Film className="h-4 w-4 text-ink-muted" aria-hidden="true" />
                    <h3 className="text-base font-semibold text-ink">Class recordings</h3>
                    <span className="text-xs text-ink-muted tabular-nums">
                      ({completedCount}/{recordingProgress.length} watched)
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-ink-muted tabular-nums">
                    <span><span className="text-success-700 font-medium">{completedCount}</span> done</span>
                    <span><span className="text-ink-secondary font-medium">{inProgressCount}</span> in progress</span>
                    <span><span className="text-ink-secondary font-medium">{formatWatchedDuration(totalWatched)}</span> total watched</span>
                  </div>
                </div>
                <div className="divide-y divide-line">
                  {recordingProgress.map((rec) => {
                    const pct = Math.round(rec.progress_percentage)
                    return (
                      <div
                        key={rec.recording_id}
                        className="px-5 py-2.5"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <PlayCircle className="h-3.5 w-3.5 text-ink-muted shrink-0" aria-hidden="true" />
                          <span className="min-w-0 flex-1 text-xs text-ink-secondary truncate" title={rec.recording_title}>{rec.recording_title}</span>
                          {rec.completed ? (
                            <CheckCircle className="h-3.5 w-3.5 text-success-600 shrink-0" aria-label="Watched" />
                          ) : pct > 0 ? (
                            <div className="h-3.5 w-3.5 rounded-full border-2 border-ink-muted shrink-0" aria-label="In progress" />
                          ) : (
                            <Circle className="h-3.5 w-3.5 text-line-strong shrink-0" aria-hidden="true" />
                          )}
                        </div>
                        <div className="pl-7 pr-1">
                          <WatchProgressDetails
                            progressPercentage={rec.progress_percentage}
                            completed={rec.completed}
                            totalWatchedSeconds={rec.total_watched_seconds}
                            durationSeconds={rec.duration_seconds}
                            lastActiveAt={rec.last_watched_at}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}
        </div>

        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-bold text-ink">Module access</h2>
            <p className="text-sm text-ink-muted mt-1">
              Control per-student unlocks and override dates.
            </p>
          </div>
          {assignableModules.length > 0 && (
            <div className="app-surface p-4 space-y-3">
              <div>
                <h3 className="text-base font-semibold text-ink">Assign additional modules</h3>
                <p className="text-xs text-ink-muted mt-1">Give this student access to modules that exist in the curriculum but are not yet assigned.</p>
              </div>
              <div className="space-y-2">
                {assignableModules.map((mod) => (
                  <div key={mod.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface-sunken px-3 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink [overflow-wrap:anywhere]">{mod.name}</p>
                      <p className="text-xs tabular-nums text-ink-muted capitalize">{mod.module_type.replace('_', ' ')} · {mod.lessons.length} lessons</p>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => createModuleAssignment(mod.id)}
                      disabled={creatingModuleId === mod.id}
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                      {creatingModuleId === mod.id ? 'Assigning...' : 'Assign module'}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="app-surface divide-y divide-line">
            {enrollment.module_assignments.map((assignment) => {
              const form = assignmentForms[assignment.id] || {
                unlocked: assignment.unlocked,
                unlock_date_override: toDateInputValue(assignment.unlock_date_override),
              }
              const saving = savingAssignmentId === assignment.id
              return (
                <div key={assignment.id} className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink [overflow-wrap:anywhere]">{assignment.module_name}</p>
                      <p className="text-xs tabular-nums text-ink-muted capitalize">
                        {assignment.module_type.replace('_', ' ')}
                        {assignment.available
                          ? ' · available now'
                          : assignment.next_unlock_date
                            ? ` · scheduled ${formatDate(assignment.next_unlock_date)}`
                            : ' · locked'}
                      </p>
                    </div>
                    <Badge tone={form.unlocked ? 'success' : 'neutral'} icon={form.unlocked ? <Unlock className="h-3 w-3" aria-hidden="true" /> : <Lock className="h-3 w-3" aria-hidden="true" />}>
                      {form.unlocked ? 'Unlocked' : 'Locked'}
                    </Badge>
                  </div>

                  <label className="flex min-h-11 items-center gap-2 text-sm text-ink-secondary">
                    <input
                      type="checkbox"
                      checked={form.unlocked}
                      onChange={(e) => updateAssignmentForm(assignment.id, { unlocked: e.target.checked })}
                      className="h-4 w-4 rounded border-line-strong"
                    />
                    Allow access to this module
                  </label>

                  <div>
                    <label className="block text-xs font-semibold text-ink-secondary mb-1">Unlock date override</label>
                    <input
                      type="date"
                      value={form.unlock_date_override}
                      onChange={(e) => updateAssignmentForm(assignment.id, { unlock_date_override: e.target.value })}
                      className="app-control w-full tabular-nums"
                    />
                    <p className="mt-1 text-xs text-ink-muted">
                      Leave blank to use the module and lesson schedule.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => deleteModuleAssignment(assignment)}
                      disabled={deletingAssignmentId === assignment.id}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                      {deletingAssignmentId === assignment.id ? 'Removing...' : 'Remove'}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => saveAssignment(assignment)}
                      disabled={saving}
                    >
                      <Save className="h-4 w-4" aria-hidden="true" />
                      {saving ? 'Saving...' : 'Save access'}
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>

          <div>
            <h2 className="text-lg font-bold text-ink">Recent activity</h2>
          </div>
          <div className="app-surface divide-y divide-line">
            {recent_activity.length === 0 ? (
              <p className="text-sm text-ink-muted text-center py-6">No activity yet</p>
            ) : (
              recent_activity.map((activity) => {
                const Icon = BLOCK_ICONS[activity.block_type] || FileText
                const colorClass = BLOCK_COLOR
                return (
                  <div key={activity.content_block_id} className="flex items-start gap-3 p-4">
                    <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${colorClass}`} aria-hidden="true" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-ink truncate" title={activity.block_title}>{activity.block_title}</p>
                      <p className="text-xs tabular-nums text-ink-muted mt-0.5">
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
