import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, BookOpen, ChevronDown, ChevronRight, Hourglass, MessageCircle, RefreshCw, RotateCcw, Search, WifiOff } from 'lucide-react'
import { api } from '../../lib/api'
import { useAuthContext } from '../../contexts/AuthContext'
import { useCohortContext } from '../../contexts/CohortContext'
import { EmptyState } from '../../components/shared/EmptyState'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { ProgressBar } from '../../components/shared/ProgressBar'
import { formatShortDateTime } from '../../lib/format'
import { markdownExcerpt } from '../../lib/plainText'
import { LEARNER_STATUS, STATUS_TONE_CLASSES, learnerLessonStatus } from '../../lib/learningStatus'
import { StatusBadge, StatusIcon } from '../../components/shared/StatusBadge'
import { Badge } from '../../components/ui/Badge'
import { Button, LinkButton } from '../../components/ui/Button'
import type { DashboardData } from '../../types/api'
import { learnerModuleTypeLabel } from '../../lib/learnerLabels'

type MaterialFilter = 'ready' | 'all' | 'redo' | 'submitted' | 'completed' | 'locked'

type MaterialsData = DashboardData
type ModuleItem = NonNullable<MaterialsData['modules']>[number]
type LessonItem = ModuleItem['lessons'][number]

