import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { CheckCircle2, ArrowLeft, Play, Code, FileText, BookOpen, Lock } from 'lucide-react'
import { api } from '../../lib/api'
import { useCohortContext } from '../../contexts/CohortContext'
import { useAuthContext } from '../../contexts/AuthContext'
import { formatShortDate, formatShortDateTime } from '../../lib/format'
import { ProgressBar } from '../../components/shared/ProgressBar'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { StatusBadge } from '../../components/shared/StatusBadge'
import { EmptyState } from '../../components/shared/EmptyState'
import { LinkButton } from '../../components/ui/Button'
import { learnerLessonStatus, type ReviewStatus } from '../../lib/learningStatus'

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
    available?: boolean
    unlock_date?: string | null
    content_blocks_count?: number
    content_blocks?: Array<{
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
  const { selectedCohortId } = useCohortContext()
  const { user } = useAuthContext()
  const [mod, setMod] = useState<ModuleData | null>(null)
  const [loading, setLoading] = useState(true)
  const [progressData, setProgressData] = useState<Record<number, { status: string; completedBlocks: number; totalBlocks: number; reviewStatus?: ReviewStatus; submissionWindow?: { submissions_close_at: string | null; submissions_closed: boolean } }>>({})
  const [moduleProgress, setModuleProgress] = useState<{ completedBlocks: number; totalBlocks: number } | null>(null)

  useEffect(() => {
    if (!id) return
    setLoading(true)
    setMod(null)
    setProgressData({})
    setModuleProgress(null)
    if (!user?.is_staff && !selectedCohortId) {
      setLoading(false)
      return
    }
    let canceled = false

    Promise.all([
      api.getModule(Number(id), selectedCohortId ?? undefined),
      api.getDashboard(selectedCohortId ?? undefined),
    ]).then(([modRes, dashRes]) => {
      if (canceled) return
      if (modRes.data) setMod(modRes.data.module)

      // Build progress map from dashboard data
      if (dashRes.data?.dashboard?.modules) {
        const targetMod = dashRes.data.dashboard.modules.find((m: any) => m.id === Number(id))
        if (targetMod) {
          const map: Record<number, { status: string; completedBlocks: number; totalBlocks: number; reviewStatus?: ReviewStatus; submissionWindow?: { submissions_close_at: string | null; submissions_closed: boolean } }> = {}
          targetMod.lessons.forEach((l: any) => {
            map[l.id] = {
              status: l.completed ? 'completed' : l.available ? 'available' : 'locked',
              completedBlocks: l.completed_blocks || 0,
              totalBlocks: l.total_blocks || 0,
              reviewStatus: l.review_status,
              submissionWindow: l.submission_window,
            }
          })
          setProgressData(map)
          setModuleProgress({
            completedBlocks: targetMod.completed_blocks || 0,
            totalBlocks: targetMod.total_blocks || 0,
          })
        }
      }

      setLoading(false)
    })
    return () => { canceled = true }
  }, [id, selectedCohortId, user?.is_staff])

  if (loading) return <LoadingSpinner message="Loading module..." />
  if (!mod) return <EmptyState icon={BookOpen} title={!user?.is_staff && !selectedCohortId ? 'Choose a cohort to view this module.' : 'Module not found or unavailable in this cohort.'} action={<LinkButton to="/materials" variant="secondary"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to Learn</LinkButton>} />

  const cohortQuery = selectedCohortId ? `?cohort_id=${selectedCohortId}` : ''

  const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

  // Group lessons by week, then by day within each week
  const lessonsByWeekDay = mod.lessons.reduce<Record<number, Record<number, typeof mod.lessons>>>((acc, lesson) => {
    const week = Math.floor(lesson.release_day / 7) + 1
    const dayIdx = lesson.release_day % 7
    if (!acc[week]) acc[week] = {}
    if (!acc[week][dayIdx]) acc[week][dayIdx] = []
    acc[week][dayIdx].push(lesson)
    return acc
  }, {})

  const availableLessons = mod.lessons.filter((l) => l.available ?? progressData[l.id]?.status !== 'locked')
  const totalLessons = availableLessons.length
  const completedLessons = availableLessons.filter((l) => progressData[l.id]?.status === 'completed').length
  const progressValue = moduleProgress?.completedBlocks ?? completedLessons
  const progressMax = moduleProgress?.totalBlocks ?? totalLessons

  return (
    <div className="app-page max-w-5xl">
      {/* Header */}
      <div>
        <Link to="/materials" className="mb-4 inline-flex min-h-11 items-center gap-1 rounded-xl px-2 text-sm font-semibold text-ink-secondary transition-colors duration-150 hover:bg-surface-sunken hover:text-ink active:bg-slate-200/70">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Learn
        </Link>
        <div className="app-surface p-6">
          <p className="app-eyebrow">Learning path</p>
          <h1 className="app-title mt-2 [overflow-wrap:anywhere]">{mod.name}</h1>
          {mod.description && <p className="mt-2 text-ink-secondary">{mod.description}</p>}
          <div className="mt-4">
            <ProgressBar value={progressValue} max={progressMax} label="Progress" />
          </div>
        </div>
      </div>

      {/* Lessons grouped by week and day */}
      <div className="space-y-8">
        {Object.keys(lessonsByWeekDay)
          .map(Number)
          .sort((a, b) => a - b)
          .map((weekNum) => {
            const dayGroups = lessonsByWeekDay[weekNum]
            const dayIndices = Object.keys(dayGroups).map(Number).sort((a, b) => a - b)

            const hasVisibleLesson = dayIndices.some(di => dayGroups[di].length > 0)
            if (!hasVisibleLesson) return null

            return (
              <div key={weekNum}>
                <h2 className="mb-4 text-lg font-bold tabular-nums text-ink">Week {weekNum}</h2>
                <div className="space-y-5">
                  {dayIndices.map((dayIdx) => {
                    const lessons = dayGroups[dayIdx]
                    const visibleLessons = lessons
                    if (visibleLessons.length === 0) return null

                    return (
                      <div key={dayIdx}>
                        <h3 className="mb-3 text-sm font-semibold text-ink-muted">
                          {DAY_NAMES[dayIdx] || `Day ${dayIdx}`}
                        </h3>
                        <div className="space-y-2">
                          {visibleLessons.map((lesson) => {
                            const lessonProgress = progressData[lesson.id]
                            const isLocked = lesson.available === false || (lesson.available === undefined && lessonProgress?.status === 'locked')
                            const isCompleted = lessonProgress?.status === 'completed'
                            const isPartial = !isCompleted && (lessonProgress?.completedBlocks || 0) > 0
                            const submissionWindow = lessonProgress?.submissionWindow
                            const blockCount = lessonProgress?.totalBlocks ?? lesson.content_blocks_count ?? lesson.content_blocks?.length ?? 0
                            const status = lessonProgress ? learnerLessonStatus({
                              completed: isCompleted,
                              submissionsClosed: submissionWindow?.submissions_closed,
                              reviewStatus: lessonProgress.reviewStatus,
                              partial: isPartial,
                            }) : null
                            const isDone = status === 'done'

                            if (isLocked) {
                              return (
                                <div key={lesson.id} className="flex items-start gap-3 rounded-2xl border border-line bg-surface-sunken p-4 sm:items-center">
                                  <Lock className="h-5 w-5 shrink-0 text-ink-muted" aria-hidden="true" />
                                  <div className="min-w-0 flex-1">
                                    <p className="text-sm font-medium text-ink">{lesson.title}</p>
                                    <p className="mt-0.5 text-xs text-ink-secondary">{lesson.unlock_date ? `Opens ${formatShortDate(lesson.unlock_date)} (ChST)` : 'Locked'}</p>
                                  </div>
                                </div>
                              )
                            }

                            return (
                              <Link
                                key={lesson.id}
                                to={`/lessons/${lesson.id}${cohortQuery}`}
                                className="pressable group flex items-start gap-3 rounded-2xl border border-line bg-surface-raised p-4 hover:border-line-strong hover:bg-surface-sunken sm:items-center"
                              >
                                <div className={`shrink-0 ${isDone ? 'text-success-700' : 'text-ink-muted'}`}>
                                  {isDone ? <CheckCircle2 className="h-5 w-5" /> : lessonTypeIcons[lesson.lesson_type] || <FileText className="h-5 w-5" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className={`text-sm font-medium ${isDone ? 'text-ink-secondary' : 'text-ink'}`}>
                                    {lesson.title}
                                  </p>
                                  <div className="mt-0.5 flex flex-wrap items-center gap-2">
                                    <span className="text-xs capitalize text-ink-muted">{lesson.lesson_type}</span>
                                    <span className="text-xs tabular-nums text-ink-secondary">· {blockCount} {blockCount === 1 ? 'block' : 'blocks'}</span>
                                    {isPartial && status === 'in_progress' && (
                                      <span className="text-xs font-medium tabular-nums text-ink-secondary">
                                        · {lessonProgress?.completedBlocks}/{lessonProgress?.totalBlocks} done
                                      </span>
                                    )}
                                    {submissionWindow?.submissions_close_at && (
                                      <span className="text-xs font-medium tabular-nums text-ink-secondary">
                                        · {submissionWindow.submissions_closed ? 'submissions closed' : 'submissions close'} {formatShortDateTime(submissionWindow.submissions_close_at)}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                {status && status !== 'open' && <StatusBadge status={status} short />}
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
          })}
      </div>
    </div>
  )
}
