import { NoAccess } from '../shared/NoAccess'
import { Link, useLocation, useNavigate } from 'react-router-dom'
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
  RefreshCw,
  RotateCcw,
} from 'lucide-react'
import { api } from '../../lib/api'
import { trimBlankLines } from '../../lib/messageFormat'
import { lessonEditorPath, submissionPath } from '../../lib/routes'
import { listLinkState } from '../../lib/navigationContext'
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
import { MarkdownEditor, isComposingKey, type MarkdownEditorHandle } from '../shared/MarkdownEditor'
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
  OVERRIDE_REASON_PICKS,
  STALE_SUGGESTION_EXPLANATION,
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
  /**
   * Where saving this grade goes: the id of the item onSaved opens, or null when the review stays
   * or closes. The same function drives onSaved, so "Save and next" only shows when it is true.
   */
  followingAfterSave?: (grade: GradeChoice) => number | null | undefined
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
  /**
   * The query parameters that select or remount this inline review (`submission`, `review`, a
   * keyed `cohort_id`); changing any of them replaces the review, so an unsaved draft asks first.
   */
  selectionParam?: string | string[]
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
  ['redo', 'Needs redo'],
]

/** Cmd/Ctrl+Enter with nothing chosen: grades are never saved by a guess. */
export const CHOOSE_GRADE_FIRST = 'Choose A, B, C or Redo, then save.'
/** Shown above Save while Redo is chosen on a cohort that delivers Redo feedback to GitHub. */
export const REDO_POSTS_TO_GITHUB = "Saving Redo will post this feedback to the student's GitHub repository as an issue."

