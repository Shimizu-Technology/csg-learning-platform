import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, BookOpen, CheckCircle2, ChevronDown, ChevronRight, Clock, Lock, RefreshCw, RotateCcw, Search, WifiOff } from 'lucide-react'
import { api } from '../../lib/api'
import { useAuthContext } from '../../contexts/AuthContext'
import { EmptyState } from '../../components/shared/EmptyState'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { ProgressBar } from '../../components/shared/ProgressBar'

type MaterialFilter = 'ready' | 'all' | 'redo' | 'completed' | 'locked'

interface LessonItem {
  id: number
  title: string
  lesson_type: string
  available: boolean
  unlock_date: string | null
  completed: boolean
  total_blocks: number
  completed_blocks: number
}

interface ModuleItem {
  id: number
  name: string
  module_type: string
  progress_percentage: number
  completed_blocks: number
  total_blocks: number
  available: boolean
  unlock_date: string | null
  lessons: LessonItem[]
}

interface MaterialsData {
  enrolled: boolean
  cohort?: { id: number; name: string; start_date: string; status: string }
  modules?: ModuleItem[]
  action_items?: Array<{
    type: string
    submission_id: number
    lesson_id: number
    lesson_title: string
    content_block_title: string
    feedback: string | null
  }>
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return 'TBD'
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function lessonStatus(lesson: LessonItem) {
  if (!lesson.available) return 'locked'
  if (lesson.completed) return 'completed'
  return 'ready'
}

function formatTypeLabel(value: string) {
  return value.replaceAll('_', ' ')
}

export function Materials() {
  const { user } = useAuthContext()
  const navigate = useNavigate()
  const [data, setData] = useState<MaterialsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showingSavedData, setShowingSavedData] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<MaterialFilter>('ready')
  const [collapsedModules, setCollapsedModules] = useState<Set<number>>(() => new Set())

  const loadMaterials = useCallback(() => {
    if (user?.is_staff) {
      navigate('/admin', { replace: true })
      return
    }

    setLoading(true)
    setLoadError(null)
    setShowingSavedData(false)

    api.getDashboard()
      .then((res) => {
        if (res.data?.dashboard) {
          setData(res.data.dashboard)
          setShowingSavedData(Boolean(res.fromCache))
          setLoadError(res.fromCache ? res.error : null)
        } else {
          setLoadError(res.error || 'Unable to load your materials right now.')
        }
      })
      .catch((error: unknown) => {
        setLoadError(error instanceof Error ? error.message : 'Unable to load your materials right now.')
      })
      .finally(() => setLoading(false))
  }, [navigate, user])

  useEffect(() => {
    loadMaterials()
  }, [loadMaterials])

  useEffect(() => {
    const cohortId = data?.cohort?.id
    if (!cohortId) return

    try {
      const raw = localStorage.getItem(`csg-materials-collapsed:${cohortId}`)
      if (raw) setCollapsedModules(new Set(JSON.parse(raw) as number[]))
    } catch {
      // Ignore unavailable storage in private browsing or locked-down WebViews.
    }
  }, [data?.cohort?.id])

  const persistCollapsedModules = useCallback((next: Set<number>) => {
    setCollapsedModules(next)
    const cohortId = data?.cohort?.id
    if (!cohortId) return

    try {
      localStorage.setItem(`csg-materials-collapsed:${cohortId}`, JSON.stringify(Array.from(next)))
    } catch {
      // Ignore unavailable storage in private browsing or locked-down WebViews.
    }
  }, [data?.cohort?.id])

  const toggleModuleCollapsed = useCallback((moduleId: number) => {
    const next = new Set(collapsedModules)
    if (next.has(moduleId)) next.delete(moduleId)
    else next.add(moduleId)
    persistCollapsedModules(next)
  }, [collapsedModules, persistCollapsedModules])

  const collapseAllModules = useCallback((moduleIds: number[]) => {
    persistCollapsedModules(new Set(moduleIds))
  }, [persistCollapsedModules])

  const expandAllModules = useCallback(() => {
    persistCollapsedModules(new Set())
  }, [persistCollapsedModules])

