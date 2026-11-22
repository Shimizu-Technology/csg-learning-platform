import { NoAccess } from '../shared/NoAccess'
import { Link, useNavigate } from 'react-router-dom'
import { useEffect, useId, useImperativeHandle, useRef, useState, type Ref } from 'react'
import {
  AlertTriangle,
  BookmarkPlus,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock,
  ExternalLink,
  Info,
  MessageSquareText,
  RefreshCw,
  RotateCcw,
} from 'lucide-react'
import { api } from '../../lib/api'
import { trimBlankLines } from '../../lib/messageFormat'
import { submissionPath } from '../../lib/routes'
import { appendFeedbackSnippet } from '../../lib/feedbackSnippets'
import {
  CODE_RUNNER_TIMEOUT_MS,
  codeRunnerLanguageFromEditor,
  normalizeCodeRunnerConfig,
} from '../../lib/codeRunner'
import { formatShortDateTime } from '../../lib/format'
import { gradeLabel, humanize } from '../../lib/glossary'
import { sanitizeUrl } from '../../lib/sanitizeUrl'
import type { FeedbackSnippet, RubricRating, Submission } from '../../types/api'
import { Button } from '../ui/Button'
import { Badge, type BadgeTone } from '../ui/Badge'
import { SegmentButton } from '../ui/Choice'
import { detectLanguage } from '../shared/CodeEditor'
import { namedLanguage } from '../../lib/codeLanguage'
import { CodeRunner } from '../shared/CodeRunner'
import { CodeBlock } from '../shared/CodeBlock'
import { MarkdownRenderer } from '../shared/MarkdownRenderer'
import { FeedbackBody } from '../shared/FeedbackBody'
import { MarkdownEditor, type MarkdownEditorHandle } from '../shared/MarkdownEditor'
import { GradeDisplay } from '../shared/GradeDisplay'
import { LoadError } from '../shared/LoadError'
import { LoadingSpinner } from '../shared/LoadingSpinner'
import { AttemptReview, isPreviousAttempt } from '../shared/AttemptReview'
import { REDO_BUTTON_CLASSES } from '../shared/SubmissionStatus'
import { SubmissionText } from './SubmissionText'
import { useSubmissionReview } from './useSubmissionReview'
import { REDO_NEEDS_FEEDBACK, isBlankFeedback, submissionWhereLabel } from '../../lib/submissionQueue'
import {
  canSelectSuggestedB,
  extractSuggestionChecks,
  gradeDiffersFromSuggestion,
  gradeSuggestionDecisionBadge,
  gradeSuggestionHeadline,
  gradeSuggestionSignalLabel,
  isGradeSuggestionStale,
  type GradeChoice,
} from '../../lib/gradeSuggestion'
import { leavesPath, leavesPathOrParam, useGuardedLinkClick } from '../../lib/useLeaveGuard'
import { RecordLink } from '../shared/RecordLink'
import { useFreshKeyGate } from '../../lib/heldKeys'

export interface SubmissionReviewHandle {
  confirmLeave: () => Promise<boolean>
  /** After a confirmed leave that failed to happen: ask again next time. */
  keepGuarding: () => void
}
interface Props {
  submissionId: number
  ref?: Ref<SubmissionReviewHandle>
  navigationContext: Parameters<typeof submissionPath>[1]
  previousId?: number | null
  nextId?: number | null
  position?: string
  showRecordLink?: boolean
  /** False on the submission record page, where RecordHeader shows the learner, lesson, attempt and queue. */
  showHeader?: boolean
  active?: boolean
  onNavigate?: (id: number) => void
  onSaved?: (submission: Submission) => void
  onLoaded?: (submission: Submission) => void
  onReturn?: () => void
  returnLabel?: string
  /** The query parameter that selects this inline review (`submission`, `review`); changing it replaces the review. */
  selectionParam?: string
  /**
   * Where the pinned grade bar stops: `shell` sits above the phone tab bar (pages in the app
   * shell); `none` sits at the bottom of its own scroll box (a dialog).
   */
  footerOffset?: 'shell' | 'none'
  /** Show the exercise instructions open (the Grading workbench's Task). */
  taskOpen?: boolean
}
/** GitHub check-run status and conclusion values as people read them. */
const CHECK_RUN_LABELS: Record<string, string> = {
  queued: 'Queued',
  in_progress: 'Running',
  completed: 'Finished',
  waiting: 'Waiting',
  requested: 'Requested',
  pending: 'Pending',
  success: 'Passed',
  failure: 'Failed',
  neutral: 'Neutral',
  cancelled: 'Canceled',
  skipped: 'Skipped',
  timed_out: 'Timed out',
  action_required: 'Action needed',
  startup_failure: 'Could not start',
  stale: 'Out of date',
}

const RATINGS: [RubricRating, string][] = [
  ['exceeds', 'Exceeds'],
  ['meets', 'Meets'],
  ['developing', 'Developing'],
  ['redo', 'Revision'],
]