/** All entry points render this panel; discovery pages own only selection and return context. */
export function SubmissionReviewPanel({
  submissionId,
  ref,
  navigationContext,
  previousId,
  nextId,
  followingAfterSave,
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
  const location = useLocation()
  const review = useSubmissionReview(
    submissionId,
    onSaved,
    selectionParam ? leavesPathOrParam(...[selectionParam].flat()) : leavesPath,
  )
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
  const unratedCount = selectedGrade && selectedGrade !== 'R' ? review.unratedCriteria.length : 0
  function focusUnratedCriterion() {
    const first = review.unratedCriteria[0]
    if (!first) return
    const criterion = panelElement.current?.querySelector<HTMLElement>(`#rubric [data-criterion-id="${first.id}"]`)
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    criterion?.scrollIntoView?.({ block: 'nearest', behavior: reduceMotion ? 'instant' : 'smooth' })
    criterion?.querySelector('button')?.focus({ preventScroll: true })
  }
  // The grade bar is pinned in view; in a short host it may still sit below, so a failed grade shows it.
  useEffect(() => {
    if (error) gradeControls.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [error])
  async function gradeWith(value: GradeChoice) {
    const overriding = gradeDiffersFromSuggestion(submission?.grade_suggestion, value)
    const result = await review.grade(
      value,
      overriding ? { suggestionOverrideReason: overrideReason } : undefined,
    )
    if (result === 'needs_rubric') requestAnimationFrame(focusUnratedCriterion)
    if (result !== 'needs_feedback') return
    requestAnimationFrame(() => {
      feedbackEditor.current?.focus()
      // The bar grew; on a short phone screen bring all of it (message and grades) into view.
      gradeControls.current?.scrollIntoView?.({ block: 'nearest' })
    })
  }
  // Every grade button and key only chooses; Save (or Cmd/Ctrl+Enter) is the one way to save.
  function selectGradeChoice(value: GradeChoice, revealGradeBar = false) {
    review.setSelectedGrade(value)
    review.setError((current) =>
      current === CHOOSE_GRADE_FIRST || (current === REDO_NEEDS_FEEDBACK && value !== 'R') ? null : current,
    )
    if (value === 'R' && isBlankFeedback(feedbackEditor.current?.getMarkdown() ?? feedback)) feedbackEditor.current?.focus()
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
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)
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
  const [attempts, setAttempts] = useState<Submission[] | null>(null)
  const [attemptError, setAttemptError] = useState<string | null>(null)
  const [loadingAttempts, setLoadingAttempts] = useState(false)
  useEffect(() => {
    setRetryDeliveryError(null)
    setCheckError(null)
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
  /**
   * Check GitHub again: fetch the commit's checks, which also re-scores the suggestion. Without a
   * commit there is nothing to fetch, so only the suggestion is scored again against the current rules.
   */
  async function checkGithubAgain() {
    if (!submission) return
    setChecking(true)
    setCheckError(null)
    // A grade saved while GitHub answers carries the decision the instructor just made; keep it.
    const generation = review.saveGeneration()
    const fresh = () => review.saveGeneration() === generation
    // When GitHub can't be reached, a suggestion is still scored again against the saved checks.
    let unreachable: string | null = null
    try {
      if (submission.commit_sha) {
        const result = await api.refreshSubmissionGithubChecks(submissionId)
        if (!alive.current) return
        if (!result.data || result.error) {
          unreachable = result.error || 'Could not check GitHub.'
          setCheckError(unreachable)
          if (!submission.grade_suggestion) return
        } else {
          const data = result.data
          review.setSubmission((current) =>
            current
              ? {
                  ...current,
                  github_checks: data.github_checks,
                  ...(data.grade_suggestion !== undefined && fresh() ? { grade_suggestion: data.grade_suggestion } : {}),
                }
              : current,
          )
          if (data.grade_suggestion !== undefined || !submission.grade_suggestion) return
        }
      }
      const result = await api.evaluateSubmissionGradeSuggestion(submissionId)
      if (!alive.current) return
      if (result.data && !result.error) {
        const suggestion = result.data.grade_suggestion
        if (fresh()) review.setSubmission((current) => (current ? { ...current, grade_suggestion: suggestion } : current))
        if (unreachable) setCheckError(`${unreachable} The suggestion was checked again against the last saved results.`)
      } else setCheckError(unreachable || result.error || 'Could not check GitHub.')
    } catch {
      if (alive.current) setCheckError('Could not check GitHub.')
    } finally {
      if (alive.current) setChecking(false)
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
  const checkPolicyPath = lessonEditorPath(submission.lesson_id, { blockId: submission.content_block_id })
  const gradingReturn = listLinkState(location, 'Grading')
  const hasSuggestion = Boolean(suggestion)
  const isOverridingSuggestion = gradeDiffersFromSuggestion(suggestion, selectedGrade)
  const locked = grading || conflict || isPreviousAttempt(submission)
  // "Save and next" only when the caller's own post-save step opens another item for this grade.
  const advances = Boolean(onSaved && selectedGrade && followingAfterSave?.(selectedGrade))
  const hasGithub = Boolean(submission.repo_url || submission.pr_url || submission.github_code_url)
  const technical = [
    submission.github_revision && ['Submitted paths', submission.github_revision.paths.join(', ')],
    submission.branch && ['Branch', submission.branch],
    submission.commit_sha && ['Commit', submission.commit_sha],
  ].filter((item): item is [string, string] => Boolean(item))
  function saveSelected() {
    if (locked) return
    if (!selectedGrade) {
      review.setError(CHOOSE_GRADE_FIRST)
      return
    }
    void gradeWith(selectedGrade)
  }
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
      onKeyDownCapture={(event) => {
        // Cmd/Ctrl+Enter saves the chosen grade from anywhere in the review, feedback box included,
        // before the editor can turn it into a line break.
        if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
        // An input method is still composing (Japanese, Chinese, Korean...): Enter belongs to it.
        if (isComposingKey(event.nativeEvent)) return
        const topDialog = Array.from(document.querySelectorAll('[data-app-modal]')).at(-1)
        if (!active || (topDialog && !topDialog.contains(event.currentTarget))) return
        event.preventDefault()
        event.stopPropagation()
        if (!event.repeat && !grading) saveSelected()
      }}
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
          if (!locked) selectGradeChoice(key)
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
          Synced from GitHub{' '}
          <time dateTime={submission.github_revision.captured_at}>{formatShortDateTime(submission.github_revision.captured_at)}</time>
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
          disabled={locked}
          checking={checking}
          checkError={checkError}
          missingPolicyLink={suggestion.reason_code === 'missing_policy' && (
            <Link to={checkPolicyPath} state={gradingReturn} onClick={(event) => guardLeave(event, checkPolicyPath, gradingReturn)} className="app-link inline-flex min-h-11 items-center">
              Open exercise check rules
            </Link>
          )}
          onSelectB={() => selectGradeChoice('B', true)}
          onCheckGithub={() => void checkGithubAgain()}
        />
      )}
      {!suggestion && hasGithub && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <CheckGithubButton checking={checking} disabled={!submission.commit_sha} onClick={() => void checkGithubAgain()} />
            {!submission.commit_sha && (
              <p className="text-sm text-ink-muted">The student hasn't submitted a commit yet.</p>
            )}
          </div>
          {checkError && (
            <p role="alert" className="text-sm font-semibold text-danger-ink">
              {checkError}
            </p>
          )}
        </div>
      )}
      {submission.notes && (
        <p className="whitespace-pre-wrap break-words rounded-xl bg-surface-sunken p-3 text-sm text-ink-secondary">
          {submission.notes}
        </p>
      )}
      {technical.length > 0 && (
        <details>
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-ink-secondary">
            Technical details
          </summary>
          <dl className="space-y-1 break-all rounded-xl bg-surface-sunken p-3 text-xs text-ink-secondary">
            {technical.map(([label, value]) => (
              <div key={label}>
                <dt className="inline font-semibold">{label}: </dt>
                <dd className="inline font-mono">{value}</dd>
              </div>
            ))}
          </dl>
        </details>
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
      {hasGithub && submission.commit_sha && (
        <details>
          <summary className="flex min-h-11 cursor-pointer items-center font-semibold">
            GitHub checks
          </summary>
          <GithubChecksPanel checks={submission.github_checks} />
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
            {attempt.github_revision && <> · Synced {formatShortDateTime(attempt.github_revision.captured_at)}</>}
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
            // Phones: scroll margins keep a rating scrolled into view clear of the sticky grade bar.
            <div
              id="rubric"
              tabIndex={-1}
              className="scroll-mt-24 scroll-mb-72 space-y-3 outline-none lg:scroll-mb-48 [&_:is(button,textarea)]:scroll-mt-24 [&_:is(button,textarea)]:scroll-mb-72 lg:[&_:is(button,textarea)]:scroll-mb-48"
            >
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold">{submission.rubric.title}</h3>
                <Badge tone="neutral">Optional for Redo</Badge>
              </div>
              {submission.rubric.criteria.map((criterion) => (
                <div key={criterion.id} data-criterion-id={criterion.id} className="scroll-mt-24 scroll-mb-72 rounded-xl border border-line p-3 focus-within:border-focus lg:scroll-mb-48">
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
        className={`sticky z-20 -mx-2 space-y-1.5 rounded-2xl border border-line bg-surface-raised p-2 shadow-overlay sm:-mx-1 sm:space-y-3 sm:p-3 ${
          footerOffset === 'shell'
            ? 'bottom-[calc(4.25rem+1px+env(safe-area-inset-bottom,0px))] lg:bottom-3 [html[data-keyboard=open]_&]:bottom-0'
            : 'bottom-0'
        }`}
      >
        {/* Feedback is always in view, phones included: no grade is saved without passing it. */}
        <fieldset disabled={locked} className="min-w-0 space-y-1.5 border-0 p-0 sm:space-y-2">
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
                className="min-w-11 shrink-0"
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
            compactToolbar
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
            <div className="space-y-1.5">
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
                disabled={locked}
                className="app-control min-h-11 w-full px-3 text-sm"
              />
              <div
                role="group"
                aria-label="Common override reasons"
                className="flex flex-nowrap gap-1.5 overflow-x-auto [scrollbar-width:none] sm:flex-wrap sm:overflow-visible"
              >
                {OVERRIDE_REASON_PICKS.map((reason) => (
                  <Button
                    key={reason}
                    variant={overrideReason === reason ? 'primary' : 'secondary'}
                    size="sm"
                    aria-pressed={overrideReason === reason}
                    className="shrink-0"
                    onClick={() => review.setOverrideReason(reason)}
                  >
                    {reason}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {selectedGrade === 'R' && submission.redo_posts_to_github && (
            <p
              data-redo-github-warning=""
              className="flex items-start gap-2 rounded-xl border border-warning-line bg-warning-soft px-3 py-2 text-sm text-warning-ink"
            >
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0">{REDO_POSTS_TO_GITHUB}</span>
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Grade" className={`grid min-w-0 flex-1 grid-cols-4 gap-1.5 sm:flex-none sm:gap-2 ${unratedCount ? 'basis-full sm:basis-auto' : ''}`}>
              {(['A', 'B', 'C', 'R'] as const).map((value) => {
                const isSelected = selectedGrade === value
                return (
                  <Button
                    key={value}
                    variant={isSelected ? 'primary' : 'secondary'}
                    // The key hint is drawn by CSS (data-key); aria-label keeps that hint out of the name ("A", not "A A").
                    aria-label={value === 'R' ? 'Redo' : value}
                    className={`min-h-11 min-w-0 px-2 sm:min-w-14 sm:px-4 lg:after:ml-1 lg:after:rounded-md lg:after:border lg:after:border-current/30 lg:after:px-1 lg:after:text-xs lg:after:font-semibold lg:after:opacity-70 lg:after:content-[attr(data-key)] ${value === 'R' && !isSelected ? REDO_BUTTON_CLASSES : ''}`}
                    data-key={value}
                    aria-keyshortcuts={value}
                    aria-pressed={isSelected}
                    title={`Choose ${value === 'R' ? 'Redo' : value} (${value}), then save`}
                    onClick={() => selectGradeChoice(value)}
                  >
                    {value === 'R' ? 'Redo' : value}
                  </Button>
                )
              })}
            </div>
            {unratedCount > 0 && (
              <Button variant="quiet" size="sm" className="bg-surface-sunken" onClick={focusUnratedCriterion}>
                {unratedCount} rubric {unratedCount === 1 ? 'item' : 'items'} left
              </Button>
            )}
            <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
              {(submission.rubric?.criteria.length ?? 0) > 0 && selectedGrade && selectedGrade !== 'R'
                ? unratedCount > 0
                  ? `${unratedCount} rubric ${unratedCount === 1 ? 'item' : 'items'} left`
                  : 'All rubric items rated'
                : ''}
            </p>
            <Button
              variant="primary"
              size="md"
              className={unratedCount ? 'flex-1 sm:flex-none' : 'w-full sm:w-auto'}
              disabled={!selectedGrade || locked}
              aria-keyshortcuts="Meta+Enter Control+Enter"
              onClick={saveSelected}
            >
              {grading ? 'Saving…' : advances ? 'Save and next' : 'Save grade'}
            </Button>
            <p className="ml-auto hidden text-xs text-ink-muted xl:block">
              <kbd className="font-sans font-semibold">⌘</kbd>/<kbd className="font-sans font-semibold">Ctrl</kbd>+<kbd className="font-sans font-semibold">Enter</kbd> saves
              {onNavigate && <> · <kbd className="font-sans font-semibold">J</kbd> / <kbd className="font-sans font-semibold">K</kbd> next and previous</>}
            </p>
          </div>
        </fieldset>
        <p className="sr-only">
          With focus in this panel: A, B, C or R (Redo) chooses a grade without saving; Save, or Command or
          Control plus Enter, saves it. K and J move through the list. Letter shortcuts stay off while typing.
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
  checking,
  checkError,
  missingPolicyLink,
  onSelectB,
  onCheckGithub,
}: {
  suggestion: NonNullable<Submission['grade_suggestion']>
  savedGrade: Submission['grade']
  selectedGrade: GradeChoice | null
  disabled: boolean
  checking: boolean
  checkError: string | null
  missingPolicyLink: React.ReactNode
  onSelectB: () => void
  onCheckGithub: () => void
}) {
  const stale = isGradeSuggestionStale(suggestion)
  const allowSelectB = canSelectSuggestedB(suggestion) && !disabled
  const headline = gradeSuggestionHeadline(suggestion)
  const checks = extractSuggestionChecks(suggestion)
  const decisionBadge = suggestion.decision ? gradeSuggestionDecisionBadge(suggestion.decision) : null
  const appSlugs = [...new Set(checks.map((check) => check.appSlug).filter((slug): slug is string => Boolean(slug)))]
  const hasTechnical = Boolean(suggestion.commit_sha || suggestion.policy_version != null || appSlugs.length)

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
              {stale && <Badge tone="warning">Out of date</Badge>}
            </div>
            <p className="text-xs text-ink-secondary">
              {stale ? STALE_SUGGESTION_EXPLANATION : 'Automated checks inform review — instructors confirm every final grade.'}
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
          <CheckGithubButton checking={checking} onClick={onCheckGithub} />
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

      <p className="text-xs text-ink-muted tabular-nums">
        Checked{' '}
        <time dateTime={suggestion.evaluated_at}>{formatShortDateTime(suggestion.evaluated_at)}</time>
      </p>

      <p className="text-sm text-ink-secondary break-words">{suggestion.reason_summary}</p>
      {missingPolicyLink}

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
                <span className="min-w-0 flex-1 font-mono font-semibold text-ink break-all">
                  {check.name}
                </span>
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

      {hasTechnical && (
        <details className="text-xs text-ink-muted">
          <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-ink-secondary">
            Technical details
          </summary>
          <dl className="space-y-1 break-all tabular-nums">
            {suggestion.commit_sha && (
              <div>
                <dt className="inline font-semibold">Commit: </dt>
                <dd className="inline font-mono">{suggestion.commit_sha}</dd>
              </div>
            )}
            {suggestion.policy_version != null && (
              <div>
                <dt className="inline font-semibold">Check rules version: </dt>
                <dd className="inline">{suggestion.policy_version}</dd>
              </div>
            )}
            {appSlugs.length > 0 && (
              <div>
                <dt className="inline font-semibold">Reported by: </dt>
                <dd className="inline font-mono">{appSlugs.join(', ')}</dd>
              </div>
            )}
          </dl>
        </details>
      )}

      {checkError && (
        <p role="alert" className="text-xs font-semibold text-danger-ink">
          {checkError}
        </p>
      )}
    </section>
  )
}

/** The one way to bring GitHub up to date here: fetch the commit's checks and score the suggestion again. */
function CheckGithubButton({ checking, disabled = false, onClick }: { checking: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <Button variant="secondary" size="md" className="w-full sm:w-auto" disabled={checking || disabled} onClick={onClick}>
      <RefreshCw className={`h-4 w-4 ${checking ? 'animate-spin' : ''}`} aria-hidden="true" />
      {checking ? 'Checking GitHub…' : 'Check GitHub again'}
    </Button>
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
        : 'GitHub feedback replaced by a newer grade'

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
        No checks yet. Use Check GitHub again to fetch them.
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
        {checks.fetched_at && (
          <span className="text-xs tabular-nums text-ink-muted">Checked {formatShortDateTime(checks.fetched_at)}</span>
        )}
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
                    {run.workflow_name || 'GitHub'} ·{' '}
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
