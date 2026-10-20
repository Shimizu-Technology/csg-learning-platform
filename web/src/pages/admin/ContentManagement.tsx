import { useEffect, useState, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Archive,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Code,
  Eye,
  Pencil,
  Plus,
  CalendarPlus,
  RotateCcw,
  Upload,
} from 'lucide-react'
import { api } from '../../lib/api'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { NewExerciseModal } from './NewExerciseModal'
import { NewModuleModal } from './NewModuleModal'
import { NewCurriculumModal } from './NewCurriculumModal'
import { ImportCoursePackageModal } from './ImportCoursePackageModal'
import { CourseResourcesPanel } from './CourseResourcesPanel'
import { ALL_DAY_NAMES, SCHEDULE_DAY_INDICES } from '../../lib/scheduleConstants'
import { useUpload } from '../../contexts/UploadContext'
import { useToast } from '../../contexts/ToastContext'
import { useAuthContext } from '../../contexts/AuthContext'
import { Button, IconButton } from '../../components/ui/Button'
import { TabButton, TextButton } from '../../components/ui/Choice'
import { Badge } from '../../components/ui/Badge'

interface Lesson {
  id: number
  title: string
  lesson_type: string
  position: number
  release_day: number
  requires_submission?: boolean
  submission_type?: string
  content_blocks_count: number
  archived_at: string | null
  updated_at: string
}

interface Module {
  id: number
  curriculum_id?: number
  name: string
  module_type: string
  position: number
  schedule_days: string
  scheduled_day_names: string[]
  week_count: number
  updated_at: string
  lessons: Lesson[]
}

interface Curriculum {
  id: number
  name: string
  status: string
  modules: Module[]
}

function groupLessonsByDay(lessons: Lesson[]) {
  const groups: Record<number, Lesson[]> = {}
  for (const lesson of lessons) {
    if (!groups[lesson.release_day]) groups[lesson.release_day] = []
    groups[lesson.release_day].push(lesson)
  }
  return groups
}

const SCHEDULE_PATTERN_OPTIONS = [
  { value: 'weekdays', label: 'MTWTF / Mon–Fri' },
  { value: 'weekdays_sat', label: 'Mon–Sat' },
  { value: 'mwf', label: 'MWF' },
  { value: 'tth', label: 'Tue/Thu' },
  { value: 'daily', label: 'Every day' },
]

