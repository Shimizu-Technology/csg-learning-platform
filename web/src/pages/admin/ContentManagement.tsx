import { useEffect, useState, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Code,
  Eye,
  Pencil,
  Plus,
  CalendarPlus,
} from 'lucide-react'
import { api } from '../../lib/api'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { NewExerciseModal } from './NewExerciseModal'
import { NewModuleModal } from './NewModuleModal'
import { SCHEDULE_DAY_INDICES } from '../../lib/scheduleConstants'

interface Lesson {
  id: number
  title: string
  lesson_type: string
  position: number
  release_day: number
  requires_submission?: boolean
  content_blocks_count: number
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

export function ContentManagement() {
  const navigate = useNavigate()
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
  const [exerciseSaving, setExerciseSaving] = useState(false)
  const [moduleSaving, setModuleSaving] = useState(false)
  const [exerciseCreateError, setExerciseCreateError] = useState('')
  const [moduleCreateError, setModuleCreateError] = useState('')
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
    next.has(moduleId) ? next.delete(moduleId) : next.add(moduleId)
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

  if (loading) return <LoadingSpinner message="Loading content..." />

  return (
    <div className="space-y-6">
      <div>
        <Link to="/admin" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-2">
          <ArrowLeft className="h-4 w-4" />
          Admin Dashboard
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">Content Management</h1>
      </div>

      {curricula.map((curriculum) => (
        <div key={curriculum.id} className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{curriculum.name}</h2>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  curriculum.status === 'active' ? 'bg-success-100 text-success-700' : 'bg-slate-100 text-slate-600'
                }`}>
                  {curriculum.status}
                </span>
              </div>
              <button
                onClick={() => {
                  setModuleCreateError('')
                  setNewModuleModal({ curriculumId: curriculum.id, moduleCount: curriculum.modules?.length || 0 })
                }}
                className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium text-primary-600 hover:bg-primary-100 transition-colors"
              >
                <Plus className="h-4 w-4" />
                New Module
              </button>
            </div>
          </div>

          <div className="divide-y divide-slate-200">
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
            const res = await api.createExercise(exerciseModal.moduleId, data)
            if (res.error) {
              setExerciseCreateError(res.error)
              setExerciseSaving(false)
              return
            }
            setExerciseSaving(false)
            setExerciseModal(null)
            await loadCurricula()
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
              setModuleSaving(false)
              return
            }
            await loadCurricula()
            setModuleSaving(false)
            setNewModuleModal(null)
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
  navigate: (path: string) => void
}) {
  const lessonsByDay = useMemo(() => groupLessonsByDay(mod.lessons || []), [mod.lessons])
  const scheduleIndices = SCHEDULE_DAY_INDICES[mod.schedule_days] || SCHEDULE_DAY_INDICES.weekdays

  const weekNumbers = useMemo(() => {
    const weeks = new Set<number>()
    for (const l of (mod.lessons || [])) {
      weeks.add(Math.floor(l.release_day / 7) + 1)
    }
    if (maxExtraWeek > 0) weeks.add(maxExtraWeek)
    if (weeks.size === 0) return []
    return Array.from(weeks).sort((a, b) => a - b)
  }, [mod.lessons, maxExtraWeek])

  const scheduleLabel = mod.schedule_days === 'weekdays_sat' ? 'Mon–Sat'
    : mod.schedule_days === 'mwf' ? 'MWF'
    : mod.schedule_days === 'tth' ? 'TTh'
    : mod.schedule_days === 'daily' ? 'Daily'
    : 'Mon–Fri'

  const exerciseCount = (mod.lessons || []).length

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
      <div className="w-full flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-4 sm:px-6 py-3 sm:py-4 hover:bg-slate-50 transition-colors">
        <button
          type="button"
          onClick={onToggle}
          className="flex flex-1 items-center gap-2 sm:gap-3 text-left min-w-0"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-slate-900">{mod.name}</p>
            <p className="text-xs text-slate-500 capitalize">
              {mod.module_type.replace('_', ' ')} · {exerciseCount} exercise{exerciseCount !== 1 ? 's' : ''} · {weekNumbers.length} week{weekNumbers.length !== 1 ? 's' : ''} · {scheduleLabel}
            </p>
          </div>
        </button>
        <div className="flex items-center gap-1 pl-6 sm:pl-0 shrink-0">
          <button
            type="button"
            onClick={onAddWeek}
            className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:text-primary-600 hover:bg-primary-50 transition-colors"
            title="Add a new week"
          >
            <CalendarPlus className="h-3.5 w-3.5" />
            Week
          </button>
          <button
            type="button"
            onClick={() => {
              const si = scheduleIndices
              const lastDay = mod.lessons?.length > 0 ? Math.max(...mod.lessons.map(l => l.release_day)) : -1
              const lastWeek = Math.floor(lastDay / 7) + 1
              const lastDayIdx = lastDay % 7
              const pos = si.indexOf(lastDayIdx)
              let nextWeek = lastWeek, nextDay = si[0]
              if (pos >= 0 && pos < si.length - 1) nextDay = si[pos + 1]
              else nextWeek = lastWeek + 1
              if (lastDay < 0) { nextWeek = 1; nextDay = si[0] }
              onAddExercise(nextWeek, nextDay)
            }}
            className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-primary-600 hover:bg-primary-50 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Exercise
          </button>
        </div>
      </div>

      {/* Expanded content: week tabs + day list (like prework grader) */}
      {expanded && (
        <div className="px-4 sm:px-6 pb-5">
          {weekNumbers.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-sm text-slate-400 mb-3">No exercises yet</p>
              <button
                onClick={onAddWeek}
                className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-4 py-2 text-sm font-medium text-slate-500 hover:border-primary-300 hover:text-primary-600 transition-colors"
              >
                <CalendarPlus className="h-4 w-4" />
                Add Week 1
              </button>
            </div>
          ) : (
            <>
              {/* Week tabs - scrollable on mobile */}
              <div className="flex items-center gap-1 border-b border-slate-200 mb-4 overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
                {weekNumbers.map((w) => (
                  <button
                    key={w}
                    onClick={() => onSetWeek(w)}
                    className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                      activeWeek === w
                        ? 'border-primary-500 text-primary-600'
                        : 'border-transparent text-slate-400 hover:text-slate-600'
                    }`}
                  >
                    Week {w}
                  </button>
                ))}
              </div>

