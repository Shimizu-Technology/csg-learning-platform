import { AttemptReview, isPreviousAttempt } from '../../components/shared/AttemptReview'
import { useEffect, useId, useMemo, useState, useRef } from 'react'
import { Link, useLocation, useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, RefreshCw, Filter, RotateCcw, Clock, Check, ChevronRight, Github, User, Globe, GitBranch, Keyboard, ExternalLink } from 'lucide-react'
import { api } from '../../lib/api'
import { useStaffResource } from '../../lib/useStaffResource'
import { LoadError } from '../../components/shared/LoadError'
import { submissionWhereLabel } from '../../lib/submissionQueue'
import { cohortStudentPath, submissionPath } from '../../lib/routes'
import { sanitizeUrl } from '../../lib/sanitizeUrl'
import { GradeDisplay } from '../../components/shared/GradeDisplay'
import { CodeEditor, detectLanguage } from '../../components/shared/CodeEditor'
import { CodeRunner } from '../../components/shared/CodeRunner'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { EmptyState } from '../../components/shared/EmptyState'
import { Modal } from '../../components/shared/Modal'
import { MarkdownRenderer } from '../../components/shared/MarkdownRenderer'
import { CODE_RUNNER_TIMEOUT_MS, codeRunnerLanguageFromEditor, normalizeCodeRunnerConfig } from '../../lib/codeRunner'
import { useToast } from '../../contexts/ToastContext'
import { useConfirm } from '../../contexts/ConfirmContext'
import { FeedbackBody, FeedbackFormattingHint } from '../../components/shared/FeedbackBody'
import { StatusBadge } from '../../components/shared/StatusBadge'
import { REDO_BUTTON_CLASSES, SubmissionStatus } from '../../components/shared/SubmissionStatus'
import { Avatar } from '../../components/ui/Avatar'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { FilterChip, SegmentButton, SegmentedControl, TabButton } from '../../components/ui/Choice'
import { formatShortDate, formatShortDateTime } from '../../lib/format'

type QueueFilter = 'ungraded' | 'redo' | 'all'
type ViewMode = 'students' | 'queue' | 'grid'

