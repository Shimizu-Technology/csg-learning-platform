import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useLocation, useParams, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  RefreshCw,
  Filter,
  RotateCcw,
  Clock,
  Check,
  ChevronRight,
  Github,
  User,
} from 'lucide-react'
import { api } from '../../lib/api'
import { useStaffResource } from '../../lib/useStaffResource'
import { LoadError } from '../../components/shared/LoadError'
import {
  getLatestSubmissionIds,
  orderSubmissionQueue,
  submissionWhereLabel,
} from '../../lib/submissionQueue'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { EmptyState } from '../../components/shared/EmptyState'
import { Modal } from '../../components/shared/Modal'
import { StatusBadge } from '../../components/shared/StatusBadge'
import { SubmissionStatus } from '../../components/shared/SubmissionStatus'
import { Avatar } from '../../components/ui/Avatar'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { FilterChip, SegmentButton, SegmentedControl } from '../../components/ui/Choice'
import { formatShortDate, formatShortDateTime } from '../../lib/format'
import { useListScrollMemory } from '../../lib/navigationContext'
import {
  SubmissionReviewPanel,
  type SubmissionReviewHandle,
} from '../../components/admin/SubmissionReviewPanel'
import type { Submission } from '../../types/api'

type QueueFilter = 'ungraded' | 'redo' | 'all'
type ViewMode = 'students' | 'queue' | 'grid'

/** Grid cell tones, matching the Badge / StatusBadge status colours. */
const CELL_TONES = {
  pending: 'bg-pending-100 text-pending-700 hover:bg-pending-200',
  success: 'bg-success-100 text-success-700 hover:bg-success-200',
  warning:
    'bg-warning-100 text-warning-800 ring-1 ring-inset ring-warning-300 hover:bg-warning-200',
  progress: 'bg-surface-raised text-ink-secondary ring-1 ring-inset ring-line-strong',
  empty: 'bg-surface-sunken text-ink-muted',
} as const

interface StudentSummary {
  user_id: number
  full_name: string
  email: string
  github_username: string | null
  total_exercises: number
  submitted: number
  ungraded: number
  graded: number
  redo: number
}

type SubmissionItem = Submission

interface ExerciseInfo {
  id: number
  filename: string | null
  title: string
  release_day: number
  lesson_title: string
  requires_submission: boolean
  submission_type: string
  submission_config?: Record<string, unknown>
  github_sync?: boolean
  submission_window?: {
    week_number: number
    submissions_close_at: string | null
    submissions_closed: boolean
    status: 'open' | 'scheduled' | 'closed'
  }
}

interface ProgressItem {
  user_id: number
  content_block_id: number
  status: string
  completed_at: string | null
}

interface GradingData {
  cohort_id: number
  cohort_name: string
  module_id: number
  module_name: string
  requires_github: boolean
  supports_github_sync?: boolean
  open_github_sync_count?: number
  repository_name: string
  students: StudentSummary[]
  exercises: ExerciseInfo[]
  progresses: ProgressItem[]
  submissions: SubmissionItem[]
}

function exerciseDisplayLabel(exercise: ExerciseInfo, index: number): string {
  const rawLabel =
    exercise.filename?.trim() ||
    exercise.title?.trim() ||
    exercise.lesson_title?.trim() ||
    `Exercise ${index + 1}`

  return rawLabel.length > 14 ? `${rawLabel.slice(0, 12)}…` : rawLabel
}