              {/* Days in the active week */}
              <div className="space-y-4">
                {daysInActiveWeek.map(({ dayIdx, exercises }) => (
                  <div key={dayIdx} className="rounded-xl border border-slate-200 overflow-hidden">
                    {/* Day header */}
                    <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-100">
                      <h4 className="text-sm font-semibold text-slate-700">
                        Day {dayIdx}
                      </h4>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-400">
                          {exercises.length} exercise{exercises.length !== 1 ? 's' : ''}
                        </span>
                        <button
                          onClick={() => onAddExercise(activeWeek, dayIdx)}
                          className="flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium text-primary-500 hover:bg-primary-50 transition-colors"
                        >
                          <Plus className="h-3 w-3" />
                          Add
                        </button>
                      </div>
                    </div>

                    {/* Exercises in this day */}
                    {exercises.length === 0 ? (
                      <div className="px-4 py-3">
                        <button
                          onClick={() => onAddExercise(activeWeek, dayIdx)}
                          className="text-xs text-slate-300 hover:text-primary-500 transition-colors italic"
                        >
                          + Add first exercise for this day
                        </button>
                      </div>
                    ) : (
                      <div className="divide-y divide-slate-100">
                        {exercises
                          .sort((a, b) => a.position - b.position)
                          .map((lesson) => {
                            const hasFilename = lesson.title.match(/\d{3}\.rb/) || lesson.content_blocks_count > 0

                            return (
                              <div
                                key={lesson.id}
                                className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors group"
                              >
                                <Code className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                                <p className="text-sm text-slate-700 flex-1 min-w-0 truncate">{lesson.title}</p>
                                {lesson.requires_submission && (
                                  <span className="text-[10px] font-medium text-primary-500 bg-primary-50 rounded px-1.5 py-0.5 shrink-0">
                                    submit
                                  </span>
                                )}
                                {hasFilename && (
                                  <span className="text-[10px] text-slate-300 shrink-0">
                                    {lesson.content_blocks_count}b
                                  </span>
                                )}
                                <div className="flex items-center gap-0.5 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                                  <button
                                    onClick={() => navigate(`/admin/lessons/${lesson.id}/edit?preview=true`)}
                                    title="Preview as student"
                                    className="rounded p-1 text-slate-300 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                                  >
                                    <Eye className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    onClick={() => navigate(`/admin/lessons/${lesson.id}/edit`)}
                                    title="Edit exercise"
                                    className="rounded p-1 text-slate-300 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
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
        </div>
      )}
    </div>
  )
}