export function ContentManagement() {
  const navigate = useNavigate()
  const { attachUpload } = useUpload()
  const toast = useToast()
  const { user } = useAuthContext()
  const canManageModules = Boolean(user?.is_admin)
  const [curricula, setCurricula] = useState<Curriculum[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedModules, setExpandedModules] = useState<Set<number>>(new Set())
  const [activeWeekTab, setActiveWeekTab] = useState<Record<number, number>>({})
  const [exerciseModal, setExerciseModal] = useState<{
    moduleId: number
    moduleName: string
    curriculumId: number
    scheduleDays: string
    weekCount: number
    defaultWeek: number
    defaultDayIndex: number
  } | null>(null)
  const [newModuleModal, setNewModuleModal] = useState<{ curriculumId: number; moduleCount: number } | null>(null)
  const [showNewCurriculum, setShowNewCurriculum] = useState(false)
  const [showPackageImport, setShowPackageImport] = useState(false)
  const [exerciseSaving, setExerciseSaving] = useState(false)
  const [moduleSaving, setModuleSaving] = useState(false)
  const [curriculumSaving, setCurriculumSaving] = useState(false)
  const [scheduleSavingId, setScheduleSavingId] = useState<number | null>(null)
  const [restoringLessonId, setRestoringLessonId] = useState<number | null>(null)
  const [exerciseCreateError, setExerciseCreateError] = useState('')
  const [moduleCreateError, setModuleCreateError] = useState('')
  const [curriculumCreateError, setCurriculumCreateError] = useState('')
  const [extraWeeks, setExtraWeeks] = useState<Record<number, number>>({})

  const loadCurricula = async () => {
    const res = await api.getCurricula()
    if (res.data?.curricula) {
      const detailed = await Promise.all(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        res.data.curricula.map(async (c: any) => {
          const detail = await api.getCurriculum(c.id)
          return detail.data?.curriculum || c
        })
      )
      setCurricula(detailed)
    }
    setLoading(false)
  }

  useEffect(() => { loadCurricula() }, [])

  const toggleModule = (moduleId: number) => {
    const next = new Set(expandedModules)
    if (next.has(moduleId)) {
      next.delete(moduleId)
    } else {
      next.add(moduleId)
    }
    setExpandedModules(next)
  }

  const openExerciseForDay = (mod: Module, week: number, dayIndex: number) => {
    setExerciseCreateError('')
    setExerciseModal({
      moduleId: mod.id,
      moduleName: mod.name,
      curriculumId: mod.curriculum_id || 0,
      scheduleDays: mod.schedule_days || 'weekdays',
      weekCount: mod.week_count || 1,
      defaultWeek: week,
      defaultDayIndex: dayIndex,
    })
  }

  const addWeek = (mod: Module) => {
    const existingWeeks = new Set<number>()
    for (const l of (mod.lessons || [])) {
      existingWeeks.add(Math.floor(l.release_day / 7) + 1)
    }
    const nextWeek = existingWeeks.size > 0 ? Math.max(...existingWeeks) + 1 : 1

    if (!expandedModules.has(mod.id)) {
      const next = new Set(expandedModules)
      next.add(mod.id)
      setExpandedModules(next)
    }

    setActiveWeekTab(prev => ({ ...prev, [mod.id]: nextWeek }))
    setExtraWeeks(prev => ({ ...prev, [mod.id]: nextWeek }))
  }

  const updateModuleSchedule = async (mod: Module, scheduleDays: string) => {
    if (mod.schedule_days === scheduleDays) return

    setScheduleSavingId(mod.id)
    const res = await api.updateModule(mod.id, { schedule_days: scheduleDays, base_updated_at: mod.updated_at })
    if (res.error) {
      toast.error(res.error)
      setScheduleSavingId(null)
      return
    }

    setCurricula((current) => current.map((curriculum) => ({
      ...curriculum,
      modules: curriculum.modules.map((item) => item.id === mod.id
        ? {
          ...item,
          schedule_days: res.data?.module.schedule_days ?? scheduleDays,
          updated_at: res.data?.module.updated_at ?? item.updated_at,
          scheduled_day_names: res.data?.module.scheduled_day_names ?? item.scheduled_day_names,
          week_count: res.data?.module.week_count ?? item.week_count,
        }
        : item),
    })))
    setScheduleSavingId(null)
    toast.success(`Updated ${mod.name} schedule`)
  }

  const restoreLesson = async (lesson: Lesson) => {
    setRestoringLessonId(lesson.id)
    const res = await api.restoreLesson(lesson.id, lesson.updated_at)
    if (res.error) {
      toast.error(res.error)
    } else {
      await loadCurricula()
      toast.success(`Restored "${lesson.title}"`)
    }
    setRestoringLessonId(null)
  }

  if (loading) return <LoadingSpinner message="Loading content..." />

  return (
    <div className="app-page-wide">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link to="/admin" className="mb-2 inline-flex min-h-11 items-center gap-1 rounded-xl px-2 text-sm font-semibold text-ink-muted transition-colors duration-150 hover:bg-surface-sunken hover:text-ink">
            <ArrowLeft className="h-4 w-4" />
            Staff home
          </Link>
          <p className="app-eyebrow">Curriculum studio</p>
          <h1 className="app-title mt-2">Content</h1>
          <p className="app-description mt-2">Shape reusable modules and lessons before assigning them to a cohort.</p>
        </div>
        {canManageModules && <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => setShowPackageImport(true)}><Upload className="h-4 w-4" /> Import course package</Button><Button onClick={() => { setCurriculumCreateError(''); setShowNewCurriculum(true) }}>
          <Plus className="h-4 w-4" /> New curriculum
        </Button></div>}
      </header>

      {curricula.map((curriculum) => (
        <div key={curriculum.id} className="app-surface overflow-hidden">
          <div className="px-4 py-4 border-b border-line bg-surface-sunken sm:px-6">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-lg font-bold text-ink" title={curriculum.name}>{curriculum.name}</h2>
                <Badge tone={curriculum.status === 'active' ? 'success' : 'neutral'} className="mt-1">
                  {curriculum.status.charAt(0).toUpperCase() + curriculum.status.slice(1)}
                </Badge>
              </div>
              {canManageModules && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="shrink-0"
                  onClick={() => {
                    setModuleCreateError('')
                    setNewModuleModal({ curriculumId: curriculum.id, moduleCount: curriculum.modules?.length || 0 })
                  }}
                >
                  <Plus className="h-4 w-4" />
                  New module
                </Button>
              )}
            </div>
          </div>

          <CourseResourcesPanel curriculumId={curriculum.id} draft={curriculum.status === 'draft'} />
          <div className="divide-y divide-line">
            {curriculum.modules?.map((mod) => (
              <ModuleSection
                key={mod.id}
                mod={mod}
                expanded={expandedModules.has(mod.id)}
                activeWeek={activeWeekTab[mod.id] || 1}
                maxExtraWeek={extraWeeks[mod.id] || 0}
                onToggle={() => toggleModule(mod.id)}
                onSetWeek={(w) => setActiveWeekTab(prev => ({ ...prev, [mod.id]: w }))}
                onAddWeek={() => addWeek(mod)}
                onAddExercise={(week, dayIndex) => openExerciseForDay(mod, week, dayIndex)}
                onChangeSchedule={(scheduleDays) => updateModuleSchedule(mod, scheduleDays)}
                canManageModules={canManageModules}
                scheduleSaving={scheduleSavingId === mod.id}
                restoringLessonId={restoringLessonId}
                onRestoreLesson={restoreLesson}
                navigate={navigate}
              />
            ))}
          </div>
        </div>
      ))}

      {exerciseModal && (
        <NewExerciseModal
          moduleName={exerciseModal.moduleName}
          scheduleDays={exerciseModal.scheduleDays}
          weekCount={exerciseModal.weekCount}
          defaultWeek={exerciseModal.defaultWeek}
          defaultDayIndex={exerciseModal.defaultDayIndex}
          saving={exerciseSaving}
          error={exerciseCreateError}
          onClose={() => {
            setExerciseCreateError('')
            setExerciseModal(null)
          }}
          onCreate={async (data) => {
            setExerciseSaving(true)
            setExerciseCreateError('')
            const { upload_id, ...payload } = data
            const createPayload = {
              ...payload,
              video_upload_pending: Boolean(upload_id && !payload.s3_video_key),
            }
            const res = await api.createExercise(exerciseModal.moduleId, createPayload)
            if (res.error) {
              setExerciseCreateError(res.error)
              toast.error(res.error)
              setExerciseSaving(false)
              return
            }
            // If a video upload is still in flight, attach the new lesson/content block to it
            // so the background uploader can finish persisting the S3 video onto the new row.
            if (upload_id && res.data?.lesson) {
              const lesson = res.data.lesson
              const videoBlock = lesson.content_blocks?.find(cb => cb.block_type === 'video')
              attachUpload(upload_id, {
                contentBlockId: videoBlock?.id,
                persistedS3Key: videoBlock?.s3_video_key,
                linkTo: `/admin/lessons/${lesson.id}/edit`,
                linkLabel: `Exercise: ${lesson.title}`,
              })
            }
            setExerciseSaving(false)
            setExerciseModal(null)
            await loadCurricula()
            toast.success(`Created exercise "${payload.title}"`)
          }}
        />
      )}

      {newModuleModal && (
        <NewModuleModal
          defaultPosition={newModuleModal.moduleCount}
          saving={moduleSaving}
          error={moduleCreateError}
          onClose={() => {
            setModuleCreateError('')
            setNewModuleModal(null)
          }}
          onCreate={async (data) => {
            setModuleSaving(true)
            setModuleCreateError('')
            const createRes = await api.createModule(newModuleModal.curriculumId, data)
            if (createRes.error) {
              setModuleCreateError(createRes.error)
              toast.error(createRes.error)
              setModuleSaving(false)
              return
            }
            await loadCurricula()
            setModuleSaving(false)
            setNewModuleModal(null)
            toast.success(`Created module "${data.name}"`)
          }}
        />
      )}

      {showPackageImport && <ImportCoursePackageModal onClose={() => setShowPackageImport(false)} onImported={async () => { await loadCurricula(); toast.success('Course package draft is ready for editing') }} />}

      {showNewCurriculum && (
        <NewCurriculumModal
          saving={curriculumSaving}
          error={curriculumCreateError}
          onClose={() => {
            setCurriculumCreateError('')
            setShowNewCurriculum(false)
          }}
          onCreate={async (data) => {
            setCurriculumSaving(true)
            setCurriculumCreateError('')
            const res = await api.createCurriculum(data)
            if (res.error) {
              setCurriculumCreateError(res.error)
              toast.error(res.error)
              setCurriculumSaving(false)
              return
            }
            await loadCurricula()
            setCurriculumSaving(false)
            setShowNewCurriculum(false)
            toast.success(`Created curriculum "${data.name}"`)
          }}
        />
      )}
    </div>
  )
}