export function CohortModuleGrading() {
  const { cohortId, moduleId } = useParams<{ cohortId: string; moduleId: string }>()
  const weekHeadingIdBase = useId()
  const location = useLocation()
  const navigate = useNavigate()
  const {
    data,
    loading,
    error: loadError,
    reload: loadData,
  } = useStaffResource<GradingData>(`${cohortId}:${moduleId}`, () =>
    api.getCohortModuleSubmissions(Number(cohortId), Number(moduleId)),
  )
  const [params] = useSearchParams()
  const panel = useRef<SubmissionReviewHandle>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncingStudentId, setSyncingStudentId] = useState<number | null>(null)
  const [message, setMessage] = useState('')
  const viewMode: ViewMode =
    params.get('view') === 'queue'
      ? 'queue'
      : params.get('view') === 'students'
        ? 'students'
        : 'grid'
  const queueFilter: QueueFilter =
    params.get('filter') === 'all' ? 'all' : params.get('filter') === 'redo' ? 'redo' : 'ungraded'
  const selectedStudentId = Number(params.get('student')) || null
  const requestedId = Number(params.get('review')) || null
  const selectedId = data?.submissions.some((item) => item.id === requestedId) ? requestedId : null
  const selectedSubmission = data?.submissions.find((item) => item.id === selectedId) || null
  useListScrollMemory(!loading)
  useEffect(() => {
    if (loading || selectedId || !location.hash) return
    const cell = document.getElementById(location.hash.slice(1))
    cell?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    cell?.focus()
  }, [loading, selectedId, location.hash])
  function update(values: Record<string, string | null>, hash = location.hash) {
    const next = new URLSearchParams(params)
    Object.entries(values).forEach(([key, value]) =>
      value === null ? next.delete(key) : next.set(key, value),
    )
    navigate(
      { pathname: location.pathname, search: next.toString(), hash },
      { replace: true, preventScrollReset: true },
    )
  }
  async function guarded(action: () => void) {
    if (!panel.current || (await panel.current.confirmLeave())) action()
  }
  const selectSubmission = (submission: { id: number }) => {
    void guarded(() => update({ review: String(submission.id) }))
  }

  const handleSyncAll = async () => {
    if (!cohortId || !moduleId) return
    setSyncing(true)
    setMessage('')
    const res = await api.syncCohortModuleGithub(Number(cohortId), Number(moduleId))
    if (res.error) {
      setMessage(`Sync failed: ${res.error}`)
    } else {
      const synced = res.data?.synced || 0
      const errors = res.data?.errors || []
      setMessage(
        `Synced ${synced} new submission${synced !== 1 ? 's' : ''}${errors.length > 0 ? ` (${errors.length} error${errors.length !== 1 ? 's' : ''})` : ''}`,
      )
      await loadData()
    }
    setSyncing(false)
  }

  const handleSyncStudent = async (userId: number) => {
    if (!cohortId || !moduleId) return
    setSyncingStudentId(userId)
    setMessage('')
    const res = await api.syncStudentGithub(Number(cohortId), Number(moduleId), userId)
    if (res.error) {
      setMessage(`Sync failed: ${res.error}`)
    } else {
      const synced = res.data?.synced || 0
      const errors = res.data?.errors || []
      setMessage(
        `Synced ${synced} submission${synced !== 1 ? 's' : ''}${errors.length > 0 ? ` — ${errors.join(', ')}` : ''}`,
      )
      await loadData()
    }
    setSyncingStudentId(null)
  }

  const counts = useMemo(
    () => ({
      ungraded: orderSubmissionQueue(data?.submissions || [], 'ungraded').length,
      redo: orderSubmissionQueue(data?.submissions || [], 'redo').length,
      all: data?.submissions.length || 0,
    }),
    [data],
  )
  const latestSubmissionIds = useMemo(() => getLatestSubmissionIds(data?.submissions || []), [data])
  const filteredSubmissions = useMemo(
    () =>
      orderSubmissionQueue(
        (data?.submissions || []).filter(
          (item) => !selectedStudentId || item.user_id === selectedStudentId,
        ),
        viewMode === 'students' && selectedStudentId ? 'all' : queueFilter,
      ),
    [data, selectedStudentId, viewMode, queueFilter],
  )

  const weekGroups = useMemo(() => {
    if (!data?.exercises) return []
    const groups = new Map<number, ExerciseInfo[]>()
    data.exercises.forEach((ex) => {
      const week = Math.floor(ex.release_day / 7) + 1
      if (!groups.has(week)) groups.set(week, [])
      groups.get(week)!.push(ex)
    })
    return Array.from(groups.entries()).sort(([a], [b]) => a - b)
  }, [data])

  const submissionLookup = useMemo(() => {
    if (!data) return new Map<string, SubmissionItem>()
    const lookup = new Map<string, SubmissionItem>()
    data.submissions.forEach((sub) => {
      const key = `${sub.user_id}:${sub.content_block_id}`
      if (!lookup.has(key)) lookup.set(key, sub)
    })
    return lookup
  }, [data])

  const progressLookup = useMemo(() => {
    if (!data) return new Map<string, ProgressItem>()
    const lookup = new Map<string, ProgressItem>()
    data.progresses.forEach((progress) => {
      lookup.set(`${progress.user_id}:${progress.content_block_id}`, progress)
    })
    return lookup
  }, [data])

  const selectedStudent = useMemo(
    () => data?.students.find((student) => student.user_id === selectedStudentId) ?? null,
    [data, selectedStudentId],
  )

  const selectedStudentExercises = useMemo(() => {
    if (!data || !selectedStudentId) return []

    return data.exercises.map((exercise) => {
      const key = `${selectedStudentId}:${exercise.id}`
      return {
        exercise,
        submission: submissionLookup.get(key) ?? null,
        progress: progressLookup.get(key) ?? null,
      }
    })
  }, [data, selectedStudentId, submissionLookup, progressLookup])

  function openGridCell(userId: number, exerciseId: number) {
    const submission = submissionLookup.get(`${userId}:${exerciseId}`)
    if (!submission) return
    void guarded(() => {
      const next = new URLSearchParams(params)
      next.set('review', String(submission.id))
      navigate(
        {
          pathname: location.pathname,
          search: next.toString(),
          hash: `grading-cell-${userId}-${exerciseId}`,
        },
        { replace: true },
      )
    })
  }
  const reviewQueue =
    viewMode === 'grid'
      ? (data?.submissions || []).filter((item) => latestSubmissionIds.has(item.id))
      : filteredSubmissions
  const reviewIndex = reviewQueue.findIndex((item) => item.id === selectedId)
  const reviewPanel = selectedId ? (
    <SubmissionReviewPanel
      key={`${cohortId}:${moduleId}:${selectedId}`}
      ref={panel}
      submissionId={selectedId}
      navigationContext={{
        cohortId: Number(cohortId),
        userId: selectedSubmission?.user_id,
        returnTo: `${location.pathname}${location.search}${location.hash}`,
      }}
      previousId={reviewQueue[reviewIndex - 1]?.id}
      nextId={reviewIndex >= 0 ? reviewQueue[reviewIndex + 1]?.id : null}
      position={reviewIndex >= 0 ? `${reviewIndex + 1} of ${reviewQueue.length}` : undefined}
      onNavigate={(id) => {
        // In the matrix, keep the return anchor on the cell now under review.
        const target = viewMode === 'grid' ? data?.submissions.find((item) => item.id === id) : null
        update({ review: String(id) }, target ? `#grading-cell-${target.user_id}-${target.content_block_id}` : location.hash)
      }}
      onReturn={() => update({ review: null })}
      returnLabel={viewMode === 'grid' ? 'Back to matrix cell' : 'Back to list'}
      onSaved={(saved) => {
        if (
          viewMode === 'queue' &&
          (queueFilter === 'ungraded' || (queueFilter === 'redo' && saved.grade !== 'R'))
        ) {
          const following = reviewQueue[reviewIndex + 1] || reviewQueue[reviewIndex - 1]
          update({ review: following ? String(following.id) : null })
        }
        void loadData()
      }}
    />
  ) : null

  if (loading && !data) return <LoadingSpinner message="Loading grading data..." />
  if (!data)
    return (
      <div className="app-page-wide">
        <LoadError error={loadError || 'Grading data unavailable.'} retry={() => void loadData()} />
      </div>
    )

  const githubSyncClosed = data.supports_github_sync && (data.open_github_sync_count ?? 0) === 0

  return (
    <div className="app-page-wide">
      {loadError && <LoadError error={loadError} stale retry={() => void loadData()} />}
      <Button variant="secondary" disabled={loading} onClick={() => void loadData()}>
        {loading ? 'Refreshing…' : 'Refresh grading'}
      </Button>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <Button
            variant="quiet"
            size="sm"
            onClick={() => void guarded(() => navigate(-1))}
            className="mb-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <p className="app-eyebrow">Focused grading</p>
          <h1 className="app-title mt-2">{data.module_name} — Grading</h1>
          <p className="mt-1 text-sm tabular-nums text-ink-muted">
            {data.cohort_name} · {data.students.length} student
            {data.students.length !== 1 ? 's' : ''}
          </p>
        </div>

        {data.supports_github_sync && (
          <Button
            variant="secondary"
            onClick={handleSyncAll}
            disabled={syncing || githubSyncClosed}
            title={githubSyncClosed ? 'All GitHub-sync submission windows are closed' : undefined}
            className="shrink-0"
          >
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
            {githubSyncClosed
              ? 'GitHub sync closed'
              : syncing
                ? 'Syncing...'
                : 'Sync all from GitHub'}
          </Button>
        )}
      </div>

      {message && (
        <div
          role="status"
          className={`rounded-xl border px-4 py-3 text-sm ${message.startsWith('Sync failed') ? 'border-danger-200 bg-danger-50 text-danger-700' : 'border-line bg-surface-sunken text-ink-secondary'}`}
        >
          {message}
        </div>
      )}

      {/* Queue filters */}
      <div role="group" aria-label="Submission queue" className="flex flex-wrap gap-2">
        <FilterChip
          selected={viewMode === 'queue' && queueFilter === 'ungraded'}
          count={counts.ungraded}
          onClick={() => {
            const firstUngraded = orderSubmissionQueue(data.submissions, 'ungraded')[0]
            void guarded(() =>
              update({
                view: 'queue',
                filter: 'ungraded',
                student: null,
                review: firstUngraded ? String(firstUngraded.id) : null,
              }),
            )
          }}
        >
          <Filter className="h-4 w-4" aria-hidden="true" />
          Ungraded queue
        </FilterChip>
        <FilterChip
          selected={viewMode === 'queue' && queueFilter === 'redo'}
          count={counts.redo}
          onClick={() => {
            void guarded(() =>
              update({ view: 'queue', filter: 'redo', student: null, review: null }),
            )
          }}
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Redo requested
        </FilterChip>
        <FilterChip
          selected={viewMode === 'queue' && queueFilter === 'all'}
          count={counts.all}
          onClick={() => {
            void guarded(() =>
              update({ view: 'queue', filter: 'all', student: null, review: null }),
            )
          }}
        >
          <Clock className="h-4 w-4" aria-hidden="true" />
          All submissions
        </FilterChip>
      </div>

      {/* View toggle */}
      <SegmentedControl label="Grading view" className="w-fit">
        <SegmentButton
          selected={viewMode === 'grid'}
          onClick={() => {
            void guarded(() => update({ view: 'grid', student: null, review: null }))
          }}
        >
          Grid
        </SegmentButton>
        <SegmentButton
          selected={viewMode === 'students'}
          onClick={() => {
            void guarded(() => update({ view: 'students', student: null, review: null }))
          }}
        >
          By student
        </SegmentButton>
        <SegmentButton
          selected={viewMode === 'queue'}
          onClick={() => {
            void guarded(() => update({ view: 'queue', student: null, review: null }))
          }}
        >
          Queue
        </SegmentButton>
      </SegmentedControl>

      {/* Grid View */}
      {viewMode === 'grid' && (
        <>
          {/* Legend */}
          <div className="app-surface px-5 py-4">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-secondary">
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={`inline-flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold ${CELL_TONES.pending}`}
                >
                  +
                </span>
                Awaiting review
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={`inline-flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold ${CELL_TONES.success}`}
                >
                  A
                </span>
                Completed / passing
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={`inline-flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold ${CELL_TONES.warning}`}
                >
                  R
                </span>
                Redo
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={`inline-flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold ${CELL_TONES.progress}`}
                >
                  &bull;
                </span>
                In progress
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={`inline-flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold ${CELL_TONES.empty}`}
                >
                  &mdash;
                </span>
                Not submitted
              </span>
            </div>
          </div>

          {weekGroups.map(([week, exercises]) => {
            const pending = exercises.reduce(
              (acc, ex) =>
                acc +
                data.students.filter((s) => {
                  const sub = submissionLookup.get(`${s.user_id}:${ex.id}`)
                  return sub && sub.grade === null
                }).length,
              0,
            )
            const redos = exercises.reduce(
              (acc, ex) =>
                acc +
                data.students.filter((s) => {
                  const sub = submissionLookup.get(`${s.user_id}:${ex.id}`)
                  return sub && sub.grade === 'R'
                }).length,
              0,
            )
            const completed = exercises.reduce(
              (acc, ex) =>
                acc +
                data.students.filter((s) => {
                  const sub = submissionLookup.get(`${s.user_id}:${ex.id}`)
                  const progress = progressLookup.get(`${s.user_id}:${ex.id}`)
                  return (
                    (sub && sub.grade && sub.grade !== 'R') ||
                    (!ex.requires_submission && progress?.status === 'completed')
                  )
                }).length,
              0,
            )

            return (
              <div key={week} className="app-surface overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
                  <h3
                    id={`${weekHeadingIdBase}-week-${week}`}
                    className="text-base font-semibold text-ink"
                  >
                    Week {week}
                  </h3>
                  <div className="flex flex-wrap items-center gap-2">
                    {pending > 0 && (
                      <Badge tone="pending" className="tabular-nums">
                        {pending} pending
                      </Badge>
                    )}
                    {redos > 0 && (
                      <Badge tone="warning" className="tabular-nums">
                        {redos} redo
                      </Badge>
                    )}
                    {completed > 0 && (
                      <Badge tone="success" className="tabular-nums">
                        {completed} completed
                      </Badge>
                    )}
                  </div>
                </div>
                {/* Scrolls inside its own box on desktop so the header row and student column stay pinned. */}
                <div className="overflow-x-auto lg:max-h-[70vh] lg:overflow-y-auto">
                  <table
                    aria-labelledby={`${weekHeadingIdBase}-week-${week}`}
                    className="w-full border-separate border-spacing-0 text-sm"
                  >
                    <thead>
                      <tr>
                        <th
                          scope="col"
                          className="sticky left-0 top-0 z-30 min-w-[110px] border-b border-line bg-surface-sunken px-4 py-2 text-left text-xs font-semibold text-ink-muted"
                        >
                          Student
                        </th>
                        {exercises.map((ex, index) => (
                          <th
                            key={ex.id}
                            scope="col"
                            className="sticky top-0 z-20 min-w-12 border-b border-line bg-surface-sunken px-0.5 py-2 text-center"
                            title={ex.title || ex.lesson_title}
                          >
                            <span className="text-xs font-semibold text-ink-muted">
                              {exerciseDisplayLabel(ex, index)}
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.students.map((student) => (
                        <tr key={student.user_id} className="group">
                          <th
                            scope="row"
                            title={student.full_name || student.email}
                            className="sticky left-0 z-10 whitespace-nowrap border-b border-line bg-surface-raised px-4 py-1 text-left text-xs font-semibold text-ink-secondary transition-colors duration-150 group-hover:bg-surface-sunken"
                          >
                            {(() => {
                              const name = student.full_name || student.email
                              const parts = name.split(' ')
                              if (parts.length >= 2)
                                return `${parts[0]} ${parts[parts.length - 1][0]}.`
                              return parts[0]
                            })()}
                          </th>
                          {exercises.map((ex) => {
                            const key = `${student.user_id}:${ex.id}`
                            const sub = submissionLookup.get(key)
                            const progress = progressLookup.get(key)
                            let cellClass: string
                            let label: string
                            let title: string
                            let clickable = false

                            if (sub) {
                              clickable = true
                              if (sub.grade === null) {
                                cellClass = CELL_TONES.pending
                                label = '+'
                                title = 'Awaiting review — Click to grade'
                              } else if (sub.grade === 'R') {
                                cellClass = CELL_TONES.warning
                                label = 'R'
                                title = 'Redo — Click to review'
                              } else {
                                cellClass = CELL_TONES.success
                                label = sub.grade
                                title = `Grade: ${sub.grade} — Click to review`
                              }
                            } else if (!ex.requires_submission) {
                              if (progress?.status === 'completed') {
                                cellClass = CELL_TONES.success
                                label = '✓'
                                title = 'Completed by student — no submission required'
                              } else if (progress?.status === 'in_progress') {
                                cellClass = CELL_TONES.progress
                                label = '•'
                                title = 'In progress — no submission required'
                              } else {
                                cellClass = CELL_TONES.empty
                                label = '\u2014'
                                title = 'Not done yet — no submission required'
                              }
                            } else {
                              cellClass = CELL_TONES.empty
                              label = '\u2014'
                              title = 'Not submitted'
                            }

                            return (
                              <td
                                key={ex.id}
                                className="border-b border-line px-0.5 py-1 text-center transition-colors duration-150 group-hover:bg-surface-sunken"
                              >
                                <button
                                  id={`grading-cell-${student.user_id}-${ex.id}`}
                                  type="button"
                                  onClick={() => clickable && openGridCell(student.user_id, ex.id)}
                                  disabled={!clickable}
                                  title={title}
                                  aria-label={`${student.full_name || student.email}, ${ex.title || ex.lesson_title}: ${title}`}
                                  className={`inline-flex h-11 w-11 items-center justify-center rounded-lg text-xs font-bold tabular-nums transition-colors duration-150 lg:h-9 lg:w-9 ${cellClass} ${clickable ? 'cursor-pointer' : 'cursor-default'}`}
                                >
                                  {label}
                                </button>
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}

          <Modal
            open={Boolean(selectedId)}
            onClose={() => void guarded(() => update({ review: null }))}
            title="Submission review"
            size="xl"
          >
            {reviewPanel}
          </Modal>
        </>
      )}

      {viewMode !== 'grid' && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Left panel: student list or submission queue */}
          <div className="min-w-0 space-y-2 lg:col-span-2">
            {viewMode === 'students' && !selectedStudentId ? (
              /* Student list */
              data.students.length === 0 ? (
                <EmptyState
                  icon={User}
                  title="No students"
                  description="No active students in this cohort."
                />
              ) : (
                data.students.map((student) => (
                  <button
                    key={student.user_id}
                    type="button"
                    onClick={() => {
                      void guarded(() => update({ student: String(student.user_id), review: null }))
                    }}
                    className="pressable min-h-11 w-full rounded-2xl border border-line bg-surface-raised p-3 text-left hover:bg-surface-sunken sm:p-4"
                  >
                    <div className="flex items-start gap-3">
                      <Avatar name={student.full_name || student.email} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p
                          className="truncate text-sm font-semibold text-ink"
                          title={student.full_name || student.email}
                        >
                          {student.full_name || student.email}
                        </p>
                        {student.github_username && (
                          <div className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-ink-muted">
                            <Github className="h-3 w-3 shrink-0" />
                            <span className="truncate">{student.github_username}</span>
                          </div>
                        )}
                        {(student.ungraded > 0 || student.redo > 0) && (
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            {student.ungraded > 0 && (
                              <Badge tone="pending" className="tabular-nums">
                                {student.ungraded} ungraded
                              </Badge>
                            )}
                            {student.redo > 0 && (
                              <Badge tone="warning" className="tabular-nums">
                                {student.redo} redo
                              </Badge>
                            )}
                          </div>
                        )}
                      </div>
                      <ChevronRight
                        className="mt-2 h-4 w-4 shrink-0 text-ink-muted"
                        aria-hidden="true"
                      />
                    </div>
                    <div className="mt-3 flex items-center gap-4 text-xs tabular-nums text-ink-muted">
                      <span>
                        {student.submitted}/{student.total_exercises} submitted
                      </span>
                      <span>{student.graded} graded</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-success-500"
                        style={{
                          width: `${student.total_exercises > 0 ? (student.graded / student.total_exercises) * 100 : 0}%`,
                        }}
                      />
                    </div>
                  </button>
                ))
              )
            ) : (
              /* Submission list (queue or per-student) */
              <>
                {selectedStudentId && (
                  <Button
                    variant="quiet"
                    size="sm"
                    onClick={() => {
                      void guarded(() => update({ student: null, review: null }))
                    }}
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Back to student list
                  </Button>
                )}

                {selectedStudentId &&
                  data.supports_github_sync &&
                  (() => {
                    if (!selectedStudent?.github_username) return null
                    return (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleSyncStudent(selectedStudentId)}
                        disabled={githubSyncClosed || syncingStudentId === selectedStudentId}
                        title={
                          githubSyncClosed
                            ? 'All GitHub-sync submission windows are closed'
                            : undefined
                        }
                        className="max-w-full"
                      >
                        <RefreshCw
                          className={`h-3.5 w-3.5 shrink-0 ${syncingStudentId === selectedStudentId ? 'animate-spin' : ''}`}
                        />
                        <span className="truncate">
                          {githubSyncClosed
                            ? 'GitHub sync closed'
                            : syncingStudentId === selectedStudentId
                              ? 'Syncing...'
                              : `Sync ${selectedStudent.full_name || selectedStudent.email}`}
                        </span>
                      </Button>
                    )
                  })()}

                {viewMode === 'students' && selectedStudentId ? (
                  selectedStudentExercises.length === 0 ? (
                    <EmptyState
                      icon={Check}
                      title="No exercises in this module"
                      description="This module does not have any exercise blocks yet."
                    />
                  ) : (
                    selectedStudentExercises.map(({ exercise, submission, progress }) => {
                      const clickable = Boolean(submission)
                      const requiresSubmission = exercise.requires_submission
                      const isSelected =
                        Boolean(submission) && selectedSubmission?.id === submission?.id
                      const statusTone = isSelected
                        ? 'nav-selected border-line-strong'
                        : clickable
                          ? 'border-line bg-surface-raised hover:bg-surface-sunken'
                          : 'border-line bg-surface-raised'

                      return (
                        <button
                          key={exercise.id}
                          type="button"
                          onClick={() => submission && selectSubmission(submission)}
                          disabled={!clickable}
                          aria-current={isSelected ? 'true' : undefined}
                          className={`pressable min-h-11 w-full rounded-2xl border p-3 text-left sm:p-4 ${statusTone} ${clickable ? '' : 'cursor-default'}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p
                                className="truncate text-sm font-semibold text-ink"
                                title={exercise.title || exercise.lesson_title}
                              >
                                {exercise.title || exercise.lesson_title}
                              </p>
                              <p
                                className="mt-1 truncate text-xs text-ink-secondary"
                                title={exercise.lesson_title}
                              >
                                {exercise.lesson_title}
                              </p>
                              <p className="mt-0.5 break-words text-xs text-ink-muted">
                                {exercise.filename?.trim()
                                  ? `File: ${exercise.filename}`
                                  : requiresSubmission
                                    ? 'Submission required'
                                    : 'Practice block — no submission required'}
                              </p>
                              {submission && (
                                <p className="mt-0.5 text-xs tabular-nums text-ink-muted">
                                  Attempt {submission.num_submissions} ·{' '}
                                  {formatShortDateTime(submission.created_at)}
                                </p>
                              )}
                              {!submission && progress?.completed_at && (
                                <p className="mt-0.5 text-xs tabular-nums text-ink-muted">
                                  Completed {formatShortDate(progress.completed_at)}
                                </p>
                              )}
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              {submission ? (
                                <SubmissionStatus grade={submission.grade} />
                              ) : requiresSubmission ? (
                                <Badge tone="neutral">Not submitted</Badge>
                              ) : progress?.status === 'completed' ? (
                                <Badge tone="success">Completed</Badge>
                              ) : progress?.status === 'in_progress' ? (
                                <StatusBadge status="in_progress" short />
                              ) : (
                                <Badge tone="neutral">Not done</Badge>
                              )}
                              {clickable && (
                                <ChevronRight
                                  className="hidden h-4 w-4 text-ink-muted sm:block"
                                  aria-hidden="true"
                                />
                              )}
                            </div>
                          </div>
                        </button>
                      )
                    })
                  )
                ) : filteredSubmissions.length === 0 ? (
                  <EmptyState
                    icon={Check}
                    title={
                      selectedStudentId
                        ? 'No submissions yet'
                        : queueFilter === 'ungraded'
                          ? 'All caught up!'
                          : queueFilter === 'redo'
                            ? 'No redo queue'
                            : 'No submissions'
                    }
                    description={
                      selectedStudentId
                        ? "This student hasn't submitted any work yet."
                        : queueFilter === 'ungraded'
                          ? 'No ungraded submissions.'
                          : queueFilter === 'redo'
                            ? 'No redo-requested submissions.'
                            : 'No submissions yet.'
                    }
                  />
                ) : (
                  filteredSubmissions.map((sub) => {
                    const isLatest = latestSubmissionIds.has(sub.id)
                    const isSelected = selectedSubmission?.id === sub.id
                    const where = submissionWhereLabel(sub.lesson_title, sub.content_block_title)
                    return (
                      <button
                        key={sub.id}
                        type="button"
                        onClick={() => selectSubmission(sub)}
                        aria-current={isSelected ? 'true' : undefined}
                        className={`pressable flex min-h-11 w-full min-w-0 items-start gap-3 rounded-2xl border p-3 text-left sm:p-4 ${
                          isSelected
                            ? 'nav-selected border-line-strong'
                            : 'border-line bg-surface-raised hover:bg-surface-sunken'
                        }`}
                      >
                        {!selectedStudentId && <Avatar name={sub.user_name} size="sm" />}
                        <div className="min-w-0 flex-1">
                          {!selectedStudentId && (
                            <p
                              className="truncate text-sm font-semibold text-ink"
                              title={sub.user_name}
                            >
                              {sub.user_name}
                            </p>
                          )}
                          <p
                            className={`truncate ${selectedStudentId ? 'text-sm font-semibold text-ink' : 'mt-0.5 text-xs text-ink-secondary'}`}
                            title={where}
                          >
                            {where}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                            <SubmissionStatus grade={sub.grade} />
                            <Badge tone={isLatest ? 'info' : 'neutral'}>
                              {isLatest ? 'Latest' : 'Previous'}
                            </Badge>
                            <span className="text-xs tabular-nums text-ink-muted">
                              Attempt {sub.num_submissions} · {formatShortDateTime(sub.created_at)}
                            </span>
                          </div>
                        </div>
                        <ChevronRight
                          className="mt-2 hidden h-4 w-4 shrink-0 text-ink-muted sm:block"
                          aria-hidden="true"
                        />
                      </button>
                    )
                  })
                )}
              </>
            )}
          </div>

          {/* Right panel: grading detail */}
          <div className="min-w-0 lg:col-span-3">
            {selectedId ? (
              <div className="app-surface space-y-4 p-4 sm:p-6 lg:sticky lg:top-4">
                {reviewPanel}
              </div>
            ) : (
              <div className="hidden min-h-[400px] items-center justify-center rounded-2xl border border-dashed border-line bg-surface-sunken p-6 lg:flex">
                <div className="text-center">
                  <Check className="mx-auto mb-3 h-10 w-10 text-ink-muted" />
                  <p className="text-sm text-ink-secondary">
                    {viewMode === 'students' && selectedStudentId
                      ? 'Select a submission to review'
                      : 'Select a submission to start grading'}
                  </p>
                  <p className="mt-1 text-xs text-ink-muted">
                    {viewMode === 'students' && selectedStudentId
                      ? 'Exercises without submissions still show their completion state on the left.'
                      : 'Or choose Ungraded queue above to start grading all'}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