/** All entry points render this panel; discovery pages own only selection and return context. */
export function SubmissionReviewPanel({
  submissionId,
  ref,
  navigationContext,
  previousId,
  nextId,
  position,
  showRecordLink = true,
  showHeader = true,
  active = true,
  onNavigate,
  onSaved,
  onLoaded,
  onReturn,
  returnLabel = 'Back to list',
  selectionParam,
  footerOffset = 'shell',
  taskOpen = false,
}: Props) {
  const navigate = useNavigate()
  const review = useSubmissionReview(submissionId, onSaved, selectionParam ? leavesPathOrParam(selectionParam) : leavesPath)
  // Record links in the header leave the review, so a plain click asks about unsaved feedback first.
  const guardLeave = useGuardedLinkClick(() => review.confirmLeave())
  const { submission, feedback, criteria, selectedGrade, overrideReason, loading, grading, error, conflict } = review
  // A held grade or step key opens the next review; its auto-repeats must not grade that one too.
  const freshKey = useFreshKeyGate(submissionId)
  const feedbackId = useId()
  const overrideNoteId = useId()
  const panelElement = useRef<HTMLElement>(null)
  const gradeControls = useRef<HTMLDivElement>(null)
  const feedbackEditor = useRef<MarkdownEditorHandle>(null)
  // On phones the feedback box opens on demand; a Redo without feedback opens it.
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const feedbackShown = feedbackOpen || error === REDO_NEEDS_FEEDBACK
  // The grade bar is pinned in view; in a short host it may still sit below, so a failed grade shows it.
  useEffect(() => {
    if (error) gradeControls.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [error])
  async function gradeWith(value: GradeChoice) {
    const overriding = gradeDiffersFromSuggestion(submission?.grade_suggestion, value)
    const result = await review.grade(
      value,
      overriding && overrideReason.trim()
        ? { suggestionOverrideReason: overrideReason }
        : undefined,
    )
    if (result !== 'needs_feedback') return
    setFeedbackOpen(true)
    requestAnimationFrame(() => {
      feedbackEditor.current?.focus()
      // The bar grew; on a short phone screen bring all of it (message and grades) into view.
      gradeControls.current?.scrollIntoView?.({ block: 'nearest' })
    })
  }
  function selectGradeChoice(value: GradeChoice, revealGradeBar = false) {
    review.setSelectedGrade(value)
    review.setError((current) => (current === REDO_NEEDS_FEEDBACK && value !== 'R' ? null : current))
    if (value === 'R' && isBlankFeedback(feedback)) {
      setFeedbackOpen(true)
    }
    if (revealGradeBar) {
      requestAnimationFrame(() => {
        gradeControls.current?.scrollIntoView?.({ block: 'nearest' })
      })
    }
  }
  const focused = useRef(false)
  useEffect(() => {
    if (!submission || loading || !active || focused.current) return
    const dialog = Array.from(document.querySelectorAll('[data-app-modal]')).at(-1)
    if (dialog && !dialog.contains(panelElement.current)) return
    focused.current = true
    panelElement.current?.focus({ preventScroll: true })
  }, [submission, loading, active])
  const alive = useRef(true)
  const [snippets, setSnippets] = useState<FeedbackSnippet[]>([])
  const [savingSnippet, setSavingSnippet] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [issue, setIssue] = useState<{
    title: string
    body: string
    state: 'open' | 'closed'
    comments: { id: number; user: string; body: string; created_at: string }[]
  } | null>(null)
  const [issueError, setIssueError] = useState<string | null>(null)
  const [loadingIssue, setLoadingIssue] = useState(false)
  const [retryingDelivery, setRetryingDelivery] = useState(false)
  const [retryDeliveryError, setRetryDeliveryError] = useState<string | null>(null)
  const [reEvaluating, setReEvaluating] = useState(false)
  const [reEvaluateError, setReEvaluateError] = useState<string | null>(null)
  const [attempts, setAttempts] = useState<Submission[] | null>(null)
  const [attemptError, setAttemptError] = useState<string | null>(null)
  const [loadingAttempts, setLoadingAttempts] = useState(false)
  useEffect(() => {
    setRetryDeliveryError(null)
    setReEvaluateError(null)
  }, [submissionId])
  useEffect(() => {
    if (submission) onLoaded?.(submission)
  }, [submission, onLoaded])
  useEffect(() => {
    alive.current = true
    void api.getFeedbackSnippets().then((result) => {
      if (alive.current && result.data) setSnippets(result.data.feedback_snippets)
    })
    return () => {
      alive.current = false
    }
  }, [])
  useImperativeHandle(ref, () => ({ confirmLeave: review.confirmLeave, keepGuarding: review.keepGuarding }))

  async function go(id: number) {
    if (await review.confirmLeave()) onNavigate?.(id)
  }
  async function refreshChecks() {
    setRefreshing(true)
    try {
      const result = await api.refreshSubmissionGithubChecks(submissionId)
      if (!alive.current) return
      if (result.data && !result.error)
        review.setSubmission((current) =>
          current ? { ...current, github_checks: result.data!.github_checks } : current,
        )
      else review.setError(result.error || 'Could not refresh GitHub checks.')
    } catch {
      if (alive.current) review.setError('Could not refresh GitHub checks.')
    } finally {
      if (alive.current) setRefreshing(false)
    }
  }
  async function loadIssue() {
    setLoadingIssue(true)
    setIssueError(null)
    try {
      const result = await api.getSubmissionGithubIssue(submissionId)
      if (!alive.current) return
      if (result.data && !result.data.error && !result.error) setIssue(result.data)
      else setIssueError(result.error || result.data?.error || 'Could not load GitHub issue.')
    } catch {
      if (alive.current) setIssueError('Could not load GitHub issue.')
    } finally {
      if (alive.current) setLoadingIssue(false)
    }
  }
  async function retryGithubDelivery() {
    setRetryingDelivery(true)
    setRetryDeliveryError(null)
    try {
      const result = await api.retrySubmissionGithubIssue(submissionId)
      if (!alive.current) return
      if (result.data && !result.error) review.setSubmission(result.data.submission)
      else setRetryDeliveryError(result.error || 'Could not retry GitHub feedback.')
    } catch {
      if (alive.current) setRetryDeliveryError('Could not retry GitHub feedback.')
    } finally {
      if (alive.current) setRetryingDelivery(false)
    }
  }
  async function reEvaluateSuggestion() {
    setReEvaluating(true)
    setReEvaluateError(null)
    try {
      const result = await api.evaluateSubmissionGradeSuggestion(submissionId)
      if (!alive.current) return
      if (result.data && !result.error) {
        review.setSubmission((current) =>
          current ? { ...current, grade_suggestion: result.data!.grade_suggestion } : current,
        )
      } else {
        setReEvaluateError(result.error || 'Could not re-evaluate check suggestion.')
      }
    } catch {
      if (alive.current) setReEvaluateError('Could not re-evaluate check suggestion.')
    } finally {
      if (alive.current) setReEvaluating(false)
    }
  }
  async function loadAttempts() {
    if (!submission) return
    setLoadingAttempts(true)
    setAttemptError(null)
    try {
      const result = await api.getSubmissions({
        user_id: String(submission.user_id),
        ...(submission.cohort_id ? { cohort_id: String(submission.cohort_id) } : {}),
      })
      if (!alive.current) return
      if (!result.data || result.error)
        setAttemptError(result.error || 'Could not load attempt history.')
      else
        setAttempts(
          result.data.submissions.filter(
            (item) =>
              item.content_block_id === submission.content_block_id &&
              item.enrollment_id === submission.enrollment_id,
          ),
        )
    } catch {
      if (alive.current) setAttemptError('Could not load attempt history.')
    } finally {
      if (alive.current) setLoadingAttempts(false)
    }
  }
  async function saveSnippet() {
    setSavingSnippet(true)
    try {
      const result = await api.createFeedbackSnippet(trimBlankLines(feedback))
      if (!alive.current) return
      if (result.data) setSnippets((current) => [result.data!.feedback_snippet, ...current])
      else review.setError(result.error || 'Could not save feedback snippet.')
    } catch {
      if (alive.current) review.setError('Could not save feedback snippet.')
    } finally {
      if (alive.current) setSavingSnippet(false)
    }
  }

  if (review.noAccess) return <NoAccess />
  if (loading) return <LoadingSpinner message="Loading submission details..." fullScreen={false} />
  if (!submission)
    return (
      <LoadError
        error={error || 'Could not load submission details.'}
        retry={() => void review.load()}
      />
    )
  const resolvedContext = {
    ...navigationContext,
    cohortId: submission.cohort_id || navigationContext?.cohortId,
    userId: submission.user_id,
  }
  const language = detectLanguage(submission.filename, submission.language_hint)
  const runner = normalizeCodeRunnerConfig(
    submission.submission_config,
    codeRunnerLanguageFromEditor(language) || 'ruby',
  )
  const suggestion = submission.grade_suggestion
  const hasSuggestion = Boolean(suggestion)
  const isOverridingSuggestion = gradeDiffersFromSuggestion(suggestion, selectedGrade)
  const artifactLinks = [
    ['Repository', submission.repo_url],
    ['Pull request', submission.pr_url],
    ['Live site', submission.live_url],
    ['GitHub issue', submission.github_issue_url],
    ['GitHub code', submission.github_code_url],
  ].filter((item): item is [string, string] => Boolean(item[1]))

  return (
    <section
      ref={panelElement}
      aria-label="Submission review"
      tabIndex={-1}
      className="min-w-0 space-y-5"
      onKeyDown={(event) => {
        const target = event.target as HTMLElement
        const topDialog = Array.from(document.querySelectorAll('[data-app-modal]')).at(-1)
        if (topDialog && !topDialog.contains(event.currentTarget)) return
        if (
          !active ||
          grading ||
          event.defaultPrevented ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')
        )
          return
        // Only the focused review panel receives shortcuts; background queues never grade.
        const key = event.key.toUpperCase()
        if (!['A', 'B', 'C', 'R', 'J', 'K'].includes(key)) return
        // Auto-repeats, and a key still held from the review before, wait for a fresh press.
        if (!freshKey(event)) {
          event.preventDefault()
          return
        }
        const id = key === 'J' ? nextId : key === 'K' ? previousId : null
        if (id && onNavigate) {
          event.preventDefault()
          void go(id)
        } else if (key === 'A' || key === 'B' || key === 'C' || key === 'R') {
          event.preventDefault()
          if (hasSuggestion) selectGradeChoice(key)
          else void gradeWith(key)
        }
      }}
    >
      {showHeader && <>
      <nav
        aria-label="Review navigation"
        className="flex flex-wrap items-center justify-between gap-2"
      >
        {onReturn && (
          <Button
            variant="quiet"
            onClick={async () => {
              if (await review.confirmLeave()) onReturn()
            }}
          >
            {returnLabel}
          </Button>
        )}
        {onNavigate && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="quiet"
              disabled={!previousId || grading}
              onClick={() => previousId && void go(previousId)}
              aria-keyshortcuts="K"
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            {position && <span className="text-xs tabular-nums text-ink-muted">{position}</span>}
            <Button
              variant="quiet"
              disabled={!nextId || grading}
              onClick={() => nextId && void go(nextId)}
              aria-keyshortcuts="J"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </nav>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="break-words text-lg font-bold text-ink">
            <RecordLink record={{ type: 'student', id: submission.user_id, cohortId: resolvedContext.cohortId }} variant="plain" touchTarget onClick={guardLeave}>{submission.user_name}</RecordLink>
          </h2>
          <p className="break-words text-sm text-ink-secondary">
            <RecordLink record={{ type: 'lesson', id: submission.lesson_id, cohortId: resolvedContext.cohortId }} variant="plain" touchTarget className="text-ink-secondary" onClick={guardLeave}>{submission.lesson_title}</RecordLink>
            {submissionWhereLabel(submission.lesson_title, submission.content_block_title) !== submission.lesson_title && <> · {submission.content_block_title}</>}
          </p>
          <p className="text-xs text-ink-muted">
            Attempt {submission.num_submissions} · {formatShortDateTime(submission.created_at)}
          </p>
        </div>
        {submission.grade && <GradeDisplay grade={submission.grade} size="md" />}
      </header>
      </>}
      {submission.github_revision && (
        <p className="break-words text-sm text-ink-secondary">
          Submitted revision <code>{submission.commit_sha?.slice(0, 8)}</code>
          {' · '}<time dateTime={submission.github_revision.captured_at}>{formatShortDateTime(submission.github_revision.captured_at)}</time>
          {' · '}{submission.github_revision.paths.join(', ')}
        </p>
      )}
      {showRecordLink && (
        <Link
          className="app-link inline-flex min-h-11 items-center gap-2 text-sm"
          to={submissionPath(submission.id, resolvedContext)}
          onClick={async (event) => {
            event.preventDefault()
            if (await review.confirmLeave())
              navigate(submissionPath(submission.id, resolvedContext))
          }}
        >
          Open submission
          <ExternalLink className="h-4 w-4" />
        </Link>
      )}
      {artifactLinks.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {artifactLinks.map(([label, url]) => (
            <a
              className="app-link inline-flex min-h-11 items-center gap-2 rounded-xl border border-line px-3 text-sm"
              key={label}
              href={sanitizeUrl(url)}
              target="_blank"
              rel="noopener noreferrer"
            >
              {label}
              <ExternalLink className="h-4 w-4" />
            </a>
          ))}
        </div>
      )}
      {submission.github_issue_delivery && (
        <GithubIssueDeliveryStatus
          delivery={submission.github_issue_delivery}
          retrying={retryingDelivery}
          retryError={retryDeliveryError}
          onRetry={() => void retryGithubDelivery()}
        />
      )}
      {suggestion && (
        <GradeSuggestionCard
          suggestion={suggestion}
          savedGrade={submission.grade}
          selectedGrade={selectedGrade}
          disabled={grading || conflict || isPreviousAttempt(submission)}
          reEvaluating={reEvaluating}
          reEvaluateError={reEvaluateError}
          onSelectB={() => selectGradeChoice('B', true)}
          onReEvaluate={() => void reEvaluateSuggestion()}
        />
      )}
      {(submission.branch || submission.commit_sha || submission.notes) && (
        <div className="space-y-2 break-words rounded-xl bg-surface-sunken p-3 text-sm text-ink-secondary">
          {submission.branch && <p>Branch: {submission.branch}</p>}
          {submission.commit_sha && <p className="break-all">Commit: {submission.commit_sha}</p>}
          {submission.notes && <p className="whitespace-pre-wrap">{submission.notes}</p>}
        </div>
      )}
      {submission.exercise_body && (
        <details open={taskOpen || undefined}>
          <summary className="flex min-h-11 cursor-pointer items-center font-semibold">
            Exercise instructions
          </summary>
          <MarkdownRenderer content={submission.exercise_body} />
        </details>
      )}
      <div>
        <h3 className="mb-2 font-semibold">Student submission</h3>
        {submission.text ? (
          <div className="space-y-3">
            <SubmissionText
              key={submission.id}
              text={submission.text}
              language={language}
              namedLanguage={namedLanguage(submission.filename, submission.language_hint)}
              preferSource={runner.enabled}
            />
            {runner.enabled && (
              <CodeRunner
                code={submission.text}
                language={runner.language}
                timeoutMs={CODE_RUNNER_TIMEOUT_MS}
              />
            )}
          </div>
        ) : (
          <p className="text-sm text-ink-muted">
            {submission.github_revision ? 'The captured file is empty.' : 'No inline code submitted. Review the links and notes above.'}
          </p>
        )}
      </div>
      {submission.solution && (
        <details>
          <summary className="flex min-h-11 cursor-pointer items-center font-semibold">
            Reference solution
          </summary>
          <CodeBlock code={submission.solution} language={language} surface="submission" lineNumbers />
        </details>
      )}
      {(submission.repo_url || submission.pr_url || submission.github_code_url) && (
        <details>
          <summary className="flex min-h-11 cursor-pointer items-center font-semibold">
            GitHub checks
          </summary>
          <Button
            variant="secondary"
            disabled={refreshing || !submission.commit_sha}
            onClick={() => void refreshChecks()}
          >
            <RefreshCw className="h-4 w-4" />
            {refreshing ? 'Refreshing…' : 'Refresh checks'}
          </Button>
          {!submission.commit_sha ? (
            <p className="text-sm text-ink-muted">
              Save a commit SHA before refreshing its checks.
            </p>
          ) : (
            <GithubChecksPanel checks={submission.github_checks} />
          )}
        </details>
      )}
      {submission.github_issue_url && (
        <details>
          <summary className="flex min-h-11 cursor-pointer items-center font-semibold">
            GitHub issue discussion
          </summary>
          <Button variant="secondary" disabled={loadingIssue} onClick={() => void loadIssue()}>
            {loadingIssue ? 'Loading…' : issue ? 'Refresh issue' : 'Load GitHub issue'}
          </Button>
          {issueError && <p role="alert">{issueError}</p>}
          {issue && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold">{issue.title}</h3>
                <Badge tone={issue.state === 'closed' ? 'neutral' : 'success'}>
                  {issue.state === 'closed' ? 'Closed' : 'Open'}
                </Badge>
              </div>
              <MarkdownRenderer content={issue.body || ''} />
              {issue.comments?.map((comment) => (
                <article key={comment.id} className="rounded-xl border border-line p-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-semibold">{comment.user}</span>
                    <time className="text-ink-muted" dateTime={comment.created_at}>
                      {formatShortDateTime(comment.created_at)}
                    </time>
                  </div>
                  <MarkdownRenderer content={comment.body} />
                </article>
              ))}
            </div>
          )}
        </details>
      )}
      <details>
        <summary className="flex min-h-11 cursor-pointer items-center font-semibold">
          Attempt history
        </summary>
        <Button variant="secondary" disabled={loadingAttempts} onClick={() => void loadAttempts()}>
          {loadingAttempts ? 'Loading…' : attempts ? 'Refresh attempts' : 'Load attempts'}
        </Button>
        {attemptError && <p role="alert">{attemptError}</p>}
        {attempts?.map((attempt) => (
          <Link
            key={attempt.id}
            className="app-link flex min-h-11 items-center"
            to={submissionPath(attempt.id, resolvedContext)}
            onClick={async (event) => {
              event.preventDefault()
              if (await review.confirmLeave()) navigate(submissionPath(attempt.id, resolvedContext))
            }}
          >
            Attempt {attempt.num_submissions} ·{' '}
            {attempt.id === submission.id
              ? 'This attempt'
              : attempt.id === submission.latest_submission_id
                ? 'Latest'
                : 'Previous'}{' '}
            · {gradeLabel(attempt.grade) || 'Waiting for review'}
            {attempt.github_revision && <> · {attempt.commit_sha?.slice(0, 8)} · {formatShortDateTime(attempt.github_revision.captured_at)}</>}
            {submission.github_revision && !attempt.github_revision && <> · Historical source; revision not captured</>}
          </Link>
        ))}
      </details>
      {submission.feedback && (
        <div className="rounded-xl border border-line bg-surface-sunken p-3">
          <h3 className="text-sm font-semibold">
            Saved feedback{submission.graded_by ? ` · ${submission.graded_by}` : ''}
          </h3>
          <FeedbackBody feedback={submission.feedback} />
        </div>
      )}
      <AttemptReview submission={submission} navigationContext={resolvedContext}>
        <fieldset
          disabled={grading || conflict || isPreviousAttempt(submission)}
          className="min-w-0 space-y-4 border-0 p-0"
        >
          {submission.rubric && (
            <div id="rubric" tabIndex={-1} className="scroll-mt-24 space-y-3 outline-none">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold">{submission.rubric.title}</h3>
                <Badge tone="neutral">Optional for Redo</Badge>
              </div>
              {submission.rubric.criteria.map((criterion) => (
                <div key={criterion.id} className="rounded-xl border border-line p-3">
                  <p className="text-sm font-semibold">{criterion.title}</p>
                  <p className="mt-1 text-xs text-ink-muted">{criterion.description}</p>
                  <div
                    role="group"
                    aria-label={`Rating for ${criterion.title}`}
                    className="mt-3 grid grid-cols-2 gap-1"
                  >
                    {RATINGS.map(([rating, label]) => (
                      <SegmentButton
                        key={rating}
                        selected={criteria[criterion.id]?.rating === rating}
                        onClick={() =>
                          review.setCriteria((current) => ({
                            ...current,
                            [criterion.id]: {
                              rating,
                              feedback: current[criterion.id]?.feedback || '',
                            },
                          }))
                        }
                      >
                        {label}
                      </SegmentButton>
                    ))}
                  </div>
                  <textarea
                    aria-label={`Feedback for ${criterion.title}`}
                    value={criteria[criterion.id]?.feedback || ''}
                    onChange={(event) =>
                      review.setCriteria((current) => ({
                        ...current,
                        [criterion.id]: {
                          rating: current[criterion.id]?.rating || null,
                          feedback: event.target.value,
                        },
                      }))
                    }
                    className="app-control mt-2 min-h-20 w-full"
                  />
                </div>
              ))}
            </div>
          )}
        </fieldset>
      </AttemptReview>
      {/* The grade bar: a direct child of the panel so it stays pinned to the bottom of the screen
          while the review scrolls (U-4.1). Feedback, A/B/C/Redo and errors are always in view. */}
      <div
        ref={gradeControls}
        data-grade-bar=""
        className={`sticky z-20 -mx-2 space-y-2 rounded-2xl border border-line bg-surface-raised p-2.5 shadow-overlay sm:-mx-1 sm:space-y-3 sm:p-3 ${
          footerOffset === 'shell'
            ? 'bottom-[calc(4.25rem+1px+env(safe-area-inset-bottom,0px))] lg:bottom-3 [html[data-keyboard=open]_&]:bottom-0'
            : 'bottom-0'
        }`}
      >
        <fieldset
          disabled={grading || conflict || isPreviousAttempt(submission)}
          className={`min-w-0 space-y-2 border-0 p-0 ${feedbackShown ? '' : 'hidden lg:block'}`}
        >
          {(snippets.length > 0 || feedback.trim()) && (
            <div className="flex items-center gap-2">
              <div role="group" aria-label="Reusable snippets" className="flex min-w-0 flex-1 gap-2 overflow-x-auto [scrollbar-width:none]">
                {snippets.map((snippet) => (
                  <Button
                    key={snippet.id}
                    variant="secondary"
                    size="sm"
                    className="shrink-0"
                    title={snippet.body}
                    onClick={() => {
                      review.setFeedback((current) => appendFeedbackSnippet(current, snippet.body))
                      void api.useFeedbackSnippet(snippet.id)
                    }}
                  >
                    {snippet.title}
                  </Button>
                ))}
              </div>
              <Button
                variant="quiet"
                size="sm"
                className="shrink-0"
                disabled={!feedback.trim() || savingSnippet}
                onClick={() => void saveSnippet()}
                title="Save draft as reusable snippet"
                aria-label="Save draft as reusable snippet"
              >
                <BookmarkPlus className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">{savingSnippet ? 'Saving…' : 'Save draft as reusable snippet'}</span>
              </Button>
            </div>
          )}
          <label htmlFor={feedbackId} className="sr-only">
            Overall feedback
          </label>
          <MarkdownEditor
            ref={feedbackEditor}
            id={feedbackId}
            label="Overall feedback"
            value={feedback}
            onChange={review.setFeedback}
            placeholder={`Feedback for ${submission.user_name?.split(' ')[0] || 'the student'}`}
            disabled={grading || conflict || isPreviousAttempt(submission)}
            minHeight={44}
            maxHeight={160}
          />
        </fieldset>
        <div aria-live="assertive" aria-atomic="true">
          {error && (
            <div
              role="alert"
              className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-xl border border-danger-line bg-danger-soft px-3 py-2 text-sm font-semibold text-danger-ink"
            >
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p className="min-w-0 flex-1">{error}</p>
              {conflict ? (
                <div className="w-full space-y-2 font-normal">
                  <p>
                    Your draft is kept. Reload the saved review, compare it with your draft, then grade
                    again.
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      focused.current = false
                      void review.load(true)
                    }}
                  >
                    Reload saved version — keep draft
                  </Button>
                </div>
              ) : error !== REDO_NEEDS_FEEDBACK && (
                <Button variant="quiet" size="sm" onClick={() => review.setError(null)}>
                  Keep editing
                </Button>
              )}
            </div>
          )}
        </div>
        <fieldset
          disabled={grading || conflict || isPreviousAttempt(submission)}
          className="min-w-0 space-y-2 border-0 p-0"
        >
          {hasSuggestion && isOverridingSuggestion && (
            <div className="space-y-1">
              <label htmlFor={overrideNoteId} className="block text-xs font-semibold text-ink-secondary">
                Override note (optional)
              </label>
              <input
                id={overrideNoteId}
                type="text"
                maxLength={500}
                value={overrideReason}
                onChange={(event) => review.setOverrideReason(event.target.value)}
                placeholder="Note why this grade differs from the check suggestion"
                disabled={grading || conflict || isPreviousAttempt(submission)}
                className="app-control min-h-11 w-full px-3 text-sm"
              />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              className="min-h-11 min-w-11 px-2.5 lg:hidden"
              aria-expanded={feedbackShown}
              aria-label="Feedback"
              onClick={() => setFeedbackOpen((open) => !open)}
            >
              <MessageSquareText className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Feedback</span>
            </Button>
            <div role="group" aria-label="Grade" className="grid min-w-0 flex-1 grid-cols-4 gap-1.5 sm:flex-none sm:gap-2">
              {(['A', 'B', 'C', 'R'] as const).map((value) => {
                const isSelected = hasSuggestion && selectedGrade === value
                return (
                  <Button
                    key={value}
                    variant={hasSuggestion ? (isSelected ? 'primary' : 'secondary') : value === 'A' ? 'primary' : 'secondary'}
                    // The key hint is drawn by CSS (data-key), so the button's name stays "A" / "Redo".
                    className={`min-h-11 min-w-0 px-2 sm:min-w-14 sm:px-4 lg:after:ml-1 lg:after:rounded-md lg:after:border lg:after:border-current/30 lg:after:px-1 lg:after:text-xs lg:after:font-semibold lg:after:opacity-70 lg:after:content-[attr(data-key)] ${value === 'R' && !isSelected ? REDO_BUTTON_CLASSES : ''}`}
                    data-key={value}
                    aria-keyshortcuts={value}
                    aria-pressed={hasSuggestion ? isSelected : undefined}
                    title={
                      hasSuggestion
                        ? `Select ${value === 'R' ? 'Redo' : value} (${value})`
                        : `${value === 'R' ? 'Request a redo' : `Grade ${value}`} and save (${value})`
                    }
                    onClick={() => (hasSuggestion ? selectGradeChoice(value) : void gradeWith(value))}
                  >
                    {value === 'R' ? 'Redo' : value}
                  </Button>
                )
              })}
            </div>
            {hasSuggestion ? (
              <Button
                variant="primary"
                size="md"
                className="w-full sm:w-auto"
                disabled={!selectedGrade || grading || conflict || isPreviousAttempt(submission)}
                onClick={() => selectedGrade && void gradeWith(selectedGrade)}
              >
                {grading ? 'Saving…' : onSaved ? 'Save and next' : 'Save grade'}
              </Button>
            ) : (
              <p className="ml-auto hidden text-xs text-ink-muted xl:block">
                {grading ? 'Saving…' : <>Grading saves{onSaved ? ' and opens the next item' : ''}. <kbd className="font-sans font-semibold">J</kbd> / <kbd className="font-sans font-semibold">K</kbd> next and previous.</>}
              </p>
            )}
          </div>
        </fieldset>
        <p className="sr-only">
          {hasSuggestion
            ? 'With focus in this panel: A, B, C or R (Redo) selects a grade without saving; use Save to confirm. K and J move through the list. Shortcuts stay off while typing.'
            : 'With focus in this panel: A, B, C or R (Redo) grades; K and J move through the list. Shortcuts stay off while typing.'}
        </p>
      </div>
    </section>
  )
}