/** Grid cell tones, matching the Badge / StatusBadge status colours. */
const CELL_TONES = {
  pending: 'bg-pending-100 text-pending-700 hover:bg-pending-200',
  success: 'bg-success-100 text-success-700 hover:bg-success-200',
  warning: 'bg-warning-100 text-warning-800 ring-1 ring-inset ring-warning-300 hover:bg-warning-200',
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

interface SubmissionItem {
  latest_submission_id?: number | null
  id: number
  content_block_id: number
  user_id: number
  user_name: string
  user_email?: string
  submission_type?: string | null
  text: string | null
  grade: string | null
  feedback: string | null
  graded_by: string | null
  graded_at: string | null
  num_submissions: number
  created_at: string
  updated_at: string
  content_block_title: string
  content_block_type: string
  lesson_title: string
  filename?: string | null
  submission_config?: Record<string, unknown>
  language_hint?: string | null
  solution?: string
  exercise_body?: string
  exercise_video_url?: string
  github_issue_url?: string | null
  github_code_url?: string | null
  repo_url?: string | null
  pr_url?: string | null
  live_url?: string | null
  branch?: string | null
  commit_sha?: string | null
  notes?: string | null
}

interface GitHubIssueData {
  title: string
  body: string
  state: string
  created_at: string
  html_url: string
  comments: Array<{
    id: number
    user: string
    body: string
    created_at: string
    updated_at: string
  }>
}

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

function renderSubmissionArtifacts(submission: SubmissionItem) {
  const links = [
    submission.github_code_url ? { label: 'GitHub Code', url: submission.github_code_url, icon: Github } : null,
    submission.repo_url ? { label: 'Repository', url: submission.repo_url, icon: Github } : null,
    submission.pr_url ? { label: 'Pull Request', url: submission.pr_url, icon: GitBranch } : null,
    submission.live_url ? { label: 'Live URL', url: submission.live_url, icon: Globe } : null,
  ].filter(Boolean) as Array<{ label: string; url: string; icon: typeof Github }>

  if (links.length === 0 && !submission.branch && !submission.commit_sha && !submission.notes) return null

  return (
    <div className="space-y-3">
      {links.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {links.map((link) => {
            const Icon = link.icon
            return (
              <a
                key={`${link.label}:${link.url}`}
                href={sanitizeUrl(link.url)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-line bg-surface-raised px-3 py-1.5 text-xs font-semibold text-ink-secondary transition-colors duration-150 hover:border-line-strong hover:bg-surface-sunken hover:text-ink lg:min-h-9"
              >
                <Icon className="h-3.5 w-3.5" />
                {link.label}
              </a>
            )
          })}
        </div>
      )}
      {(submission.branch || submission.commit_sha || submission.notes) && (
        <div className="space-y-1 rounded-xl border border-line bg-surface-sunken p-3 text-xs text-ink-secondary">
          {submission.branch && <p className="break-words"><span className="font-semibold text-ink">Branch:</span> {submission.branch}</p>}
          {submission.commit_sha && <p className="break-all"><span className="font-semibold text-ink">Commit:</span> <span className="font-mono">{submission.commit_sha}</span></p>}
          {submission.notes && <p className="whitespace-pre-wrap"><span className="font-semibold text-ink">Notes:</span> {submission.notes}</p>}
        </div>
      )}
    </div>
  )
}

export function CohortModuleGrading() {
  const { cohortId, moduleId } = useParams<{ cohortId: string; moduleId: string }>()
  const weekHeadingIdBase = useId()
  const location = useLocation()
  const navigate = useNavigate()
  const toast = useToast()
  const confirmAction = useConfirm()
  const { data, loading, error: loadError, reload: loadData } = useStaffResource<GradingData>(`${cohortId}:${moduleId}`, () => api.getCohortModuleSubmissions(Number(cohortId), Number(moduleId)))
  const detailGeneration = useRef(0)
  const scopeRef = useRef(`${cohortId}:${moduleId}`)
  scopeRef.current = `${cohortId}:${moduleId}`
  const [detailError, setDetailError] = useState<{ submission: SubmissionItem; message: string } | null>(null)
  const [gridError, setGridError] = useState<{ userId: number; exerciseId: number; message: string } | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncingStudentId, setSyncingStudentId] = useState<number | null>(null)
  const [message, setMessage] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [queueFilter, setQueueFilter] = useState<QueueFilter>('ungraded')
  const [selectedStudentId, setSelectedStudentId] = useState<number | null>(null)
  const [selectedSubmission, setSelectedSubmission] = useState<SubmissionItem | null>(null)
  const [feedback, setFeedback] = useState('')
  const [grading, setGrading] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [gridModalSubmission, setGridModalSubmission] = useState<SubmissionItem | null>(null)
  const [gridFeedback, setGridFeedback] = useState('')
  const [gridModalOpen, setGridModalOpen] = useState(false)
  const [gridModalTab, setGridModalTab] = useState<'exercise' | 'answer' | 'solution' | 'feedback' | 'github_issue'>('answer')
  const [githubIssueData, setGithubIssueData] = useState<GitHubIssueData | null>(null)
  const [githubIssueError, setGithubIssueError] = useState<string | null>(null)
  const [loadingGithubIssue, setLoadingGithubIssue] = useState(false)

  useEffect(() => {
    detailGeneration.current += 1
    setSelectedSubmission(null)
    setGridModalOpen(false)
    setGridModalSubmission(null)
    setDetailError(null)
    setGridError(null)
    setLoadingDetail(false)
    setSelectedStudentId(null)
    return () => { detailGeneration.current += 1 }
  }, [cohortId, moduleId])

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
      setMessage(`Synced ${synced} new submission${synced !== 1 ? 's' : ''}${errors.length > 0 ? ` (${errors.length} error${errors.length !== 1 ? 's' : ''})` : ''}`)
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
      setMessage(`Synced ${synced} submission${synced !== 1 ? 's' : ''}${errors.length > 0 ? ` — ${errors.join(', ')}` : ''}`)
      await loadData()
    }
    setSyncingStudentId(null)
  }

  const selectSubmission = async (submission: SubmissionItem) => {
    const request = ++detailGeneration.current
    const scope = scopeRef.current
    setSelectedSubmission(null)
    setDetailError(null)
    setLoadingDetail(true)
    try {
      const res = await api.getSubmission(submission.id)
      if (request !== detailGeneration.current || scopeRef.current !== scope) return
      if (!res.data || res.error || res.fromCache) { setDetailError({ submission, message: res.error || 'Could not load submission details.' }); return }
      setSelectedSubmission(res.data.submission)
      setFeedback(res.data.submission.feedback || '')
    } catch (error) {
      if (request === detailGeneration.current && scopeRef.current === scope) setDetailError({ submission, message: (error as Error).message })
    } finally {
      if (request === detailGeneration.current) setLoadingDetail(false)
    }
  }

  const gradedSubmissionRef = useRef<number | null>(null)

  const handleGrade = async (grade: string) => {
    if (!selectedSubmission || isPreviousAttempt(selectedSubmission)) return
    setGrading(true)
    gradedSubmissionRef.current = selectedSubmission.id
    const res = await api.gradeSubmission(selectedSubmission.id, { grade, feedback, base_submission_updated_at: selectedSubmission.updated_at })
    if (!res.error) {
      setFeedback('')
      await loadData()
      toast.success(`Submission graded ${grade}`)
    } else {
      toast.error(res.error)
      if (res.latestSubmissionId) {
        setSelectedSubmission((current) => current ? { ...current, latest_submission_id: res.latestSubmissionId } : current)
        setGridModalSubmission((current) => current ? { ...current, latest_submission_id: res.latestSubmissionId } : current)
      }
      gradedSubmissionRef.current = null
    }
    setGrading(false)
  }

  // Auto-advance to next ungraded submission after data reload
  useEffect(() => {
    if (gradedSubmissionRef.current === null || !data) return
    const justGradedId = gradedSubmissionRef.current
    gradedSubmissionRef.current = null

    const nextUngraded = filteredSubmissions.find(
      (s) => s.id !== justGradedId && s.grade === null && latestSubmissionIds.has(s.id)
    )
    if (nextUngraded) {
      selectSubmission(nextUngraded)
    } else {
      setSelectedSubmission(null)
    }
  }, [data])


  const counts = useMemo(() => {
    if (!data) return { ungraded: 0, redo: 0, all: 0 }
    return {
      ungraded: data.submissions.filter((s) => s.grade === null).length,
      redo: data.submissions.filter((s) => s.grade === 'R').length,
      all: data.submissions.length,
    }
  }, [data])

  const latestSubmissionIds = useMemo(() => {
    if (!data) return new Set<number>()
    const latest = new Map<string, number>()
    data.submissions.forEach((sub) => {
      const key = `${sub.user_id}:${sub.content_block_id}`
      if (!latest.has(key)) latest.set(key, sub.id)
    })
    return new Set(latest.values())
  }, [data])

  const filteredSubmissions = useMemo(() => {
    if (!data) return []
    let filtered = data.submissions

    if (selectedStudentId) {
      filtered = filtered.filter((s) => s.user_id === selectedStudentId)
    }

    if (viewMode === 'queue' || !selectedStudentId) {
      filtered = filtered.filter((sub) => {
        if (queueFilter === 'ungraded') return sub.grade === null
        if (queueFilter === 'redo') return sub.grade === 'R'
        return true
      })
    }

    return filtered.sort((a, b) => {
      const aLatest = latestSubmissionIds.has(a.id)
      const bLatest = latestSubmissionIds.has(b.id)
      if (aLatest !== bLatest) return aLatest ? -1 : 1
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })
  }, [data, queueFilter, selectedStudentId, viewMode, latestSubmissionIds])

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
    [data, selectedStudentId]
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

  const runnerConfigForSubmission = (submission: SubmissionItem) => {
    const language = detectLanguage(submission.filename, submission.language_hint)
    return normalizeCodeRunnerConfig(
      submission.submission_config,
      codeRunnerLanguageFromEditor(language) || 'ruby'
    )
  }

  const openGridCell = async (userId: number, exerciseId: number) => {
    const key = `${userId}:${exerciseId}`
    const sub = submissionLookup.get(key)
    if (!sub) return
    const request = ++detailGeneration.current
    const scope = scopeRef.current
    setGridError(null)
    setGridModalOpen(true)
    setGridModalSubmission(null)
    setGridModalTab('answer')
    setGithubIssueData(null)
    setGithubIssueError(null)
    try {
      const res = await api.getSubmission(sub.id)
      if (request !== detailGeneration.current || scopeRef.current !== scope) return
      if (!res.data || res.error || res.fromCache) { setGridError({ userId, exerciseId, message: res.error || 'Could not load submission details.' }); return }
      setGridModalSubmission(res.data.submission)
      setGridFeedback(res.data.submission.feedback || '')
    } catch (error) {
      if (request === detailGeneration.current && scopeRef.current === scope) setGridError({ userId, exerciseId, message: (error as Error).message })
    }
  }

  const loadGithubIssue = async () => {
    if (!gridModalSubmission || !gridModalSubmission.github_issue_url) return
    setLoadingGithubIssue(true)
    setGithubIssueError(null)
    try {
      const res = await api.getSubmissionGithubIssue(gridModalSubmission.id)
      if (res.data && !res.data.error) {
        setGithubIssueData(res.data)
      } else {
        const msg = res.data?.error || 'Failed to load GitHub issue'
        setGithubIssueError(msg)
        console.error('GitHub issue load failed:', msg)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network request failed'
      setGithubIssueError(msg)
      console.error('GitHub issue request failed:', err)
    } finally {
      setLoadingGithubIssue(false)
    }
  }

  const handleGridGrade = async (grade: string) => {
    if (!gridModalSubmission || isPreviousAttempt(gridModalSubmission)) return
    setGrading(true)
    const res = await api.gradeSubmission(gridModalSubmission.id, { grade, feedback: gridFeedback, base_submission_updated_at: gridModalSubmission.updated_at })
    if (!res.error) {
      setGridFeedback('')
      setGridModalSubmission(null)
      setGridModalOpen(false)
      await loadData()
      toast.success(`Submission graded ${grade}`)
    } else {
      toast.error(res.error)
      if (res.latestSubmissionId) {
        setSelectedSubmission((current) => current ? { ...current, latest_submission_id: res.latestSubmissionId } : current)
        setGridModalSubmission((current) => current ? { ...current, latest_submission_id: res.latestSubmissionId } : current)
      }
      gradedSubmissionRef.current = null
    }
    setGrading(false)
  }

  // Keyboard shortcuts for grading (works for both side panel and grid modal)
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (grading) return
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return

      const key = e.key.toUpperCase()
      if (!['A', 'B', 'C', 'R'].includes(key)) return

      if (gridModalSubmission) {
        e.preventDefault()
        if (key === 'R' && !gridFeedback.trim()) {
          if (!await confirmAction({ title: 'Grade as Redo without feedback?', description: 'The student will know they need to try again, but they will not know what to fix.', confirmLabel: 'Grade as Redo' })) return
        }
        handleGridGrade(key)
      } else if (selectedSubmission && !loadingDetail) {
        e.preventDefault()
        if (key === 'R' && !feedback.trim()) {
          if (!await confirmAction({ title: 'Grade as Redo without feedback?', description: 'The student will know they need to try again, but they will not know what to fix.', confirmLabel: 'Grade as Redo' })) return
        }
        handleGrade(key)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [selectedSubmission, gridModalSubmission, grading, loadingDetail, feedback, gridFeedback, handleGridGrade, handleGrade, confirmAction])

  if (loading && !data) return <LoadingSpinner message="Loading grading data..." />
  if (!data) return <div className="app-page-wide"><LoadError error={loadError || 'Grading data unavailable.'} retry={() => void loadData()} /></div>

  const githubSyncClosed = data.supports_github_sync && (data.open_github_sync_count ?? 0) === 0

  return (
    <div className="app-page-wide">
      {loadError && <LoadError error={loadError} stale retry={() => void loadData()} />}
      <Button variant="secondary" disabled={loading} onClick={() => void loadData()}>{loading ? 'Refreshing…' : 'Refresh grading'}</Button>
      {detailError && <LoadError error={detailError.message} retry={() => void selectSubmission(detailError.submission)} />}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <Button variant="quiet" size="sm" onClick={() => navigate(-1)} className="mb-2">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <p className="app-eyebrow">Focused grading</p>
          <h1 className="app-title mt-2">
            {data.module_name} — Grading
          </h1>
          <p className="mt-1 text-sm tabular-nums text-ink-muted">
            {data.cohort_name} · {data.students.length} student{data.students.length !== 1 ? 's' : ''}
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
            {githubSyncClosed ? 'GitHub sync closed' : syncing ? 'Syncing...' : 'Sync all from GitHub'}
          </Button>
        )}
      </div>

      {message && (
        <div role="status" className={`rounded-xl border px-4 py-3 text-sm ${message.startsWith('Sync failed') ? 'border-danger-200 bg-danger-50 text-danger-700' : 'border-line bg-surface-sunken text-ink-secondary'}`}>
          {message}
        </div>
      )}

      {/* Queue filters */}
      <div role="group" aria-label="Submission queue" className="flex flex-wrap gap-2">
        <FilterChip
          selected={viewMode === 'queue' && queueFilter === 'ungraded'}
          count={counts.ungraded}
          onClick={() => {
            setViewMode('queue'); setQueueFilter('ungraded'); setSelectedStudentId(null)
            const firstUngraded = data.submissions.find((s) => s.grade === null && latestSubmissionIds.has(s.id))
            if (firstUngraded) selectSubmission(firstUngraded); else setSelectedSubmission(null)
          }}
        >
          <Filter className="h-4 w-4" aria-hidden="true" />
          Ungraded queue
        </FilterChip>
        <FilterChip
          selected={viewMode === 'queue' && queueFilter === 'redo'}
          count={counts.redo}
          onClick={() => { setViewMode('queue'); setQueueFilter('redo'); setSelectedStudentId(null); setSelectedSubmission(null) }}
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Redo requested
        </FilterChip>
        <FilterChip
          selected={viewMode === 'queue' && queueFilter === 'all'}
          count={counts.all}
          onClick={() => { setViewMode('queue'); setQueueFilter('all'); setSelectedStudentId(null); setSelectedSubmission(null) }}
        >
          <Clock className="h-4 w-4" aria-hidden="true" />
          All submissions
        </FilterChip>
      </div>

      {/* View toggle */}
      <SegmentedControl label="Grading view" className="w-fit">
        <SegmentButton
          selected={viewMode === 'grid'}
          onClick={() => { setViewMode('grid'); setSelectedStudentId(null); setSelectedSubmission(null) }}
        >
          Grid
        </SegmentButton>
        <SegmentButton
          selected={viewMode === 'students'}
          onClick={() => { setViewMode('students'); setSelectedStudentId(null); setSelectedSubmission(null) }}
        >
          By student
        </SegmentButton>
        <SegmentButton
          selected={viewMode === 'queue'}
          onClick={() => { setViewMode('queue'); setSelectedStudentId(null); setSelectedSubmission(null) }}
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
                <span aria-hidden="true" className={`inline-flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold ${CELL_TONES.pending}`}>+</span>
                Awaiting review
              </span>
              <span className="flex items-center gap-1.5">
                <span aria-hidden="true" className={`inline-flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold ${CELL_TONES.success}`}>A</span>
                Completed / passing
              </span>
              <span className="flex items-center gap-1.5">
                <span aria-hidden="true" className={`inline-flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold ${CELL_TONES.warning}`}>R</span>
                Redo
              </span>
              <span className="flex items-center gap-1.5">
                <span aria-hidden="true" className={`inline-flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold ${CELL_TONES.progress}`}>&bull;</span>
                In progress
              </span>
              <span className="flex items-center gap-1.5">
                <span aria-hidden="true" className={`inline-flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold ${CELL_TONES.empty}`}>&mdash;</span>
                Not submitted
              </span>
            </div>
          </div>

          {weekGroups.map(([week, exercises]) => {
            const pending = exercises.reduce((acc, ex) => acc + data.students.filter((s) => {
              const sub = submissionLookup.get(`${s.user_id}:${ex.id}`)
              return sub && sub.grade === null
            }).length, 0)
            const redos = exercises.reduce((acc, ex) => acc + data.students.filter((s) => {
              const sub = submissionLookup.get(`${s.user_id}:${ex.id}`)
              return sub && sub.grade === 'R'
            }).length, 0)
            const completed = exercises.reduce((acc, ex) => acc + data.students.filter((s) => {
              const sub = submissionLookup.get(`${s.user_id}:${ex.id}`)
              const progress = progressLookup.get(`${s.user_id}:${ex.id}`)
              return (sub && sub.grade && sub.grade !== 'R') || (!ex.requires_submission && progress?.status === 'completed')
            }).length, 0)

            return (
              <div key={week} className="app-surface overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
                  <h3 id={`${weekHeadingIdBase}-week-${week}`} className="text-base font-semibold text-ink">Week {week}</h3>
                  <div className="flex flex-wrap items-center gap-2">
                    {pending > 0 && <Badge tone="pending" className="tabular-nums">{pending} pending</Badge>}
                    {redos > 0 && <Badge tone="warning" className="tabular-nums">{redos} redo</Badge>}
                    {completed > 0 && <Badge tone="success" className="tabular-nums">{completed} completed</Badge>}
                  </div>
                </div>
                {/* Scrolls inside its own box on desktop so the header row and student column stay pinned. */}
                <div className="overflow-x-auto lg:max-h-[70vh] lg:overflow-y-auto">
                  <table aria-labelledby={`${weekHeadingIdBase}-week-${week}`} className="w-full border-separate border-spacing-0 text-sm">
                    <thead>
                      <tr>
                        <th scope="col" className="sticky left-0 top-0 z-30 min-w-[110px] border-b border-line bg-surface-sunken px-4 py-2 text-left text-xs font-semibold text-ink-muted">Student</th>
                        {exercises.map((ex, index) => (
                          <th key={ex.id} scope="col" className="sticky top-0 z-20 min-w-12 border-b border-line bg-surface-sunken px-0.5 py-2 text-center" title={ex.title || ex.lesson_title}>
                            <span className="text-xs font-semibold text-ink-muted">{exerciseDisplayLabel(ex, index)}</span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.students.map((student) => (
                        <tr key={student.user_id} className="group">
                          <th scope="row" title={student.full_name || student.email} className="sticky left-0 z-10 whitespace-nowrap border-b border-line bg-surface-raised px-4 py-1 text-left text-xs font-semibold text-ink-secondary transition-colors duration-150 group-hover:bg-surface-sunken">
                            {(() => {
                              const name = student.full_name || student.email
                              const parts = name.split(' ')
                              if (parts.length >= 2) return `${parts[0]} ${parts[parts.length - 1][0]}.`
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
                              <td key={ex.id} className="border-b border-line px-0.5 py-1 text-center transition-colors duration-150 group-hover:bg-surface-sunken">
                                <button
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

          {/* Grid grading modal */}
          <Modal
            open={gridModalOpen}
            onClose={() => { setGridModalOpen(false); setGridModalSubmission(null); setGridFeedback(''); setGithubIssueData(null); setGithubIssueError(null) }}
            title={gridModalSubmission ? gridModalSubmission.content_block_title : 'Loading...'}
            subtitle={gridModalSubmission ? `Student: ${gridModalSubmission.user_name}  |  File: ${gridModalSubmission.filename || 'N/A'}  |  Submission #${gridModalSubmission.num_submissions}` : ''}
            size="xl"
            fixedHeight
            footer={gridModalSubmission ? (
              <AttemptReview submission={gridModalSubmission} navigationContext={{ cohortId: Number(cohortId), userId: gridModalSubmission.user_id, returnTo: `${location.pathname}${location.search}` }}>
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <textarea
                    value={gridFeedback}
                    onChange={(e) => setGridFeedback(e.target.value)}
                    aria-label="Feedback for the student"
                    placeholder="Leave feedback for the student... (visible on their end)"
                    rows={3}
                    className="app-control min-h-[72px] min-w-0 flex-1 resize-y"
                  />
                  {gridModalSubmission.grade && (
                    <div className="flex max-w-24 shrink-0 flex-col items-center gap-1 pt-1">
                      <span className="text-xs font-semibold text-ink-muted">Current</span>
                      <GradeDisplay grade={gridModalSubmission.grade} size="sm" />
                      {gridModalSubmission.graded_by && (
                        <span className="max-w-full truncate text-xs text-ink-muted" title={gridModalSubmission.graded_by}>{gridModalSubmission.graded_by}</span>
                      )}
                    </div>
                  )}
                </div>
                <FeedbackFormattingHint value={gridFeedback} />
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {['A', 'B', 'C'].map((g) => (
                    <Button
                      key={g}
                      variant={g === 'A' ? 'primary' : 'secondary'}
                      onClick={() => handleGridGrade(g)}
                      disabled={grading}
                    >
                      {g}
                    </Button>
                  ))}
                  <Button
                    variant="secondary"
                    className={REDO_BUTTON_CLASSES}
                    onClick={async () => {
                      if (!gridFeedback.trim()) {
                        if (!await confirmAction({ title: 'Grade as Redo without feedback?', description: 'The student will know they need to try again, but they will not know what to fix.', confirmLabel: 'Grade as Redo' })) return
                      }
                      handleGridGrade('R')
                    }}
                    disabled={grading}
                  >
                    <RotateCcw className="h-4 w-4" />
                    Redo
                  </Button>
                </div>
              </div>
              </AttemptReview>
            ) : undefined}
          >
            {gridError ? <LoadError error={gridError.message} retry={() => void openGridCell(gridError.userId, gridError.exerciseId)} /> : !gridModalSubmission ? (
              <LoadingSpinner message="Loading submission..." />
            ) : (
              <div className="flex flex-col h-full">
                {/* Tabs */}
                <div role="tablist" aria-label="Submission details" className="-mx-6 flex shrink-0 items-center overflow-x-auto border-b border-line px-6">
                  {([
                    { key: 'exercise' as const, label: 'Exercise' },
                    { key: 'answer' as const, label: `${gridModalSubmission.user_name.split(' ')[0]}'s Answer` },
                    { key: 'solution' as const, label: 'Solution' },
                    { key: 'feedback' as const, label: 'Feedback' },
                    ...(gridModalSubmission.github_issue_url ? [{ key: 'github_issue' as const, label: 'GitHub Issue' }] : []),
                  ]).map((tab) => (
                    <TabButton
                      key={tab.key}
                      asTab
                      selected={gridModalTab === tab.key}
                      onClick={() => setGridModalTab(tab.key)}
                    >
                      {tab.label}
                    </TabButton>
                  ))}
                </div>

                {/* Tab content */}
                <div className="flex-1 overflow-y-auto pt-4 -mx-6 px-6 flex flex-col min-h-0">
                  {gridModalTab === 'exercise' && (
                    <div>
                      {gridModalSubmission.exercise_body ? (
                        <MarkdownRenderer content={gridModalSubmission.exercise_body} />
                      ) : (
                        <p className="text-sm italic text-ink-muted">No exercise instructions available</p>
                      )}
                    </div>
                  )}

                  {gridModalTab === 'answer' && (
                    <div className="flex flex-col flex-1 min-h-0">
                      <div className="mb-3 shrink-0">
                        {renderSubmissionArtifacts(gridModalSubmission)}
                      </div>
                      {gridModalSubmission.text ? (
                        <div className="space-y-3">
                          {(() => {
                            const language = detectLanguage(gridModalSubmission.filename, gridModalSubmission.language_hint)
                            const runnerConfig = runnerConfigForSubmission(gridModalSubmission)
                            return (
                              <>
                                <CodeEditor
                                  value={gridModalSubmission.text}
                                  language={language}
                                  readOnly
                                  height="360px"
                                  minHeight={260}
                                />
                                {runnerConfig.enabled && (
                                  <CodeRunner
                                    code={gridModalSubmission.text}
                                    language={runnerConfig.language}
                                    timeoutMs={CODE_RUNNER_TIMEOUT_MS}
                                  />
                                )}
                              </>
                            )
                          })()}
                        </div>
                      ) : (
                        <p className="text-sm italic text-ink-muted">No inline code submitted. Use the links above to review the artifact.</p>
                      )}
                    </div>
                  )}

                  {gridModalTab === 'solution' && (
                    <div className="flex flex-col min-h-0">
                      {gridModalSubmission.solution ? (
                        <div>
                          <CodeEditor
                            value={gridModalSubmission.solution}
                            language={detectLanguage(gridModalSubmission.filename, gridModalSubmission.language_hint)}
                            readOnly
                            height="360px"
                            minHeight={260}
                          />
                        </div>
                      ) : (
                        <p className="text-sm italic text-ink-muted">No solution available</p>
                      )}
                    </div>
                  )}

                  {gridModalTab === 'feedback' && (
                    <div className="space-y-4">
                      {gridModalSubmission.grade ? (
                        <div className={`rounded-xl border p-4 ${gridModalSubmission.grade === 'R' ? 'border-warning-200 bg-warning-50' : 'border-success-200 bg-success-50'}`}>
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            <GradeDisplay grade={gridModalSubmission.grade} size="sm" />
                            <span className="text-sm font-semibold text-ink-secondary">
                              Graded by {gridModalSubmission.graded_by || 'Unknown'}
                            </span>
                            {gridModalSubmission.graded_at && (
                              <span className="text-xs tabular-nums text-ink-muted">
                                {formatShortDateTime(gridModalSubmission.graded_at)}
                              </span>
                            )}
                          </div>
                          {gridModalSubmission.feedback ? (
                            <FeedbackBody feedback={gridModalSubmission.feedback} />
                          ) : (
                            <p className="text-sm italic text-ink-muted">No written feedback yet — add feedback below when grading</p>
                          )}
                        </div>
                      ) : (
                        <div className="rounded-xl border border-line bg-surface-sunken p-4 text-center">
                          <p className="text-sm text-ink-secondary">Not yet graded</p>
                          <p className="mt-1 text-xs text-ink-muted">Use the grade buttons below to grade this submission</p>
                        </div>
                      )}

                      {(gridModalSubmission.github_code_url || gridModalSubmission.github_issue_url) && (
                        <div className="space-y-1 rounded-xl border border-line p-4">
                          <p className="text-xs font-semibold text-ink-muted">GitHub links</p>
                          {gridModalSubmission.github_code_url && (
                            <a
                              href={sanitizeUrl(gridModalSubmission.github_code_url)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="app-link flex min-h-11 w-fit items-center gap-1.5 text-sm lg:min-h-9"
                            >
                              <Github className="h-4 w-4 shrink-0" />
                              View student code on GitHub
                            </a>
                          )}
                          {gridModalSubmission.github_issue_url && (
                            <a
                              href={sanitizeUrl(gridModalSubmission.github_issue_url)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="app-link flex min-h-11 w-fit items-center gap-1.5 text-sm lg:min-h-9"
                            >
                              <Github className="h-4 w-4 shrink-0" />
                              View issue thread (instructor comments)
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {gridModalTab === 'github_issue' && gridModalSubmission.github_issue_url && (
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center gap-3">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={loadGithubIssue}
                          disabled={loadingGithubIssue}
                        >
                          {loadingGithubIssue ? (
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Github className="h-3.5 w-3.5" />
                          )}
                          {githubIssueData ? 'Refresh issue' : 'Load GitHub issue'}
                        </Button>
                        <a
                          href={sanitizeUrl(gridModalSubmission.github_issue_url)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="app-link inline-flex min-h-11 items-center text-sm lg:min-h-9"
                        >
                          See issue on GitHub
                        </a>
                      </div>

                      {githubIssueData && (
                        <div className="space-y-4">
                          <div className="overflow-hidden rounded-xl border border-line">
                            <div className="border-b border-line bg-surface-sunken px-4 py-3">
                              <div className="flex min-w-0 items-center gap-2">
                                <h4 className="min-w-0 truncate text-sm font-semibold text-ink" title={githubIssueData.title}>{githubIssueData.title}</h4>
                                <Badge tone={githubIssueData.state === 'open' ? 'success' : 'neutral'}>{githubIssueData.state === 'open' ? 'Open' : githubIssueData.state === 'closed' ? 'Closed' : githubIssueData.state}</Badge>
                              </div>
                            </div>
                            <div className="p-4">
                              <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-surface-sunken p-3 font-mono text-sm text-ink-secondary">{githubIssueData.body}</pre>
                            </div>
                          </div>

                          {githubIssueData.comments.length > 0 && (
                            <div className="space-y-3">
                              <p className="text-xs font-semibold tabular-nums text-ink-muted">
                                Comments ({githubIssueData.comments.length})
                              </p>
                              {githubIssueData.comments.map((comment) => (
                                <div key={comment.id} className="overflow-hidden rounded-xl border border-line">
                                  <div className="flex items-center justify-between gap-3 border-b border-line bg-surface-sunken px-4 py-2">
                                    <span className="min-w-0 truncate text-sm font-semibold text-ink-secondary" title={comment.user}>{comment.user}</span>
                                    <span className="shrink-0 text-xs tabular-nums text-ink-muted">{formatShortDateTime(comment.created_at)}</span>
                                  </div>
                                  <div className="p-4">
                                    <div className="whitespace-pre-wrap text-sm text-ink-secondary">{comment.body}</div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {githubIssueError && (
                        <div role="alert" className="rounded-xl border border-danger-200 bg-danger-50 p-4 text-center">
                          <p className="text-sm font-semibold text-danger-700">Failed to load GitHub issue</p>
                          <p className="mt-1 text-xs text-danger-700">{githubIssueError}</p>
                        </div>
                      )}

                      {!githubIssueData && !loadingGithubIssue && !githubIssueError && (
                        <div className="rounded-xl border border-line bg-surface-sunken p-6 text-center">
                          <Github className="mx-auto mb-2 h-8 w-8 text-ink-muted" />
                          <p className="text-sm text-ink-muted">Click "Load GitHub issue" to fetch the issue details and comments</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </Modal>
        </>
      )}

      {viewMode !== 'grid' && <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left panel: student list or submission queue */}
        <div className="min-w-0 space-y-2 lg:col-span-2">
          {viewMode === 'students' && !selectedStudentId ? (
            /* Student list */
            data.students.length === 0 ? (
              <EmptyState icon={User} title="No students" description="No active students in this cohort." />
            ) : (
              data.students.map((student) => (
                <button
                  key={student.user_id}
                  type="button"
                  onClick={() => { setSelectedStudentId(student.user_id); setSelectedSubmission(null) }}
                  className="pressable min-h-11 w-full rounded-2xl border border-line bg-surface-raised p-3 text-left hover:bg-surface-sunken sm:p-4"
                >
                  <div className="flex items-start gap-3">
                    <Avatar name={student.full_name || student.email} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink" title={student.full_name || student.email}>{student.full_name || student.email}</p>
                      {student.github_username && (
                        <div className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-ink-muted">
                          <Github className="h-3 w-3 shrink-0" />
                          <span className="truncate">{student.github_username}</span>
                        </div>
                      )}
                      {(student.ungraded > 0 || student.redo > 0) && (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {student.ungraded > 0 && <Badge tone="pending" className="tabular-nums">{student.ungraded} ungraded</Badge>}
                          {student.redo > 0 && <Badge tone="warning" className="tabular-nums">{student.redo} redo</Badge>}
                        </div>
                      )}
                    </div>
                    <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
                  </div>
                  <div className="mt-3 flex items-center gap-4 text-xs tabular-nums text-ink-muted">
                    <span>{student.submitted}/{student.total_exercises} submitted</span>
                    <span>{student.graded} graded</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-success-500"
                      style={{ width: `${student.total_exercises > 0 ? (student.graded / student.total_exercises) * 100 : 0}%` }}
                    />
                  </div>
                </button>
              ))
            )
          ) : (
            /* Submission list (queue or per-student) */
            <>
              {selectedStudentId && (
                <Button variant="quiet" size="sm" onClick={() => { setSelectedStudentId(null); setSelectedSubmission(null) }}>
                  <ArrowLeft className="h-4 w-4" />
                  Back to student list
                </Button>
              )}

              {selectedStudentId && data.supports_github_sync && (() => {
                if (!selectedStudent?.github_username) return null
                return (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleSyncStudent(selectedStudentId)}
                    disabled={githubSyncClosed || syncingStudentId === selectedStudentId}
                    title={githubSyncClosed ? 'All GitHub-sync submission windows are closed' : undefined}
                    className="max-w-full"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 shrink-0 ${syncingStudentId === selectedStudentId ? 'animate-spin' : ''}`} />
                    <span className="truncate">{githubSyncClosed ? 'GitHub sync closed' : syncingStudentId === selectedStudentId ? 'Syncing...' : `Sync ${selectedStudent.full_name || selectedStudent.email}`}</span>
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
                    const isSelected = Boolean(submission) && selectedSubmission?.id === submission?.id
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
                            <p className="truncate text-sm font-semibold text-ink" title={exercise.title || exercise.lesson_title}>{exercise.title || exercise.lesson_title}</p>
                            <p className="mt-1 truncate text-xs text-ink-secondary" title={exercise.lesson_title}>{exercise.lesson_title}</p>
                            <p className="mt-0.5 break-words text-xs text-ink-muted">
                              {exercise.filename?.trim()
                                ? `File: ${exercise.filename}`
                                : requiresSubmission
                                  ? 'Submission required'
                                  : 'Practice block — no submission required'}
                            </p>
                            {submission && (
                              <p className="mt-0.5 text-xs tabular-nums text-ink-muted">
                                Attempt {submission.num_submissions} · {formatShortDateTime(submission.created_at)}
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
                            {clickable && <ChevronRight className="hidden h-4 w-4 text-ink-muted sm:block" aria-hidden="true" />}
                          </div>
                        </div>
                      </button>
                    )
                  })
                )
              ) : filteredSubmissions.length === 0 ? (
                <EmptyState
                  icon={Check}
                  title={selectedStudentId ? 'No submissions yet' : queueFilter === 'ungraded' ? 'All caught up!' : queueFilter === 'redo' ? 'No redo queue' : 'No submissions'}
                  description={selectedStudentId ? 'This student hasn\'t submitted any work yet.' : queueFilter === 'ungraded' ? 'No ungraded submissions.' : queueFilter === 'redo' ? 'No redo-requested submissions.' : 'No submissions yet.'}
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
                        isSelected ? 'nav-selected border-line-strong' : 'border-line bg-surface-raised hover:bg-surface-sunken'
                      }`}
                    >
                      {!selectedStudentId && <Avatar name={sub.user_name} size="sm" />}
                      <div className="min-w-0 flex-1">
                        {!selectedStudentId && (
                          <p className="truncate text-sm font-semibold text-ink" title={sub.user_name}>{sub.user_name}</p>
                        )}
                        <p className={`truncate ${selectedStudentId ? 'text-sm font-semibold text-ink' : 'mt-0.5 text-xs text-ink-secondary'}`} title={where}>{where}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                          <SubmissionStatus grade={sub.grade} />
                          <Badge tone={isLatest ? 'info' : 'neutral'}>{isLatest ? 'Latest' : 'Previous'}</Badge>
                          <span className="text-xs tabular-nums text-ink-muted">Attempt {sub.num_submissions} · {formatShortDateTime(sub.created_at)}</span>
                        </div>
                      </div>
                      <ChevronRight className="mt-2 hidden h-4 w-4 shrink-0 text-ink-muted sm:block" aria-hidden="true" />
                    </button>
                  )
                })
              )}
            </>
          )}
        </div>

        {/* Right panel: grading detail */}
        <div className="min-w-0 lg:col-span-3">
          {selectedSubmission ? (
            <div className="app-surface space-y-4 p-4 sm:p-6 lg:sticky lg:top-4">
              {loadingDetail ? (
                <LoadingSpinner message="Loading submission..." />
              ) : (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <Avatar name={selectedSubmission.user_name} size="md" />
                      <div className="min-w-0">
                        <Link to={cohortStudentPath(Number(cohortId), selectedSubmission.user_id, 'work')} className="app-link block truncate text-lg" title={selectedSubmission.user_name}>{selectedSubmission.user_name}</Link>
                        <p className="truncate text-sm text-ink-secondary" title={selectedSubmission.lesson_title}>{selectedSubmission.lesson_title}</p>
                        <p className="text-xs tabular-nums text-ink-muted">
                          {selectedSubmission.content_block_title} · Attempt {selectedSubmission.num_submissions}
                        </p>
                        <Link to={submissionPath(selectedSubmission.id, { cohortId: Number(cohortId), userId: selectedSubmission.user_id, returnTo: `${location.pathname}${location.search}` })} className="app-link mt-1 inline-flex min-h-11 items-center gap-1 text-xs"><ExternalLink className="h-3.5 w-3.5" />Open submission record</Link>
                      </div>
                    </div>
                    {selectedSubmission.grade ? <GradeDisplay grade={selectedSubmission.grade} size="md" /> : <StatusBadge status="awaiting_review" short />}
                  </div>

                  {renderSubmissionArtifacts(selectedSubmission)}

                  {selectedSubmission.grade === 'R' && selectedSubmission.feedback && (
                    <div className="rounded-xl border border-warning-200 bg-warning-50 p-3 text-warning-800">
                      <p className="text-xs font-semibold">Current redo feedback</p>
                      <FeedbackBody feedback={selectedSubmission.feedback} className="mt-1" />
                    </div>
                  )}

                  <div>
                    <h4 className="mb-2 text-sm font-semibold text-ink">Student submission</h4>
                    {selectedSubmission.text ? (
                      <div className="space-y-3">
                        {(() => {
                          const language = detectLanguage(selectedSubmission.filename, selectedSubmission.language_hint)
                          const runnerConfig = runnerConfigForSubmission(selectedSubmission)
                          return (
                            <>
                              <CodeEditor
                                value={selectedSubmission.text}
                                language={language}
                                readOnly
                                minHeight={220}
                              />
                              {runnerConfig.enabled && (
                                <CodeRunner
                                  code={selectedSubmission.text}
                                  language={runnerConfig.language}
                                  timeoutMs={CODE_RUNNER_TIMEOUT_MS}
                                />
                              )}
                            </>
                          )
                        })()}
                      </div>
                    ) : (
                      <p className="text-sm italic text-ink-muted">No inline code submitted. Review the links and notes above.</p>
                    )}
                  </div>

                  {selectedSubmission.solution && (
                    <details className="group">
                      <summary className="flex min-h-11 cursor-pointer select-none items-center text-sm font-semibold text-ink-secondary hover:text-ink">
                        Show solution
                      </summary>
                      <div className="mt-2">
                        <CodeEditor
                          value={selectedSubmission.solution}
                          language={detectLanguage(selectedSubmission.filename, selectedSubmission.language_hint)}
                          readOnly
                          minHeight={180}
                        />
                      </div>
                    </details>
                  )}

                  <AttemptReview submission={selectedSubmission} navigationContext={{ cohortId: Number(cohortId), userId: selectedSubmission.user_id, returnTo: `${location.pathname}${location.search}` }}>
                  <div>
                    <label htmlFor="module-grading-feedback" className="text-sm font-semibold text-ink">Feedback</label>
                    <textarea
                      id="module-grading-feedback"
                      value={feedback}
                      onChange={(e) => setFeedback(e.target.value)}
                      placeholder="Feedback for the student..."
                      className="app-control mt-1 min-h-[100px] w-full resize-y"
                    />
                    <FeedbackFormattingHint value={feedback} />
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {['A', 'B', 'C'].map((grade) => (
                      <Button
                        key={grade}
                        variant={grade === 'A' ? 'primary' : 'secondary'}
                        onClick={() => handleGrade(grade)}
                        disabled={grading}
                      >
                        {grade}
                      </Button>
                    ))}
                    <Button
                      variant="secondary"
                      className={REDO_BUTTON_CLASSES}
                      onClick={async () => {
                        if (!feedback.trim()) {
                          if (!await confirmAction({ title: 'Grade as Redo without feedback?', description: 'The student will know they need to try again, but they will not know what to fix.', confirmLabel: 'Grade as Redo' })) return
                        }
                        handleGrade('R')
                      }}
                      disabled={grading}
                    >
                      <RotateCcw className="h-4 w-4" />
                      Redo
                    </Button>
                  </div>

                  </AttemptReview>
                  <div className="hidden flex-wrap items-center gap-2 pt-1 text-xs text-ink-muted lg:flex">
                    <Keyboard className="h-3.5 w-3.5" />
                    Press <kbd className="rounded border border-line bg-surface-sunken px-1.5 py-0.5 font-mono text-xs">A</kbd>
                    <kbd className="rounded border border-line bg-surface-sunken px-1.5 py-0.5 font-mono text-xs">B</kbd>
                    <kbd className="rounded border border-line bg-surface-sunken px-1.5 py-0.5 font-mono text-xs">C</kbd>
                    <kbd className="rounded border border-line bg-surface-sunken px-1.5 py-0.5 font-mono text-xs">R</kbd>
                    to grade &middot; auto-advances to next
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="hidden min-h-[400px] items-center justify-center rounded-2xl border border-dashed border-line bg-surface-sunken p-6 lg:flex">
              <div className="text-center">
                <Check className="mx-auto mb-3 h-10 w-10 text-ink-muted" />
                <p className="text-sm text-ink-secondary">
                  {viewMode === 'students' && selectedStudentId ? 'Select a submission to review' : 'Select a submission to start grading'}
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
      </div>}
    </div>
  )
}
