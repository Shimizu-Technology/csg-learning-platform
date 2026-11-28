import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useLocation, useParams, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  BadgeCheck,
  ClipboardList,
  RefreshCw,
  Filter,
  RotateCcw,
  Clock,
  Check,
  ChevronRight,
  CircleDashed,
  Github,
  Minus,
  User,
  type LucideIcon,
} from 'lucide-react'
import { api } from '../../lib/api'
import { useStaffResource } from '../../lib/useStaffResource'
import { LoadError } from '../../components/shared/LoadError'
import {
  moduleReviewQueue,
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
import { Button, LinkButton } from '../../components/ui/Button'
import { FilterChip, SegmentButton, SegmentedControl } from '../../components/ui/Choice'
import { formatShortDate, formatShortDateTime } from '../../lib/format'
import { forwardReturnState, useListScrollMemory } from '../../lib/navigationContext'
import {
  SubmissionReviewPanel,
  type SubmissionReviewHandle,
} from '../../components/admin/SubmissionReviewPanel'
import type { Submission } from '../../types/api'
import { RecordLink } from '../../components/shared/RecordLink'
import { RecordHeader, staffBreadcrumb } from '../../components/shared/RecordHeader'
import { useBackLink } from '../../lib/recordOrigin'
import { cohortPath } from '../../lib/routes'
import { useGuardedLinkClick } from '../../lib/useLeaveGuard'
import { defaultGradingWeek, exerciseColumnLabels, exerciseFullLabel } from '../../lib/moduleGradingGrid'

type QueueFilter = 'ungraded' | 'redo' | 'all'
type ViewMode = 'students' | 'queue' | 'grid'

/** Grid cell tones, matching the Badge / StatusBadge status colours. */
const CELL_TONES = {
  pending: 'bg-surface-sunken text-ink-secondary hover:bg-line',
  success: 'bg-success-soft text-success-ink hover:bg-success-line',
  warning:
    'bg-warning-soft text-warning-ink ring-1 ring-inset ring-warning-line hover:bg-warning-line',
  progress: 'bg-surface-raised text-ink-secondary ring-1 ring-inset ring-line-strong',
  empty: 'bg-surface-sunken text-ink-muted',
} as const

/** Grid cells use Lucide icons, never glyphs (T-13); letter grades stay letters, Pass is a badge check. */
type LegendItem = { tone: keyof typeof CELL_TONES; icon?: LucideIcon; text?: string; label: string }
function legendFor(gradingScale: string | null | undefined): LegendItem[] {
  return [
    { tone: 'pending', icon: Clock, label: 'Waiting for review' },
    gradingScale === 'pass_redo'
      ? { tone: 'success', icon: BadgeCheck, label: 'Passed' }
      : { tone: 'success', text: 'A', label: 'Graded' },
    { tone: 'warning', icon: RotateCcw, label: 'Redo requested' },
    { tone: 'success', icon: Check, label: 'Completed (no submission needed)' },
    { tone: 'progress', icon: CircleDashed, label: 'In progress' },
    { tone: 'empty', icon: Minus, label: 'Not submitted' },
  ]
}

/** The outcome of a GitHub sync, naming each student it could not finish and why. */
interface SyncNotice {
  failed: boolean
  text: string
  /** user_id is null only for an older server's message that names no student. */
  students: { user_id: number | null; name: string; errors: string[] }[]
}

type SyncFailure = { user_id: number; full_name?: string | null; errors: string[] }

/**
 * Students a module sync could not finish. Servers before failed_students only sent flat
 * "User 21: reason" strings, so those are grouped by id during a staggered deploy.
 */
export function syncFailures(data: { failed_students?: SyncFailure[]; errors?: string[] } | null | undefined): SyncFailure[] {
  if (Array.isArray(data?.failed_students)) return data.failed_students
  const byUser = new Map<number, SyncFailure>()
  const unmatched: string[] = []
  for (const line of data?.errors || []) {
    const match = /^User (\d+): (.*)$/s.exec(line)
    if (!match) {
      unmatched.push(line)
      continue
    }
    const id = Number(match[1])
    const entry = byUser.get(id) || { user_id: id, errors: [] }
    entry.errors.push(match[2])
    byUser.set(id, entry)
  }
  return [...byUser.values(), ...(unmatched.length ? [{ user_id: 0, errors: unmatched }] : [])]
}

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
  lesson_id?: number
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
  /** The curriculum's grading scale (older servers omit it: A / B / C / Redo). */
  grading_scale?: 'letter_abc_redo' | 'pass_redo'
  requires_github: boolean
  github_sync_enabled?: boolean
  /** Verified GitHub App repositories are synced by the hourly scheduled run. */
  github_auto_sync?: boolean
  supports_github_sync?: boolean
  open_github_sync_count?: number
  repository_name: string
  students: StudentSummary[]
  exercises: ExerciseInfo[]
  progresses: ProgressItem[]
  submissions: SubmissionItem[]
}