interface MaterialsProps {
  previewData?: MaterialsData
  disableStaffRedirect?: boolean
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return 'TBD'
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function lessonStatus(lesson: LessonItem) {
  if (!lesson.available) return 'locked'
  if (lesson.review_status === 'awaiting_review' && lesson.completed) return 'submitted'
  if (lesson.completed && lesson.review_status !== 'redo_requested') return 'completed'
  return 'ready'
}

function formatTypeLabel(value: string) {
  const words = value.replaceAll('_', ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function readCollapsedModuleIds(cohortId: number | undefined): Set<number> {
  if (!cohortId) return new Set()

  try {
    const raw = localStorage.getItem(`csg-materials-collapsed:${cohortId}`)
    return raw ? new Set(JSON.parse(raw) as number[]) : new Set()
  } catch {
    return new Set()
  }
}

export function Materials({ previewData, disableStaffRedirect = false }: MaterialsProps = {}) {
  const { user, enrollments } = useAuthContext()
  const { selectedCohortId } = useCohortContext()
  const selectedEnrollment = enrollments.find((entry) => entry.cohort.id === selectedCohortId)
  const navigate = useNavigate()
  const [data, setData] = useState<MaterialsData | null>(previewData || null)
  const [loading, setLoading] = useState(!previewData)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showingSavedData, setShowingSavedData] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<MaterialFilter>('ready')
  const [collapsedModules, setCollapsedModules] = useState<Set<number>>(() => new Set())
  const materialsRequest = useRef(0)
  const courseAccess = data?.course_access || (selectedEnrollment ? {
    course_delivery: selectedEnrollment.cohort.course_delivery,
    access_expires_at: selectedEnrollment.access_expires_at || null,
    support_expires_at: selectedEnrollment.support_expires_at || null,
  } : null)

  const loadMaterials = useCallback(() => {
    const request = ++materialsRequest.current
    if (previewData) {
      setData(previewData)
      setCollapsedModules(readCollapsedModuleIds(previewData.cohort?.id))
      setLoading(false)
      setLoadError(null)
      setShowingSavedData(false)
      return
    }

    if (user?.is_staff && !disableStaffRedirect) {
      navigate('/admin', { replace: true })
      return
    }

    setLoading(true)
    setData(null)
    setLoadError(null)
    setShowingSavedData(false)

    api.getDashboard(selectedCohortId ?? undefined)
      .then((res) => {
        if (request !== materialsRequest.current) return
        if (res.data?.dashboard) {
          const dashboard = res.data.dashboard
          setCollapsedModules(readCollapsedModuleIds(dashboard.cohort?.id))
          setData(dashboard)
          setShowingSavedData(Boolean(res.fromCache))
          setLoadError(res.fromCache ? res.error : null)
        } else {
          setLoadError(res.error || 'Unable to load your materials right now.')
        }
      })
      .catch((error: unknown) => {
        if (request !== materialsRequest.current) return
        setLoadError(error instanceof Error ? error.message : 'Unable to load your materials right now.')
      })
      .finally(() => { if (request === materialsRequest.current) setLoading(false) })
  }, [disableStaffRedirect, navigate, previewData, selectedCohortId, user])

  useEffect(() => {
    loadMaterials()
  }, [loadMaterials])

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
    const hasActiveSearch = q.length > 0

    const visibleModules = modules
      .map((mod) => {
        const lessons = mod.lessons.filter((lesson) => {
          const status = lessonStatus(lesson)
          const matchesQuery = !hasActiveSearch || [
            mod.name,
            learnerModuleTypeLabel(mod.module_type),
            lesson.title,
            formatTypeLabel(lesson.lesson_type),
          ].some((value) => value.toLowerCase().includes(q))

          if (!matchesQuery) return false
          if (filter === 'all') return true
          if (filter === 'redo') return redoLessonIds.has(lesson.id)
          if (filter === 'completed') return status === 'completed'
          if (filter === 'submitted') return status === 'submitted'
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
    const submittedCount = allLessons.filter((lesson) => lessonStatus(lesson) === 'submitted').length
    const readyOrRedoCount = allLessons.filter((lesson) => lessonStatus(lesson) === 'ready' || redoLessonIds.has(lesson.id)).length

    return {
      visibleModules,
      redoLessonIds,
      hasActiveSearch,
      readyCount,
      readyOrRedoCount,
      completedCount,
      lockedCount,
      redoCount,
      submittedCount,
      courseNotOpen: modules.length === 0,
      noLessonsYet: modules.length > 0 && allLessons.length === 0,
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
          <Button onClick={loadMaterials}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Try again
          </Button>
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
    ...(derived.submittedCount > 0 ? [{ key: 'submitted' as const, label: 'In review', count: derived.submittedCount }] : []),
    { key: 'completed', label: 'Done', count: derived.completedCount },
    { key: 'locked', label: 'Locked', count: derived.lockedCount },
  ]

  return (
    <div className="app-page">
      {showingSavedData && (
        <div className="rounded-2xl border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-800">
          Showing saved materials while your connection catches up.
        </div>
      )}
      <header className="app-surface p-5 sm:p-6">
        {courseAccess?.course_delivery !== 'self_paced' && (courseAccess?.access_expires_at || courseAccess?.support_expires_at) && (
          <p className="mb-4 rounded-xl border border-info-200 bg-info-50 px-4 py-3 text-xs font-semibold text-info-800">
            {courseAccess.access_expires_at && `Lesson access through ${new Date(new Date(courseAccess.access_expires_at).getTime() - 1).toLocaleDateString('en-US', { timeZone: 'Pacific/Guam' })} (Guam time). `}
            {courseAccess.support_expires_at && (new Date(courseAccess.support_expires_at) > new Date()
              ? `Instructor support through ${new Date(new Date(courseAccess.support_expires_at).getTime() - 1).toLocaleDateString('en-US', { timeZone: 'Pacific/Guam' })} (Guam time).`
              : 'Instructor support has ended; you can still review lessons during your access period.')}
          </p>
        )}
        {selectedEnrollment?.cohort.course_delivery === 'self_paced' && <p className="mb-4 rounded-xl border border-info-200 bg-info-50 px-4 py-3 text-xs font-semibold text-info-800">Self-paced lesson access through {selectedEnrollment.access_expires_at ? new Date(selectedEnrollment.access_expires_at).toLocaleDateString() : 'your access period'}. {selectedEnrollment.support_expires_at ? (new Date(selectedEnrollment.support_expires_at) > new Date() ? `Instructor messaging through ${new Date(selectedEnrollment.support_expires_at).toLocaleDateString()}.` : 'Instructor messaging has ended.') : 'Instructor messaging starts when you first open the course.'}</p>}
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="app-eyebrow">{data.cohort?.name || 'Your cohort'}</p>
            <h1 className="app-title mt-2">Learn</h1>
            <p className="app-description mt-2">
              Your complete learning path—ready work first, with everything else easy to find.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center sm:min-w-[360px]">
            <div className="rounded-xl border border-line bg-surface-sunken px-3 py-2">
              <p className="text-lg font-semibold tabular-nums text-ink">{derived.readyCount}</p>
              <p className="text-xs text-ink-secondary">Ready</p>
            </div>
            <div className="rounded-xl border border-warning-200 bg-warning-50 px-3 py-2">
              <p className="text-lg font-semibold tabular-nums text-warning-800">{derived.redoCount}</p>
              <p className="text-xs text-warning-800">Redo</p>
            </div>
            <div className="rounded-xl border border-success-200 bg-success-50 px-3 py-2">
              <p className="text-lg font-semibold tabular-nums text-success-700">{derived.completedCount}</p>
              <p className="text-xs text-success-700">Done</p>
            </div>
          </div>
        </div>
      </header>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search lessons or modules..."
            aria-label="Search lessons or modules"
            className="app-control w-full pl-10"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {filters.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setFilter(item.key)}
              aria-pressed={filter === item.key}
              className={`pressable min-h-11 shrink-0 rounded-full border px-3.5 py-2 text-sm font-semibold ${
                filter === item.key
                  ? 'border-ink bg-slate-100 text-ink'
                  : 'border-line bg-surface-raised text-ink-secondary hover:bg-surface-sunken hover:text-ink'
              }`}
            >
              {filter === item.key && <span aria-hidden="true" className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-ruby-600 align-middle" />}
              {item.label}
              <span className="ml-2 text-xs tabular-nums text-ink-muted">{item.count}</span>
            </button>
          ))}
        </div>
      </div>
      {derived.visibleModules.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface-raised px-4 py-3">
          <p className="text-sm tabular-nums text-ink-secondary">
            {derived.visibleModules.length} module{derived.visibleModules.length !== 1 ? 's' : ''} in view
            {derived.hasActiveSearch ? ' · search results expanded' : ''}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={expandAllModules}>
              Expand all
            </Button>
            <Button variant="secondary" size="sm" onClick={() => collapseAllModules(derived.visibleModules.map((mod) => mod.id))}>
              Collapse all
            </Button>
          </div>
        </div>
      )}

      {data.action_items && data.action_items.length > 0 && (
        <div className="rounded-2xl border border-warning-200 bg-warning-50 p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-warning-800">
            <RotateCcw className="h-4 w-4 shrink-0" aria-hidden="true" />
            Redo requested
          </h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {data.action_items.map((item) => (
              <Link
                key={item.submission_id}
                to={`/lessons/${item.lesson_id}${selectedCohortId ? `?cohort_id=${selectedCohortId}` : ''}`}
                className="pressable min-w-0 rounded-xl border border-warning-200 bg-surface-raised p-4 hover:border-warning-300"
              >
                <p className="text-sm font-semibold text-ink [overflow-wrap:anywhere]">{item.content_block_title}</p>
                <p className="mt-0.5 text-xs text-ink-secondary [overflow-wrap:anywhere]">{item.lesson_title}</p>
                {item.feedback && <p className="mt-2 line-clamp-3 text-xs leading-5 text-ink-secondary">{markdownExcerpt(item.feedback)}</p>}
              </Link>
            ))}
          </div>
        </div>
      )}

      {derived.courseNotOpen ? (
        <EmptyState
          icon={Hourglass}
          title="Your course isn’t open yet"
          description="Your lessons will appear here as soon as your instructor opens them. If you expected to start already, message your instructor."
          action={<LinkButton to="/messages" variant="secondary"><MessageCircle className="h-4 w-4" aria-hidden="true" />Message your instructor</LinkButton>}
        />
      ) : derived.noLessonsYet ? (
        <EmptyState
          icon={BookOpen}
          title="No lessons published yet"
          description="Your course is set up, but its lessons haven’t been published. Check back soon, or message your instructor if you expected to start."
          action={<LinkButton to="/messages" variant="secondary"><MessageCircle className="h-4 w-4" aria-hidden="true" />Message your instructor</LinkButton>}
        />
      ) : derived.visibleModules.length === 0 ? (
        <EmptyState
          icon={Search}
          title={derived.hasActiveSearch ? 'No matching lessons' : 'Nothing here right now'}
          description={derived.hasActiveSearch ? 'Try a different search or switch filters to see more lessons.' : 'Switch to “All” to see every lesson in your course.'}
          action={derived.hasActiveSearch
            ? <Button variant="secondary" onClick={() => setQuery('')}>Clear search</Button>
            : filter !== 'all' ? <Button variant="secondary" onClick={() => setFilter('all')}>Show all lessons</Button> : undefined}
        />
      ) : (
        <div className="space-y-4">
          {derived.visibleModules.map((mod) => {
            const isCollapsed = !derived.hasActiveSearch && collapsedModules.has(mod.id)

            return (
            <section key={mod.id} className="app-surface relative overflow-hidden before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-slate-200">
              <button
                type="button"
                onClick={() => toggleModuleCollapsed(mod.id)}
                aria-expanded={!isCollapsed}
                className="flex min-h-14 w-full flex-col gap-3 p-5 pl-6 text-left transition-colors duration-150 hover:bg-surface-sunken active:bg-slate-100 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    {isCollapsed ? (
                      <ChevronRight className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
                    ) : (
                      <ChevronDown className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
                    )}
                    <h2 className="min-w-0 font-semibold text-ink [overflow-wrap:anywhere]">{mod.name}</h2>
                    {!mod.available && (
                      <Badge>Locked</Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm tabular-nums text-ink-secondary">
                    {learnerModuleTypeLabel(mod.module_type)}
                    {!mod.available && mod.unlock_date ? ` · unlocks ${formatDate(mod.unlock_date)}` : ''}
                  </p>
                </div>
                <div className="sm:min-w-[220px]">
                  <ProgressBar value={mod.completed_blocks} max={mod.total_blocks} showPercentage={false} size="sm" />
                  <p className="mt-1 text-right text-xs tabular-nums text-ink-muted">
                    {mod.completed_blocks}/{mod.total_blocks} blocks
                  </p>
                </div>
              </button>

              {!isCollapsed && (
              <div className="divide-y divide-line px-5 pb-5">
                {mod.lessons.map((lesson) => {
                  const status = lessonStatus(lesson)
                  const isRedo = derived.redoLessonIds.has(lesson.id)
                  const isPartial = status === 'ready' && lesson.completed_blocks > 0
                  const learnerStatus = learnerLessonStatus({
                    completed: lesson.completed,
                    available: lesson.available,
                    submissionsClosed: lesson.submission_window?.submissions_closed,
                    reviewStatus: isRedo ? 'redo_requested' : lesson.review_status,
                    partial: isPartial,
                  })
                  const rowClassName = `flex items-center gap-3 py-3 ${
                    lesson.available ? 'pressable hover:bg-surface-sunken' : 'cursor-not-allowed opacity-70'
                  }`
                  const rowContent = (
                    <>
                      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${STATUS_TONE_CLASSES[LEARNER_STATUS[learnerStatus].tone]}`}>
                        <StatusIcon status={learnerStatus} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink">{lesson.title}</p>
                        <p className="mt-0.5 text-xs tabular-nums text-ink-secondary">
                          {formatTypeLabel(lesson.lesson_type)}
                          {status === 'locked' ? ` · unlocks ${formatDate(lesson.unlock_date)}` : ` · ${lesson.completed_blocks}/${lesson.total_blocks} blocks`}
                          {lesson.submission_window?.submissions_close_at && status !== 'locked'
                            ? lesson.submission_window.submissions_closed
                              ? ` · submissions closed ${formatShortDateTime(lesson.submission_window.submissions_close_at)}`
                              : ` · submissions close ${formatShortDateTime(lesson.submission_window.submissions_close_at)}`
                            : ''}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {learnerStatus !== 'open' && learnerStatus !== 'upcoming' && <StatusBadge status={learnerStatus} short />}
                        {lesson.available && <ArrowRight className="h-4 w-4 text-ink-muted" aria-hidden="true" />}
                      </div>
                    </>
                  )

                  return lesson.available ? (
                    <Link
                      key={lesson.id}
                      to={`/lessons/${lesson.id}${selectedCohortId ? `?cohort_id=${selectedCohortId}` : ''}`}
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

export function MaterialsRoute() {
  return <Materials />
}