function GradeSuggestionCard({
  suggestion,
  savedGrade,
  selectedGrade,
  disabled,
  reEvaluating,
  reEvaluateError,
  onSelectB,
  onReEvaluate,
}: {
  suggestion: NonNullable<Submission['grade_suggestion']>
  savedGrade: Submission['grade']
  selectedGrade: GradeChoice | null
  disabled: boolean
  reEvaluating: boolean
  reEvaluateError: string | null
  onSelectB: () => void
  onReEvaluate: () => void
}) {
  const stale = isGradeSuggestionStale(suggestion)
  const allowSelectB = canSelectSuggestedB(suggestion) && !disabled
  const headline = gradeSuggestionHeadline(suggestion)
  const checks = extractSuggestionChecks(suggestion)
  const decisionBadge = suggestion.decision ? gradeSuggestionDecisionBadge(suggestion.decision) : null

  const borderTone = stale || suggestion.outcome === 'review_for_redo'
    ? 'border-warning-line'
    : suggestion.outcome === 'suggest_b'
      ? 'border-info-line'
      : 'border-line'

  const icon = stale ? (
    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-ink" aria-hidden="true" />
  ) : suggestion.outcome === 'suggest_b' ? (
    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-info-ink" aria-hidden="true" />
  ) : suggestion.outcome === 'review_for_redo' ? (
    <RotateCcw className="mt-0.5 h-4 w-4 shrink-0 text-warning-ink" aria-hidden="true" />
  ) : (
    <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
  )

  return (
    <section
      aria-label="Automated check suggestion"
      data-grade-suggestion={suggestion.outcome}
      data-grade-suggestion-stale={stale ? 'true' : 'false'}
      className={`scroll-mt-20 space-y-3 rounded-2xl border bg-surface-raised p-4 text-sm text-ink ${borderTone}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-2.5">
          {icon}
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-bold text-ink break-words">{headline}</h3>
              {stale && <Badge tone="warning">Stale evidence</Badge>}
              {suggestion.stale_for_current_policy && suggestion.outcome !== 'stale_evidence' && (
                <Badge tone="warning">Policy updated</Badge>
              )}
            </div>
            <p className="text-xs text-ink-secondary">
              Automated checks inform review — instructors confirm every final grade.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {allowSelectB && (
            <Button
              variant={selectedGrade === 'B' ? 'primary' : 'secondary'}
              size="md"
              className="w-full sm:w-auto"
              aria-pressed={selectedGrade === 'B'}
              onClick={onSelectB}
            >
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              Select B
            </Button>
          )}
          <Button
            variant="secondary"
            size="md"
            className="w-full sm:w-auto"
            disabled={reEvaluating}
            onClick={onReEvaluate}
          >
            <RefreshCw className={`h-4 w-4 ${reEvaluating ? 'animate-spin' : ''}`} aria-hidden="true" />
            {reEvaluating ? 'Re-evaluating…' : 'Re-evaluate'}
          </Button>
        </div>
      </div>

      {savedGrade && (
        <div
          data-suggestion-saved-comparison=""
          className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface-sunken px-3 py-2 text-xs text-ink"
        >
          <span className="font-semibold">
            {gradeSuggestionSignalLabel(suggestion)} · Grade {savedGrade}
          </span>
          {decisionBadge && <Badge tone={decisionBadge.tone}>{decisionBadge.label}</Badge>}
          {suggestion.override_reason && (
            <span className="text-ink-secondary break-words">
              Override note: {suggestion.override_reason}
            </span>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted tabular-nums">
        {suggestion.commit_sha && (
          <span>
            Commit{' '}
            <code className="font-mono font-semibold text-ink">
              {suggestion.commit_sha.slice(0, 8)}
            </code>
          </span>
        )}
        {suggestion.policy_version != null && <span>Policy v{suggestion.policy_version}</span>}
        <span>
          Evaluated{' '}
          <time dateTime={suggestion.evaluated_at}>
            {formatShortDateTime(suggestion.evaluated_at)}
          </time>
        </span>
      </div>

      <p className="text-sm text-ink-secondary break-words">{suggestion.reason_summary}</p>

      {checks.length > 0 && (
        <ul
          aria-label="Required check evidence"
          className="divide-y divide-line rounded-xl border border-line bg-surface-sunken"
        >
          {checks.map((check) => {
            const safeDetailsUrl = check.detailsUrl ? sanitizeUrl(check.detailsUrl) : null
            return (
              <li
                key={check.name}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <span className="block font-mono font-semibold text-ink break-all">
                    {check.name}
                  </span>
                  {check.appSlug && (
                    <span className="block text-ink-muted">{check.appSlug}</span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge tone={check.tone}>{check.label}</Badge>
                  {safeDetailsUrl && (
                    <a
                      href={safeDetailsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="app-link inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl lg:min-h-9 lg:min-w-9"
                      aria-label={`View ${check.name} check details`}
                    >
                      <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    </a>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {reEvaluateError && (
        <p role="alert" className="text-xs font-semibold text-danger-ink">
          {reEvaluateError}
        </p>
      )}
    </section>
  )
}

function GithubIssueDeliveryStatus({
  delivery,
  retrying,
  retryError,
  onRetry,
}: {
  delivery: NonNullable<Submission['github_issue_delivery']>
  retrying: boolean
  retryError: string | null
  onRetry: () => void
}) {
  const safeIssueUrl = delivery.issue_url ? sanitizeUrl(delivery.issue_url) : null
  const isFailed = delivery.status === 'failed'
  const isDelivered = delivery.status === 'delivered'
  const isPending = delivery.status === 'pending'

  const surfaceClass = isFailed
    ? 'border-danger-line bg-danger-soft text-danger-ink'
    : isDelivered
      ? 'border-success-line bg-success-soft text-success-ink'
      : 'border-line bg-surface-sunken text-ink'

  const heading = isFailed
    ? 'Grade saved · GitHub feedback failed'
    : isDelivered
      ? 'GitHub feedback delivered'
      : isPending
        ? 'Grade saved · GitHub feedback pending'
        : 'GitHub feedback superseded'

  const detail = isFailed
    ? delivery.last_error || 'Your grade and feedback are saved in Learn. Retry to deliver to GitHub.'
    : isDelivered
      ? [
          delivery.action === 'close' ? 'Issue closed' : 'Posted to GitHub',
          delivery.delivered_at ? formatShortDateTime(delivery.delivered_at) : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : isPending
        ? delivery.last_error
          ? `Saved in Learn. Retrying after previous error: ${delivery.last_error}`
          : 'Feedback is saved in Learn and queued for the next GitHub sync.'
        : 'Replaced by a newer grade or submission.'

  return (
    <div
      data-github-issue-delivery={delivery.status}
      role="status"
      className={`rounded-2xl border p-3.5 text-sm ${surfaceClass}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-2.5">
          {isFailed ? (
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          ) : isDelivered ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          ) : (
            <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          )}
          <div className="min-w-0 space-y-0.5">
            <p className="font-semibold break-words">{heading}</p>
            <p className={`text-xs break-words ${isFailed || isDelivered ? '' : 'text-ink-secondary'}`}>
              {detail}
            </p>
            {isFailed && (
              <p className="text-xs">
                Your grade and feedback remain saved in Learn.
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {isDelivered && safeIssueUrl && (
            <a
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-current/25 bg-surface-raised px-3 text-sm font-semibold text-ink hover:bg-surface-sunken"
              href={safeIssueUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              View GitHub issue
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </a>
          )}
          {isFailed && (
            <Button
              variant="secondary"
              size="md"
              className="w-full sm:w-auto"
              disabled={retrying}
              onClick={onRetry}
            >
              <RefreshCw className={`h-4 w-4 ${retrying ? 'animate-spin' : ''}`} aria-hidden="true" />
              {retrying ? 'Retrying…' : 'Retry GitHub feedback'}
            </Button>
          )}
        </div>
      </div>
      {retryError && (
        <p role="alert" className="mt-2 text-xs font-semibold text-danger-ink">
          {retryError}
        </p>
      )}
    </div>
  )
}

function GithubChecksPanel({ checks }: { checks: Submission['github_checks'] }) {
  if (!checks)
    return (
      <p className="mt-4 text-sm text-ink-muted">
        Checks have not been fetched for this commit yet.
      </p>
    )
  const counts = [
    ['Passed', checks.summary.passed, 'success'],
    ['Failed', checks.summary.failed, 'danger'],
    ['Pending', checks.summary.pending, 'pending'],
    ['Other', checks.summary.neutral, 'neutral'],
  ] as const satisfies ReadonlyArray<readonly [string, number, BadgeTone]>
  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {counts.map(([label, count, tone]) => (
          <Badge key={label} tone={tone} className="tabular-nums">
            {count} {label.toLowerCase()}
          </Badge>
        ))}
        <span className="text-xs tabular-nums text-ink-muted">
          Commit{' '}
          <span className="font-mono font-semibold text-ink-secondary">
            {checks.head_sha?.slice(0, 8)}
          </span>
          {checks.fetched_at ? ` · refreshed ${formatShortDateTime(checks.fetched_at)}` : ''}
        </span>
      </div>
      {checks.runs.length ? (
        <div className="divide-y divide-line rounded-xl border border-line">
          {checks.runs.map((run) => {
            const detailsUrl = run.details_url ? sanitizeUrl(run.details_url) : null
            const content = (
              <>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-ink" title={run.name}>
                    {run.name}
                  </span>
                  <span className="block truncate text-xs text-ink-muted">
                    {run.workflow_name || run.app_slug || 'GitHub'} ·{' '}
                    {humanize(run.status, CHECK_RUN_LABELS)}
                  </span>
                </span>
                <Badge
                  tone={
                    run.conclusion === 'success'
                      ? 'success'
                      : ['failure', 'timed_out', 'startup_failure', 'action_required'].includes(
                            run.conclusion || '',
                          )
                        ? 'danger'
                        : 'pending'
                  }
                >
                  {run.conclusion ? humanize(run.conclusion, CHECK_RUN_LABELS) : 'Pending'}
                </Badge>
                {detailsUrl && <ExternalLink className="h-4 w-4 text-ink-muted" />}
              </>
            )
            return detailsUrl ? (
              <a
                key={run.id}
                href={detailsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-3 py-2 transition-colors duration-150 hover:bg-surface-sunken"
              >
                {content}
              </a>
            ) : (
              <div
                key={run.id}
                className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2"
              >
                {content}
              </div>
            )
          })}
        </div>
      ) : (
        <p className="rounded-xl border border-line bg-surface-sunken px-4 py-3 text-sm text-ink-secondary">
          GitHub returned no check runs for this commit.
        </p>
      )}
    </div>
  )
}