export function CohortModuleGrading() {
  const { cohortId, moduleId } = useParams<{ cohortId: string; moduleId: string }>()
  const weekHeadingIdBase = useId()
  const location = useLocation()
  const navigate = useNavigate()
  // Back names where this grid was opened from; with no origin it goes to Grading for this cohort.
  const back = useBackLink({ returnTo: `/admin/grading${Number(cohortId) > 0 ? `?cohort_id=${Number(cohortId)}` : ''}`, returnLabel: 'Grading' }, { accept: 'any' })
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
  // Record links leave the page, so a plain click asks about unsaved feedback in the open review first.
  const guardLeave = useGuardedLinkClick(() => panel.current?.confirmLeave())
  const [syncing, setSyncing] = useState(false)
  const [syncingStudentId, setSyncingStudentId] = useState<number | null>(null)
  const [message, setMessage] = useState<SyncNotice | null>(null)
  // A sync notice (and its student links) belongs to one cohort and module: moving to another
  // clears it, and a sync that answers after the move is ignored.
  const scope = `${cohortId}:${moduleId}`
  const currentScope = useRef(scope)
  useEffect(() => {
    currentScope.current = scope
    setMessage(null)
    setSyncing(false)
    setSyncingStudentId(null)
  }, [scope])
  const viewMode: ViewMode =
    params.get('view') === 'queue'
      ? 'queue'
      : params.get('view') === 'students'
        ? 'students'
        : 'grid'
  const queueFilter: QueueFilter =
    params.get('filter') === 'all' ? 'all' : params.get('filter') === 'redo' ? 'redo' : 'ungraded'
  // Ids from the URL count only when they name a student on this page; anything else selects nobody.
  const requestedStudentId = Number(params.get('student'))
  const selectedStudentId = Number.isSafeInteger(requestedStudentId) && data?.students.some((student) => student.user_id === requestedStudentId) ? requestedStudentId : null
  const showAllWeeks = params.get('week') === 'all'
  const requestedWeek = Number(params.get('week')) || null
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
    // Choosing a view, filter or student pushes history so Back undoes it (L-0.6); opening or
    // stepping through reviews replaces it. Either way the page keeps its origin.
    const pushes = ['view', 'filter', 'student', 'week'].some((key) => key in values && (params.get(key) ?? null) !== values[key])
    navigate(
      { pathname: location.pathname, search: next.toString(), hash },
      { replace: !pushes, preventScrollReset: true, state: forwardReturnState(location.state) },
    )
  }
  async function guarded(action: () => void) {
    if (!panel.current || (await panel.current.confirmLeave())) action()
  }
  const selectSubmission = (submission: { id: number }) => {
    void guarded(() => update({ review: String(submission.id) }))
  }

  const studentName = (userId: number) =>
    data?.students.find((student) => student.user_id === userId)?.full_name || 'A student'
  const synced = (count: number) => `Synced ${count} new submission${count !== 1 ? 's' : ''}`

  const handleSyncAll = async () => {
    if (!cohortId || !moduleId) return
    const requested = scope
    setSyncing(true)
    setMessage(null)
    const res = await api.syncCohortModuleGithub(Number(cohortId), Number(moduleId))
    if (currentScope.current !== requested) return
    if (res.error) {
      setMessage({ failed: true, text: `Sync failed: ${res.error}`, students: [] })
    } else {
      const failures = syncFailures(res.data)
      const named = failures.filter((failure) => failure.user_id > 0).length
      setMessage({
        failed: false,
        text: `${synced(res.data?.synced || 0)}${failures.length ? `. ${named ? `Could not sync ${named === 1 ? '1 student' : `${named} students`}` : 'Some work could not sync'}:` : ''}`,
        students: failures.map((failure) => failure.user_id > 0
          ? { user_id: failure.user_id, name: failure.full_name || studentName(failure.user_id), errors: failure.errors }
          : { user_id: null, name: 'Other', errors: failure.errors }),
      })
      await loadData()
    }
    setSyncing(false)
  }

  const handleSyncStudent = async (userId: number) => {
    if (!cohortId || !moduleId) return
    const requested = scope
    setSyncingStudentId(userId)
    setMessage(null)
    const res = await api.syncStudentGithub(Number(cohortId), Number(moduleId), userId)
    if (currentScope.current !== requested) return
    if (res.error) {
      setMessage({ failed: true, text: `Sync failed for ${studentName(userId)}: ${res.error}`, students: [] })
    } else {
      const errors: string[] = res.data?.errors || []
      setMessage({
        failed: false,
        text: `${synced(res.data?.synced || 0)} for ${studentName(userId)}${errors.length ? '. Some work could not sync:' : ''}`,
        students: errors.length ? [{ user_id: userId, name: studentName(userId), errors }] : [],
      })
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

  // One week at a time (the grid ran about 3,600px): the week in the URL, the week of the open
  // review, or the first week with work waiting (U-4.2).
  const selectedWeek = useMemo(() => {
    if (requestedWeek && weekGroups.some(([week]) => week === requestedWeek)) return requestedWeek
    const reviewed = selectedSubmission && data?.exercises.find((exercise) => exercise.id === selectedSubmission.content_block_id)
    if (reviewed) return Math.floor(reviewed.release_day / 7) + 1
    return defaultGradingWeek(weekGroups, data?.submissions || [])
  }, [requestedWeek, weekGroups, selectedSubmission, data])

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
        { replace: true, state: forwardReturnState(location.state) },
      )
    })
  }
  // Shared with the submission record page, so a record opened from here walks the same queue.
  const reviewQueue = useMemo(
    () => moduleReviewQueue(data?.submissions || [], { view: viewMode, filter: queueFilter, studentId: selectedStudentId }),
    [data, viewMode, queueFilter, selectedStudentId],
  )
  const reviewIndex = reviewQueue.findIndex((item) => item.id === selectedId)
  // Only the Waiting queue (and a non-Redo grade in the Redo queue) moves on after Save; the grid,
  // students and All views keep the saved item open. The Save label reads this too.
  const followingAfterSave = (grade: string | null) =>
    viewMode === 'queue' && (queueFilter === 'ungraded' || (queueFilter === 'redo' && grade !== 'R'))
      ? reviewQueue[reviewIndex + 1] || reviewQueue[reviewIndex - 1] || null
      : undefined
  const reviewPanel = selectedId ? (
    <SubmissionReviewPanel
      selectionParam="review"
      footerOffset={viewMode === 'grid' ? 'none' : 'shell'}
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
      followingAfterSave={(grade) => followingAfterSave(grade)?.id}
      position={reviewIndex >= 0 ? `${reviewIndex + 1} of ${reviewQueue.length}` : undefined}
      onNavigate={(id) => {
        // In the matrix, keep the return anchor on the cell now under review.
        const target = viewMode === 'grid' ? data?.submissions.find((item) => item.id === id) : null
        update({ review: String(id) }, target ? `#grading-cell-${target.user_id}-${target.content_block_id}` : location.hash)
      }}
      onReturn={() => update({ review: null })}
      returnLabel={viewMode === 'grid' ? 'Back to matrix cell' : 'Back to list'}
      onSaved={(saved) => {
        const following = followingAfterSave(saved.grade)
        // undefined: this view keeps the review open; null: the queue is done, so it closes.
        if (following !== undefined) update({ review: following ? String(following.id) : null })
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

  const workbenchPath = `/admin/grading?cohort_id=${data.cohort_id}&module_id=${data.module_id}`
  const githubSyncClosed = data.github_sync_enabled !== false && data.supports_github_sync && (data.open_github_sync_count ?? 0) === 0

  return (
    <div className="app-page-wide">
      <RecordHeader
        back={back}
        onBack={(event, to) => {
          if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
          event.preventDefault()
          void guarded(() => navigate(to))
        }}
        breadcrumb={staffBreadcrumb({ cohort: { label: data.cohort_name, to: cohortPath(data.cohort_id) }, record: `${data.module_name} grading` })}
        type="Focused grading"
        title={`${data.module_name} — Grading`}
        context={<><RecordLink record={{ type: 'cohort', id: data.cohort_id }} variant="plain" touchTarget onClick={guardLeave} className="font-normal text-ink-muted">{data.cohort_name}</RecordLink><span aria-hidden="true">·</span><span className="tabular-nums">{data.students.length} student{data.students.length !== 1 ? 's' : ''}</span></>}
        actions={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {/* This page is the cohort's progress matrix; the Grading workbench is the one grading queue. */}
          <LinkButton
            to={workbenchPath}
            variant="secondary"
            size="sm"
            onClick={(event) => guardLeave(event, workbenchPath)}
          >
            <ClipboardList className="h-4 w-4" aria-hidden="true" />
            Open Grading workbench
          </LinkButton>
          {data.github_sync_enabled !== false && data.supports_github_sync && (
          <Button
            variant="secondary"
            size="sm"
            onClick={handleSyncAll}
            disabled={syncing || githubSyncClosed}
            title={githubSyncClosed ? 'All GitHub-sync submission windows are closed' : undefined}
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
        }
        menu={[{ key: 'refresh', label: loading ? 'Refreshing…' : 'Refresh', icon: <RefreshCw aria-hidden="true" />, onSelect: () => void loadData() }]}
      />
      {data.github_sync_enabled !== false && data.supports_github_sync && data.github_auto_sync && (
        <p className="text-xs text-ink-muted">Verified GitHub repositories also sync automatically every hour.</p>
      )}
      {loadError && <LoadError error={loadError} stale retry={() => void loadData()} />}

      {message && (
        <div
          role="status"
          className={`space-y-2 rounded-xl border px-4 py-3 text-sm ${message.failed || message.students.length ? 'border-danger-line bg-danger-soft text-danger-ink' : 'border-line bg-surface-sunken text-ink-secondary'}`}
        >
          <p>{message.text}</p>
          {message.students.length > 0 && (
            <ul className="list-disc space-y-1 pl-5">
              {message.students.map((student) => (
                <li key={student.user_id ?? 'other'} className="break-words">
                  {student.user_id ? (
                    <RecordLink record={{ type: 'student', id: student.user_id, cohortId: data.cohort_id }} variant="plain" onClick={guardLeave} className="font-semibold">
                      {student.name}
                    </RecordLink>
                  ) : (
                    <span className="font-semibold">{student.name}</span>
                  )}
                  : {student.errors.join('; ')}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* View toggle + queue filters */}
      <div className="flex flex-wrap items-center gap-3">
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
            Waiting
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
            Redo
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
            All
          </FilterChip>
        </div>
      </div>

      {/* Grid View */}
      {viewMode === 'grid' && (
        <>
          {/* Legend */}
          <div className="app-surface px-5 py-4" data-grid-legend="">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-secondary">
              {legendFor(data.grading_scale).map(({ tone, icon: Icon, text, label }) => (
                <span key={label} className="flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className={`inline-flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold ${CELL_TONES[tone]}`}
                  >
                    {Icon ? <Icon className="h-3.5 w-3.5" /> : text}
                  </span>
                  {label}
                </span>
              ))}
            </div>
          </div>

          {weekGroups.length > 1 && (
            <div role="group" aria-label="Week" className="flex flex-wrap gap-2">
              {weekGroups.map(([week, exercises]) => {
                const ids = new Set(exercises.map((exercise) => exercise.id))
                const waiting = data.submissions.filter((sub) => ids.has(sub.content_block_id) && sub.grade === null && latestSubmissionIds.has(sub.id)).length
                return (
                  <FilterChip
                    key={week}
                    selected={!showAllWeeks && selectedWeek === week}
                    count={waiting || undefined}
                    aria-label={`Week ${week}${waiting ? `, ${waiting} waiting for review` : ''}`}
                    onClick={() => void guarded(() => update({ week: String(week), review: null }, ''))}
                  >
                    Week {week}
                  </FilterChip>
                )
              })}
              <FilterChip
                selected={showAllWeeks}
                onClick={() => void guarded(() => update({ week: 'all', review: null }, ''))}
              >
                All weeks
              </FilterChip>
            </div>
          )}

          {weekGroups.filter(([week]) => showAllWeeks || week === selectedWeek).map(([week, exercises]) => {
            const columnLabels = exerciseColumnLabels(exercises)
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
                        {exercises.map((ex, index) => {
                          const full = exerciseFullLabel(ex, index)
                          return (
                            <th
                              key={ex.id}
                              scope="col"
                              className="sticky top-0 z-20 min-w-12 border-b border-line bg-surface-sunken px-0.5 py-2 text-center"
                            >
                              {/* The full title shows on hover and on keyboard focus (U-4.2); the label links to the lesson (L-2.4). */}
                              <span className="group/col relative inline-flex max-w-full justify-center">
                                {ex.lesson_id ? (
                                  <RecordLink
                                    record={{ type: 'lesson', id: ex.lesson_id, cohortId: data.cohort_id }}
                                    variant="plain"
                                    peek={false}
                                    touchTarget
                                    aria-label={full}
                                    onClick={guardLeave}
                                    className="whitespace-nowrap text-xs font-semibold text-ink-muted"
                                  >
                                    {columnLabels[index]}
                                  </RecordLink>
                                ) : (
                                  <span tabIndex={0} aria-label={full} className="whitespace-nowrap text-xs font-semibold text-ink-muted">{columnLabels[index]}</span>
                                )}
                                <span
                                  role="tooltip"
                                  className="pointer-events-none absolute left-1/2 top-full z-40 mt-1 hidden w-max max-w-64 -translate-x-1/2 whitespace-normal rounded-lg bg-surface-inverse px-2.5 py-1.5 text-left text-xs font-semibold text-ink-on-inverse shadow-overlay group-hover/col:block group-focus-within/col:block"
                                >
                                  {full}
                                </span>
                              </span>
                            </th>
                          )
                        })}
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
                            <RecordLink record={{ type: 'student', id: student.user_id, cohortId: data.cohort_id }} variant="plain" touchTarget onClick={guardLeave} className="text-ink-secondary">
                              {(() => {
                                const name = student.full_name || student.email
                                const parts = name.split(' ')
                                if (parts.length >= 2)
                                  return `${parts[0]} ${parts[parts.length - 1][0]}.`
                                return parts[0]
                              })()}
                            </RecordLink>
                          </th>
                          {exercises.map((ex) => {
                            const key = `${student.user_id}:${ex.id}`
                            const sub = submissionLookup.get(key)
                            const progress = progressLookup.get(key)
                            let cellClass: string
                            let label: string
                            let CellIcon: LucideIcon | null = null
                            let title: string
                            let clickable = false

                            if (sub) {
                              clickable = true
                              if (sub.grade === null) {
                                cellClass = CELL_TONES.pending
                                label = ''
                                CellIcon = Clock
                                title = 'Waiting for review — click to grade'
                              } else if (sub.grade === 'R') {
                                cellClass = CELL_TONES.warning
                                label = ''
                                CellIcon = RotateCcw
                                title = 'Redo requested — click to review'
                              } else if (sub.grade === 'P') {
                                cellClass = CELL_TONES.success
                                label = ''
                                CellIcon = BadgeCheck
                                title = 'Passed — click to review'
                              } else {
                                cellClass = CELL_TONES.success
                                label = sub.grade
                                title = `Grade ${sub.grade} — click to review`
                              }
                            } else if (!ex.requires_submission) {
                              if (progress?.status === 'completed') {
                                cellClass = CELL_TONES.success
                                label = ''
                                CellIcon = Check
                                title = 'Completed by student — no submission required'
                              } else if (progress?.status === 'in_progress') {
                                cellClass = CELL_TONES.progress
                                label = ''
                                CellIcon = CircleDashed
                                title = 'In progress — no submission required'
                              } else {
                                cellClass = CELL_TONES.empty
                                label = ''
                                CellIcon = Minus
                                title = 'Not done yet — no submission required'
                              }
                            } else {
                              cellClass = CELL_TONES.empty
                              label = ''
                              CellIcon = Minus
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
                                  aria-label={`${student.full_name || student.email}, ${exerciseFullLabel(ex, 0)}: ${title}`}
                                  className={`inline-flex h-11 w-11 items-center justify-center rounded-lg text-xs font-bold tabular-nums transition-colors duration-150 lg:h-9 lg:w-9 ${cellClass} ${clickable ? 'cursor-pointer' : 'cursor-default'}`}
                                >
                                  {CellIcon ? <CellIcon className="h-4 w-4" aria-hidden="true" /> : label}
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
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-sunken">
                      <div
                        className="h-full rounded-full bg-success-solid"
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
                  data.github_sync_enabled !== false && data.supports_github_sync &&
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
                                    : 'Practice exercise — no submission required'}
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
                      : 'Or choose Queue above to start grading all'}
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