  const derived = useMemo(() => {
    const modules = data?.modules || []
    const redoLessonIds = new Set((data?.action_items || []).map((item) => item.lesson_id))
    const q = query.trim().toLowerCase()

    const visibleModules = modules
      .map((mod) => {
        const lessons = mod.lessons.filter((lesson) => {
          const status = lessonStatus(lesson)
          const matchesQuery = !q || [
            mod.name,
            formatTypeLabel(mod.module_type),
            lesson.title,
            formatTypeLabel(lesson.lesson_type),
          ].some((value) => value.toLowerCase().includes(q))

          if (!matchesQuery) return false
          if (filter === 'all') return true
          if (filter === 'redo') return redoLessonIds.has(lesson.id)
          if (filter === 'completed') return status === 'completed'
          if (filter === 'locked') return status === 'locked'
          return status === 'ready' || redoLessonIds.has(lesson.id)
        })

        return { ...mod, lessons }
      })
      .filter((mod) => mod.lessons.length > 0)

    const allLessons = modules.flatMap((mod) => mod.lessons)
    const readyCount = allLessons.filter((lesson) => lessonStatus(lesson) === 'ready').length
    const completedCount = allLessons.filter((lesson) => lessonStatus(lesson) === 'completed').length
    const lockedCount = allLessons.filter((lesson) => lessonStatus(lesson) === 'locked').length
    const redoCount = redoLessonIds.size
    const readyOrRedoCount = allLessons.filter((lesson) => lessonStatus(lesson) === 'ready' || redoLessonIds.has(lesson.id)).length

    return {
      visibleModules,
      redoLessonIds,
      readyCount,
      readyOrRedoCount,
      completedCount,
      lockedCount,
      redoCount,
      totalLessons: allLessons.length,
    }
  }, [data, filter, query])

  if (loading) return <LoadingSpinner message="Loading materials..." />

  if (loadError && !data) {
    return (
      <EmptyState
        icon={WifiOff}
        title="Could not load materials"
        description={loadError}
        action={
          <button
            type="button"
            onClick={loadMaterials}
            className="inline-flex items-center gap-2 rounded-lg bg-primary-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-600"
          >
            <RefreshCw className="h-4 w-4" />
            Try again
          </button>
        }
      />
    )
  }

  if (!data?.enrolled) {
    return (
      <EmptyState
        icon={BookOpen}
        title="No class materials yet"
        description="Your modules and lessons will appear here once you are enrolled in a cohort."
      />
    )
  }