function ModuleSection({
  mod,
  expanded,
  activeWeek,
  maxExtraWeek,
  onToggle,
  onSetWeek,
  onAddWeek,
  onAddExercise,
  onChangeSchedule,
  canManageModules,
  scheduleSaving,
  restoringLessonId,
  onRestoreLesson,
  navigate,
}: {
  mod: Module
  expanded: boolean
  activeWeek: number
  maxExtraWeek: number
  onToggle: () => void
  onSetWeek: (w: number) => void
  onAddWeek: () => void
  onAddExercise: (week: number, dayIndex: number) => void
  onChangeSchedule: (scheduleDays: string) => void
  canManageModules: boolean
  scheduleSaving: boolean
  restoringLessonId: number | null
  onRestoreLesson: (lesson: Lesson) => void
  navigate: (path: string) => void
}) {
  const activeLessons = useMemo(() => (mod.lessons || []).filter((lesson) => !lesson.archived_at), [mod.lessons])
  const archivedLessons = useMemo(() => (mod.lessons || []).filter((lesson) => lesson.archived_at), [mod.lessons])
  const lessonsByDay = useMemo(() => groupLessonsByDay(activeLessons), [activeLessons])
  const scheduleIndices = SCHEDULE_DAY_INDICES[mod.schedule_days] || SCHEDULE_DAY_INDICES.weekdays

  const weekNumbers = useMemo(() => {
    const weeks = new Set<number>()
    for (const l of activeLessons) {
      weeks.add(Math.floor(l.release_day / 7) + 1)
    }
    if (maxExtraWeek > 0) weeks.add(maxExtraWeek)
    if (weeks.size === 0) return []
    return Array.from(weeks).sort((a, b) => a - b)
  }, [activeLessons, maxExtraWeek])

  const scheduleLabel = SCHEDULE_PATTERN_OPTIONS.find((option) => option.value === mod.schedule_days)?.label || 'MTWTF / Mon–Fri'

  const exerciseCount = activeLessons.length

  const daysInActiveWeek = useMemo(() => {
    return scheduleIndices.map(dayIdx => {
      const releaseDay = (activeWeek - 1) * 7 + dayIdx
      const exercises = lessonsByDay[releaseDay] || []
      return { dayIdx, releaseDay, exercises }
    })
  }, [activeWeek, scheduleIndices, lessonsByDay])

  return (
    <div>
      {/* Module header */}
      <div className="w-full flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-4 sm:px-6 py-3 sm:py-4 hover:bg-surface-sunken transition-colors duration-150">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="pressable flex min-h-11 flex-1 items-center gap-2 sm:gap-3 rounded-xl text-left min-w-0"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-ink-muted shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-ink-muted shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <p className="truncate text-sm font-semibold text-ink" title={mod.name}>{mod.name}</p>
            <p className="text-xs text-ink-muted capitalize tabular-nums">
              {mod.module_type.replace('_', ' ')} · {exerciseCount} exercise{exerciseCount !== 1 ? 's' : ''} · {weekNumbers.length} week{weekNumbers.length !== 1 ? 's' : ''} · {scheduleLabel}
              {archivedLessons.length > 0 ? ` · ${archivedLessons.length} archived` : ''}
            </p>
          </div>
        </button>
        <div className="flex flex-wrap items-center gap-1 pl-6 sm:pl-0 shrink-0">
          {canManageModules && (
            <select
              value={mod.schedule_days}
              disabled={scheduleSaving}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => onChangeSchedule(event.target.value)}
              className="app-control px-2"
              aria-label={`Schedule pattern for ${mod.name}`}
            >
              {SCHEDULE_PATTERN_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          )}
          <Button
            variant="quiet"
            size="sm"
            onClick={onAddWeek}
            title="Add a new week"
          >
            <CalendarPlus className="h-3.5 w-3.5" />
            Week
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              const si = scheduleIndices
              const lastDay = activeLessons.length > 0 ? Math.max(...activeLessons.map(l => l.release_day)) : -1
              const lastWeek = Math.floor(lastDay / 7) + 1
              const lastDayIdx = lastDay % 7
              const pos = si.indexOf(lastDayIdx)
              let nextWeek = lastWeek, nextDay = si[0]
              if (pos >= 0 && pos < si.length - 1) nextDay = si[pos + 1]
              else nextWeek = lastWeek + 1
              if (lastDay < 0) { nextWeek = 1; nextDay = si[0] }
              onAddExercise(nextWeek, nextDay)
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            Exercise
          </Button>
        </div>
      </div>

      {/* Expanded content: week tabs + day list (like prework grader) */}
      {expanded && (
        <div className="px-4 sm:px-6 pb-5">
          {weekNumbers.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-sm text-ink-muted mb-3">No exercises yet</p>
              <Button variant="secondary" onClick={onAddWeek}>
                <CalendarPlus className="h-4 w-4" />
                Add Week 1
              </Button>
            </div>
          ) : (
            <>
              {/* Week tabs - scrollable on mobile */}
              <div role="tablist" aria-label={`${mod.name} weeks`} className="flex items-center gap-1 border-b border-line mb-4 overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
                {weekNumbers.map((w) => (
                  <TabButton
                    key={w}
                    asTab
                    dense
                    selected={activeWeek === w}
                    onClick={() => onSetWeek(w)}
                    className="tabular-nums"
                  >
                    Week {w}
                  </TabButton>
                ))}
              </div>

              {/* Days in the active week */}
              <div className="space-y-4">
                {daysInActiveWeek.map(({ dayIdx, exercises }) => (
                  <div key={dayIdx} className="rounded-xl border border-line overflow-hidden">
                    {/* Day header */}
                    <div className="flex items-center justify-between gap-2 px-4 py-1.5 bg-surface-sunken border-b border-line">
                      <h4 className="text-sm font-semibold text-ink">
                        Day {dayIdx + 1} · {ALL_DAY_NAMES[dayIdx]}
                      </h4>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-ink-muted tabular-nums">
                          {exercises.length} exercise{exercises.length !== 1 ? 's' : ''}
                        </span>
                        <Button variant="quiet" size="sm" onClick={() => onAddExercise(activeWeek, dayIdx)}>
                          <Plus className="h-3.5 w-3.5" />
                          Add
                        </Button>
                      </div>
                    </div>

                    {/* Exercises in this day */}
                    {exercises.length === 0 ? (
                      <div className="px-4 py-1">
                        <TextButton tone="quiet" className="text-xs" onClick={() => onAddExercise(activeWeek, dayIdx)}>
                          + Add first exercise for this day
                        </TextButton>
                      </div>
                    ) : (
                      <div className="divide-y divide-line">
                        {exercises
                          .sort((a, b) => a.position - b.position)
                          .map((lesson) => {
                            const hasFilename = lesson.title.match(/\d{3}\.rb/) || lesson.content_blocks_count > 0

                            return (
                              <div
                                key={lesson.id}
                                className="flex min-h-11 items-center gap-3 px-4 py-1 hover:bg-surface-sunken transition-colors duration-150 group"
                              >
                                <Code className="h-3.5 w-3.5 text-ink-muted shrink-0" />
                                <p className="text-sm text-ink flex-1 min-w-0 truncate" title={lesson.title}>{lesson.title}</p>
                                {lesson.submission_type && lesson.submission_type !== 'manual_complete' && (
                                  <Badge tone="neutral">
                                    {lesson.submission_type === 'prework_github_sync'
                                      ? 'github'
                                      : lesson.submission_type === 'repo_and_live_url_submission'
                                        ? 'repo+live'
                                        : lesson.submission_type === 'repo_url_submission'
                                          ? 'repo'
                                          : 'submit'}
                                  </Badge>
                                )}
                                {hasFilename && (
                                  <span className="text-xs text-ink-muted tabular-nums shrink-0">
                                    {lesson.content_blocks_count}b
                                  </span>
                                )}
                                <div className="flex shrink-0 items-center gap-0.5 transition-opacity duration-150 pointer-fine:sm:opacity-0 pointer-fine:sm:group-hover:opacity-100 pointer-fine:sm:group-focus-within:opacity-100">
                                  <IconButton
                                    size="sm"
                                    onClick={() => navigate(`/admin/lessons/${lesson.id}/edit?preview=true`)}
                                    label={`Preview ${lesson.title} as a student`}
                                  >
                                    <Eye className="h-3.5 w-3.5" />
                                  </IconButton>
                                  <IconButton
                                    size="sm"
                                    onClick={() => navigate(`/admin/lessons/${lesson.id}/edit`)}
                                    label={`Edit ${lesson.title}`}
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </IconButton>
                                </div>
                              </div>
                            )
                          })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {archivedLessons.length > 0 && (
                <details className="app-surface-muted mt-5 overflow-hidden">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-ink transition-colors duration-150 hover:bg-slate-100">
                    <Archive className="h-4 w-4 text-ink-muted" />
                    Archived exercises
                    <Badge tone="neutral" className="tabular-nums">{archivedLessons.length}</Badge>
                  </summary>
                  <div className="divide-y divide-line border-t border-line bg-surface-raised">
                    {archivedLessons.map((lesson) => {
                      const week = Math.floor(lesson.release_day / 7) + 1
                      const day = lesson.release_day % 7
                      return (
                        <div key={lesson.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-ink" title={lesson.title}>{lesson.title}</p>
                            <p className="mt-0.5 text-xs text-ink-muted tabular-nums">Week {week} · {ALL_DAY_NAMES[day]}</p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <Button variant="quiet" size="sm" onClick={() => navigate(`/admin/lessons/${lesson.id}/edit`)}>
                              <Pencil className="h-4 w-4" />Review
                            </Button>
                            <Button variant="secondary" size="sm" onClick={() => onRestoreLesson(lesson)} disabled={restoringLessonId === lesson.id}>
                              <RotateCcw className="h-4 w-4" />
                              {restoringLessonId === lesson.id ? 'Restoring...' : 'Restore'}
                            </Button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </details>
          )}
        </div>
      )}
    </div>
  )
}