  const filters: Array<{ key: MaterialFilter; label: string; count: number }> = [
    { key: 'ready', label: 'To do', count: derived.readyOrRedoCount },
    { key: 'all', label: 'All', count: derived.totalLessons },
    { key: 'redo', label: 'Redo', count: derived.redoCount },
    { key: 'completed', label: 'Done', count: derived.completedCount },
    { key: 'locked', label: 'Locked', count: derived.lockedCount },
  ]

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {showingSavedData && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Showing saved materials while your connection catches up.
        </div>
      )}
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-medium text-primary-600">{data.cohort?.name || 'Your cohort'}</p>
            <h1 className="mt-1 text-2xl font-bold text-slate-900">Materials</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">
              Find your lessons, exercises, and upcoming work without going back through the dashboard.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center sm:min-w-[360px]">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-lg font-semibold text-slate-900">{derived.readyCount}</p>
              <p className="text-xs text-slate-500">Ready</p>
            </div>
            <div className="rounded-xl border border-orange-200 bg-orange-50 px-3 py-2">
              <p className="text-lg font-semibold text-orange-700">{derived.redoCount}</p>
              <p className="text-xs text-orange-700">Redo</p>
            </div>
            <div className="rounded-xl border border-success-200 bg-success-50 px-3 py-2">
              <p className="text-lg font-semibold text-success-700">{derived.completedCount}</p>
              <p className="text-xs text-success-700">Done</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search lessons or modules..."
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {filters.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setFilter(item.key)}
              className={`shrink-0 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                filter === item.key
                  ? 'border-primary-200 bg-primary-50 text-primary-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {item.label}
              <span className="ml-2 text-xs text-slate-400">{item.count}</span>
            </button>
          ))}
        </div>
      </div>
      {derived.visibleModules.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
          <p className="text-sm text-slate-500">
            {derived.visibleModules.length} module{derived.visibleModules.length !== 1 ? 's' : ''} in view
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={expandAllModules}
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              Expand all
            </button>
            <button
              type="button"
              onClick={() => collapseAllModules(derived.visibleModules.map((mod) => mod.id))}
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              Collapse all
            </button>
          </div>
        </div>
      )}

      {data.action_items && data.action_items.length > 0 && (
        <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-orange-800">
            <RotateCcw className="h-4 w-4" />
            Redo requested
          </h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {data.action_items.map((item) => (
              <Link
                key={item.submission_id}
                to={`/lessons/${item.lesson_id}`}
                className="rounded-xl border border-orange-200 bg-white p-4 hover:border-orange-300 hover:shadow-sm"
              >
                <p className="text-sm font-semibold text-slate-900">{item.content_block_title}</p>
                <p className="mt-0.5 text-xs text-slate-500">{item.lesson_title}</p>
                {item.feedback && <p className="mt-2 text-xs leading-5 text-slate-600">{item.feedback}</p>}
              </Link>
            ))}
          </div>
        </div>
      )}

      {derived.visibleModules.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No matching materials"
          description="Try a different search or switch filters to see more lessons."
        />
      ) : (
        <div className="space-y-4">
          {derived.visibleModules.map((mod) => {
            const isCollapsed = collapsedModules.has(mod.id)

            return (
            <section key={mod.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <button
                type="button"
                onClick={() => toggleModuleCollapsed(mod.id)}
                className="flex w-full flex-col gap-3 p-5 text-left hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    {isCollapsed ? (
                      <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                    ) : (
                      <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
                    )}
                    <h2 className="font-semibold text-slate-900">{mod.name}</h2>
                    {!mod.available && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        Locked
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm capitalize text-slate-500">
                    {formatTypeLabel(mod.module_type)}
                    {!mod.available && mod.unlock_date ? ` · unlocks ${formatDate(mod.unlock_date)}` : ''}
                  </p>
                </div>
                <div className="sm:min-w-[220px]">
                  <ProgressBar value={mod.completed_blocks} max={mod.total_blocks} showPercentage={false} size="sm" />
                  <p className="mt-1 text-right text-xs text-slate-400">
                    {mod.completed_blocks}/{mod.total_blocks} blocks
                  </p>
                </div>
              </button>

              {!isCollapsed && (
              <div className="divide-y divide-slate-100 px-5 pb-5">
                {mod.lessons.map((lesson) => {
                  const status = lessonStatus(lesson)
                  const isRedo = derived.redoLessonIds.has(lesson.id)
                  const isPartial = status === 'ready' && lesson.completed_blocks > 0
                  const rowClassName = `flex items-center gap-3 py-3 ${
                    lesson.available ? 'hover:bg-slate-50' : 'cursor-not-allowed opacity-70'
                  }`
                  const rowContent = (
                    <>
                      <div className={`shrink-0 ${
                        isRedo ? 'text-orange-500' : status === 'completed' ? 'text-success-500' : status === 'locked' ? 'text-slate-400' : 'text-primary-500'
                      }`}>
                        {isRedo ? <RotateCcw className="h-5 w-5" /> : status === 'completed' ? <CheckCircle2 className="h-5 w-5" /> : status === 'locked' ? <Lock className="h-5 w-5" /> : <Clock className="h-5 w-5" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-900">{lesson.title}</p>
                        <p className="mt-0.5 text-xs capitalize text-slate-500">
                          {formatTypeLabel(lesson.lesson_type)}
                          {status === 'locked' ? ` · unlocks ${formatDate(lesson.unlock_date)}` : ` · ${lesson.completed_blocks}/${lesson.total_blocks} blocks`}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {isRedo && <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">Redo</span>}
                        {isPartial && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">In progress</span>}
                        {status === 'completed' && <span className="rounded-full bg-success-50 px-2 py-0.5 text-xs font-medium text-success-700">Done</span>}
                        {lesson.available && <ArrowRight className="h-4 w-4 text-slate-300" />}
                      </div>
                    </>
                  )

                  return lesson.available ? (
                    <Link
                      key={lesson.id}
                      to={`/lessons/${lesson.id}`}
                      className={rowClassName}
                    >
                      {rowContent}
                    </Link>
                  ) : (
                    <div key={lesson.id} className={rowClassName} aria-disabled="true">
                      {rowContent}
                    </div>
                  )
                })}
              </div>
              )}
            </section>
          )})}
        </div>
      )}
    </div>
  )
}
