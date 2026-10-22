import { AttemptReview, isPreviousAttempt } from '../../components/shared/AttemptReview'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { queueShortcutDirection, RESTORE_LIST_STATE } from '../../lib/navigationContext'
import { ArrowLeft, BookOpen, CheckCircle2, ChevronLeft, ChevronRight, ExternalLink, FileCheck2, GitBranch, MessageSquareText, RefreshCw, RotateCcw, UserRound } from 'lucide-react'
import { api } from '../../lib/api'
import { cohortPath, cohortStudentPath, directMessagePath, safeInternalReturnPath, submissionPath } from '../../lib/routes'
import { DISCARD_DRAFT_CONFIRMATION, feedbackDraftDiffers, orderSubmissionQueue, type SubmissionQueueFilter } from '../../lib/submissionQueue'
import { useConfirm } from '../../contexts/ConfirmContext'
import { formatShortDateTime } from '../../lib/format'
import { sanitizeUrl } from '../../lib/sanitizeUrl'
import { Button, buttonClasses } from '../../components/ui/Button'
import { Badge, type BadgeTone } from '../../components/ui/Badge'
import { Avatar } from '../../components/ui/Avatar'
import { SegmentButton, TextButton } from '../../components/ui/Choice'
import { StatusBadge } from '../../components/shared/StatusBadge'
import { EmptyState } from '../../components/shared/EmptyState'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { CodeEditor, detectLanguage } from '../../components/shared/CodeEditor'
import { GradeDisplay } from '../../components/shared/GradeDisplay'
import { useToast } from '../../contexts/ToastContext'
import { StudentContextDrawer } from '../../components/admin/StudentContextDrawer'
import type { RubricRating, StudentProgressResponse, Submission } from '../../types/api'
import { FeedbackBody, FeedbackFormattingHint } from '../../components/shared/FeedbackBody'

interface ValidatedWorkspaceContext {
  cohortId: number
  cohortName: string
  evidenceScope?: StudentProgressResponse['learning_evidence_scope']
}

type SubmissionQueue = SubmissionQueueFilter

const RUBRIC_RATINGS: Array<[RubricRating, string]> = [['exceeds', 'Exceeds'], ['meets', 'Meets'], ['developing', 'Developing'], ['redo', 'Revision']]

/** Redo is a request for another attempt, not an error: a secondary button with warning tones. */
const REDO_BUTTON_CLASSES = 'border-warning-300! text-warning-800! hover:bg-warning-50!'

const QUEUE_LABELS: Record<SubmissionQueue, string> = { ungraded: 'Ungraded queue', redo: 'Redo queue', all: 'All submissions' }

export function SubmissionDetail() {
  const { id } = useParams<{ id: string }>()
  const submissionId = Number(id)
  const [searchParams] = useSearchParams()
  const requestedCohortId = Number(searchParams.get('cohort_id')) || null
  const requestedStudentId = Number(searchParams.get('student_id')) || null
  const queueMode = (['ungraded', 'redo', 'all'] as const).includes(searchParams.get('queue') as SubmissionQueue) ? searchParams.get('queue') as SubmissionQueue : null
  const queueCohortId = queueMode ? Number(searchParams.get('queue_cohort_id')) || undefined : undefined
  const navigate = useNavigate()
  const toast = useToast()
  const confirm = useConfirm()
  const [submission, setSubmission] = useState<Submission | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState('')
  const [criterionResults, setCriterionResults] = useState<Record<number, { rating: RubricRating | null; feedback: string }>>({})
  const [grading, setGrading] = useState(false)
  const [openingMessage, setOpeningMessage] = useState(false)
  const [refreshingChecks, setRefreshingChecks] = useState(false)
  const [validatedContext, setValidatedContext] = useState<ValidatedWorkspaceContext | null>(null)
  const [queueContext, setQueueContext] = useState<{ previousId: number | null; nextId: number | null; position: number; total: number } | null>(null)
  const [showStudentContext, setShowStudentContext] = useState(false)

  const load = useCallback(async () => {
    if (!Number.isInteger(submissionId)) {
      setError('This submission link is invalid.')
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    const result = await api.getSubmission(submissionId)
    if (!result.data) {
      setError(result.error || 'Could not load this submission.')
      setLoading(false)
      return
    }
    const next = result.data.submission
    if (queueMode) {
      const queueResult = await api.getSubmissions(queueCohortId ? { cohort_id: String(queueCohortId) } : undefined)
      const queue = orderSubmissionQueue(queueResult.data?.submissions || [], queueMode)
      const index = queue.findIndex((item) => item.id === next.id)
      setQueueContext(index >= 0 ? { previousId: queue[index - 1]?.id || null, nextId: queue[index + 1]?.id || null, position: index + 1, total: queue.length } : null)
    } else setQueueContext(null)
    let nextContext: ValidatedWorkspaceContext | null = null
    if (requestedCohortId && (!requestedStudentId || requestedStudentId === next.user_id)) {
      const progressResult = await api.getStudentProgress(next.user_id, requestedCohortId)
      const cohortBlockIds = new Set(progressResult.data?.modules.flatMap((mod) => mod.lessons.flatMap((lesson) => lesson.blocks.map((block) => block.id))) || [])
      if (progressResult.data && cohortBlockIds.has(next.content_block_id)) {
        nextContext = {
          cohortId: requestedCohortId,
          cohortName: progressResult.data.cohort.name,
          evidenceScope: progressResult.data.learning_evidence_scope,
        }
      }
    }
    setSubmission(next)
    setValidatedContext(nextContext)
    setFeedback(next.feedback || '')
    setCriterionResults(Object.fromEntries((next.rubric?.criteria || []).map((criterion) => [criterion.id, { rating: criterion.rating || null, feedback: criterion.feedback || '' }])))
    setLoading(false)
  }, [queueCohortId, queueMode, requestedCohortId, requestedStudentId, submissionId])

  useEffect(() => { void load() }, [load])

  const draftDiffers = feedbackDraftDiffers(submission, feedback, criterionResults)
  /** Moves through the queue; an unsaved feedback or rubric draft is only discarded after confirming. */
  const goToQueueItem = useCallback(async (targetId: number) => {
    if (!queueMode) return
    if (draftDiffers && !(await confirm(DISCARD_DRAFT_CONFIRMATION))) return
    navigate(submissionPath(targetId, { returnTo: safeInternalReturnPath(searchParams.get('return_to'), '/admin/grading'), queue: queueMode, queueCohortId }))
  }, [confirm, draftDiffers, navigate, queueCohortId, queueMode, searchParams])

  // J / K move through the queue (shown next to Previous/Next); typing in feedback is never hijacked.
  useEffect(() => {
    if (!queueMode || !queueContext || showStudentContext) return
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const direction = queueShortcutDirection(event)
      const targetId = direction === 'next' ? queueContext.nextId : direction === 'previous' ? queueContext.previousId : null
      if (!targetId) return
      event.preventDefault()
      void goToQueueItem(targetId)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [goToQueueItem, queueContext, queueMode, showStudentContext])

  const language = useMemo(() => submission ? detectLanguage(submission.filename, submission.language_hint) : 'ruby', [submission])

  async function grade(gradeValue: string) {
    if (!submission || isPreviousAttempt(submission)) return
    if (submission.rubric?.criteria.some((criterion) => !criterionResults[criterion.id]?.rating)) {
      toast.error('Rate every rubric criterion before grading.')
      return
    }
    setGrading(true)
    const result = await api.gradeSubmission(submission.id, {
      grade: gradeValue,
      base_submission_updated_at: submission.updated_at,
      feedback,
      criterion_results: submission.rubric?.criteria.map((criterion) => ({
        rubric_criterion_id: criterion.id,
        rating: criterionResults[criterion.id].rating!,
        feedback: criterionResults[criterion.id].feedback,
      })),
    })
    setGrading(false)
    if (!result.data) {
      toast.error(result.error || 'Could not save this grade.')
      if (result.latestSubmissionId) setSubmission((current) => current ? { ...current, latest_submission_id: result.latestSubmissionId } : current)
      return
    }
    setSubmission(result.data.submission)
    toast.success(`Submission graded ${gradeValue}.`)
    if (queueMode === 'ungraded' && queueContext?.nextId) navigate(submissionPath(queueContext.nextId, { returnTo: searchParams.get('return_to') || '/admin/grading?filter=ungraded', queue: queueMode, queueCohortId }))
  }

  async function openMessage() {
    if (!submission || !validatedContext) return
    setOpeningMessage(true)
    const result = await api.createDirectConversation({ cohort_id: validatedContext.cohortId, user_ids: [submission.user_id] })
    setOpeningMessage(false)
    if (result.data) navigate(directMessagePath(result.data.direct_conversation.id, { type: 'submission', id: submission.id, label: submission.content_block_title }))
    else toast.error(result.error || 'Could not open a direct message.')
  }

  async function refreshGithubChecks() {
    if (!submission) return
    setRefreshingChecks(true)
    const result = await api.refreshSubmissionGithubChecks(submission.id)
    setRefreshingChecks(false)
    if (!result.data) {
      toast.error(result.error || 'Could not refresh GitHub checks.')
      return
    }
    const githubChecks = result.data.github_checks
    setSubmission((current) => current ? { ...current, github_checks: githubChecks } : current)
    toast.success('GitHub checks refreshed.')
  }

  if (loading) return <LoadingSpinner message="Loading submission record…" />
  if (!submission || error) return <div className="app-page"><EmptyState icon={FileCheck2} title="Could not open this submission" description={error || 'The submission was not found.'} action={<Button onClick={() => void load()}><RefreshCw className="h-4 w-4" />Try again</Button>} /></div>

  const studentPath = validatedContext ? cohortStudentPath(validatedContext.cohortId, submission.user_id, 'work') : `/admin/students/${submission.user_id}`
  const returnFallback = validatedContext ? studentPath : '/admin/grading'
  const returnTo = safeInternalReturnPath(searchParams.get('return_to'), returnFallback)
  const artifactLinks = [
    ['Repository', submission.repo_url],
    ['Pull request', submission.pr_url],
    ['Live site', submission.live_url],
    ['GitHub issue', submission.github_issue_url],
    ['GitHub code', submission.github_code_url],
  ].filter((item): item is [string, string] => Boolean(item[1]))

  return (
    <div className="app-page-wide space-y-6">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm font-semibold text-ink-muted">
        <Link to={returnTo} state={RESTORE_LIST_STATE} className="app-link inline-flex min-h-11 items-center gap-1 px-1"><ArrowLeft className="h-4 w-4" aria-hidden="true" />{queueMode ? `Back to ${QUEUE_LABELS[queueMode].toLowerCase()}` : 'Back'}</Link>
        {validatedContext && <><span aria-hidden="true" className="text-ink-disabled">/</span><Link className="app-link inline-flex min-h-11 items-center px-1 lg:min-h-0" to={cohortPath(validatedContext.cohortId)}>Workspace: {validatedContext.cohortName}</Link></>}
        <span aria-hidden="true" className="text-ink-disabled">/</span><Link className="app-link inline-flex min-h-11 items-center px-1 lg:min-h-0" to={studentPath}>{submission.user_name}</Link>
        <span aria-hidden="true" className="text-ink-disabled">/</span><span className="px-1 tabular-nums text-ink-secondary">Submission #{submission.id}</span>
      </nav>

      {queueContext && <nav aria-label="Queue" className="app-surface flex flex-wrap items-center justify-between gap-3 px-4 py-3"><p className="text-sm font-semibold tabular-nums text-ink-secondary" aria-live="polite">{QUEUE_LABELS[queueMode!]} · {queueContext.position} of {queueContext.total}</p><div className="flex items-center gap-2"><span className="hidden text-xs text-ink-muted lg:inline">Keys <kbd className="rounded border border-line bg-surface-sunken px-1.5 font-mono text-xs text-ink-secondary">K</kbd> <kbd className="rounded border border-line bg-surface-sunken px-1.5 font-mono text-xs text-ink-secondary">J</kbd></span><QueueLink label="Previous" submissionId={queueContext.previousId} returnTo={returnTo} queue={queueMode!} queueCohortId={queueCohortId} icon="previous" guard={draftDiffers ? goToQueueItem : undefined} /><QueueLink label="Next" submissionId={queueContext.nextId} returnTo={returnTo} queue={queueMode!} queueCohortId={queueCohortId} icon="next" guard={draftDiffers ? goToQueueItem : undefined} /></div></nav>}

      <header className="app-surface p-5 sm:p-6">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <div>
            <p className="app-eyebrow">Submission record</p>
            <h1 className="app-title mt-2">{submission.content_block_title}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink-muted">
              {validatedContext ? <TextButton onClick={() => setShowStudentContext(true)} className="gap-2"><Avatar name={submission.user_name} size="sm" />{submission.user_name}</TextButton> : <Link className="app-link inline-flex min-h-11 items-center gap-2" to={studentPath}><Avatar name={submission.user_name} size="sm" />{submission.user_name}</Link>}
              <span className="inline-flex min-w-0 items-center gap-1"><BookOpen className="h-4 w-4 shrink-0" />{submission.module_name} · {submission.lesson_title}</span>
              <span className="tabular-nums">Attempt {submission.num_submissions}</span>
              <span className="tabular-nums">{formatShortDateTime(submission.created_at)}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {submission.grade ? <GradeDisplay grade={submission.grade} size="md" /> : <StatusBadge status="awaiting_review" short />}
            {validatedContext && <Button variant="secondary" onClick={() => setShowStudentContext(true)}><UserRound className="h-4 w-4" />Student context</Button>}
            {validatedContext && <Button variant="secondary" onClick={() => void openMessage()} disabled={openingMessage}><MessageSquareText className="h-4 w-4" />{openingMessage ? 'Opening…' : `Message in ${validatedContext.cohortName}`}</Button>}
          </div>
        </div>
        {validatedContext?.evidenceScope?.shared_across_enrollments && <div className="mt-5 rounded-xl border border-info-200 bg-info-50 px-4 py-3 text-sm leading-6 text-info-800"><span className="font-semibold">Curriculum evidence:</span> this submission follows the learner across enrollments using {validatedContext.evidenceScope.curriculum_name}. The selected workspace and message action are scoped to {validatedContext.cohortName}.</div>}
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
        <main className="space-y-6">
          <section className="app-surface p-5 sm:p-6">
            <h2 className="text-lg font-bold text-ink">Student submission</h2>
            {submission.text ? <div className="mt-4"><CodeEditor value={submission.text} language={language} readOnly minHeight={280} /></div> : <p className="mt-4 text-sm italic text-ink-muted">No text or code was submitted.</p>}
            {submission.notes && <div className="mt-4 rounded-xl bg-surface-sunken p-4"><p className="text-xs font-semibold text-ink-muted">Student notes</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink-secondary">{submission.notes}</p></div>}
          </section>

          {artifactLinks.length > 0 && <section className="app-surface p-5 sm:p-6"><h2 className="text-lg font-bold text-ink">Related artifacts</h2><div className="mt-4 grid gap-2 sm:grid-cols-2">{artifactLinks.map(([label, url]) => <a key={label} href={sanitizeUrl(url)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center justify-between rounded-xl border border-line px-3 py-2 text-sm font-semibold text-ink-secondary transition-colors duration-150 hover:border-line-strong hover:bg-surface-sunken hover:text-ink"><span className="inline-flex items-center gap-2"><GitBranch className="h-4 w-4" />{label}</span><ExternalLink className="h-4 w-4" /></a>)}</div></section>}

          {(submission.repo_url || submission.pr_url || submission.github_code_url) && <section className="app-surface p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="app-eyebrow">Automated evidence</p>
                <h2 className="mt-1 text-lg font-bold text-ink">GitHub checks</h2>
                <p className="mt-1 text-sm leading-6 text-ink-muted">Persisted check status for the exact commit attached to this submission. Check output and logs are never copied into the learning platform.</p>
              </div>
              <Button variant="secondary" onClick={() => void refreshGithubChecks()} disabled={refreshingChecks || !submission.commit_sha}>
                <RefreshCw className={`h-4 w-4 ${refreshingChecks ? 'animate-spin' : ''}`} />{refreshingChecks ? 'Refreshing…' : 'Refresh checks'}
              </Button>
            </div>
            {!submission.commit_sha ? <div className="mt-4 rounded-xl border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-800"><span className="font-semibold">Commit needed.</span> Sync or save a commit SHA on this submission before refreshing its checks.</div> : <GithubChecksPanel checks={submission.github_checks} />}
          </section>}

          {submission.solution && <details className="app-surface p-5 sm:p-6"><summary className="flex min-h-11 cursor-pointer items-center font-semibold text-ink">Reference solution</summary><div className="mt-4"><CodeEditor value={submission.solution} language={language} readOnly minHeight={220} /></div></details>}
        </main>

        <aside className="app-surface self-start p-5 sm:p-6 xl:sticky xl:top-20">
          <h2 className="text-lg font-bold text-ink">Review and feedback</h2>
          {submission.grade === 'R' && submission.feedback && <div className="mt-4 rounded-xl border border-warning-200 bg-warning-50 p-3 text-sm text-warning-800"><p className="font-semibold">Current redo feedback</p><FeedbackBody feedback={submission.feedback} className="mt-1" /></div>}

          <AttemptReview submission={submission}>
          {submission.rubric && <div className="mt-5 space-y-4"><div><p className="text-xs font-semibold text-ink-muted">Rubric</p><p className="mt-1 font-semibold text-ink">{submission.rubric.title}</p></div>{submission.rubric.criteria.map((criterion) => <div key={criterion.id} className="rounded-xl border border-line p-3"><p className="text-sm font-semibold text-ink">{criterion.title}</p><p className="mt-1 text-xs leading-5 text-ink-muted">{criterion.description}</p><div role="group" aria-label={`Rating for ${criterion.title}`} className="mt-3 grid grid-cols-2 gap-1 rounded-xl border border-line bg-surface-sunken p-1">{RUBRIC_RATINGS.map(([rating, label]) => <SegmentButton key={rating} selected={criterionResults[criterion.id]?.rating === rating} onClick={() => setCriterionResults((current) => ({ ...current, [criterion.id]: { rating, feedback: current[criterion.id]?.feedback || '' } }))}>{label}</SegmentButton>)}</div><textarea aria-label={`Feedback for ${criterion.title}`} value={criterionResults[criterion.id]?.feedback || ''} onChange={(event) => setCriterionResults((current) => ({ ...current, [criterion.id]: { rating: current[criterion.id]?.rating || null, feedback: event.target.value } }))} placeholder="Optional criterion feedback" className="app-control mt-2 min-h-20 w-full" /></div>)}</div>}

          <label htmlFor="submission-feedback" className="mt-5 block text-sm font-semibold text-ink">Overall feedback</label>
          <textarea id="submission-feedback" value={feedback} onChange={(event) => setFeedback(event.target.value)} rows={7} placeholder="Give the student a clear next step…" className="app-control mt-2 w-full leading-6" />
          <FeedbackFormattingHint value={feedback} />
          <div className="mt-4 grid grid-cols-2 gap-2">
            {['A', 'B', 'C'].map((gradeValue) => <Button key={gradeValue} variant={gradeValue === 'A' ? 'primary' : 'secondary'} onClick={() => void grade(gradeValue)} disabled={grading}><CheckCircle2 className="h-4 w-4" />Grade {gradeValue}</Button>)}
            <Button variant="secondary" className={REDO_BUTTON_CLASSES} onClick={() => void grade('R')} disabled={grading}><RotateCcw className="h-4 w-4" />Request redo</Button>
          </div>
          </AttemptReview>
        </aside>
      </div>
      {validatedContext && <StudentContextDrawer open={showStudentContext} cohortId={validatedContext.cohortId} studentId={submission.user_id} source={{ type: 'submission', id: submission.id, label: submission.content_block_title }} onClose={() => setShowStudentContext(false)} />}
    </div>
  )
}

function GithubChecksPanel({ checks }: { checks: Submission['github_checks'] }) {
  if (!checks) return <p className="mt-4 text-sm text-ink-muted">Checks have not been fetched for this commit yet.</p>
  const counts = [
    ['Passed', checks.summary.passed, 'success'],
    ['Failed', checks.summary.failed, 'danger'],
    ['Pending', checks.summary.pending, 'pending'],
    ['Other', checks.summary.neutral, 'neutral'],
  ] as const satisfies ReadonlyArray<readonly [string, number, BadgeTone]>
  return <div className="mt-4 space-y-4">
    <div className="flex flex-wrap items-center gap-2">
      {counts.map(([label, count, tone]) => <Badge key={label} tone={tone} className="tabular-nums">{count} {label.toLowerCase()}</Badge>)}
      <span className="text-xs tabular-nums text-ink-muted">Commit <span className="font-mono font-semibold text-ink-secondary">{checks.head_sha?.slice(0, 8)}</span>{checks.fetched_at ? ` · refreshed ${formatShortDateTime(checks.fetched_at)}` : ''}</span>
    </div>
    {checks.runs.length ? <div className="divide-y divide-line rounded-xl border border-line">{checks.runs.map((run) => {
      const detailsUrl = run.details_url ? sanitizeUrl(run.details_url) : null
      const content = <><span className="min-w-0"><span className="block truncate text-sm font-semibold text-ink" title={run.name}>{run.name}</span><span className="block truncate text-xs text-ink-muted">{run.workflow_name || run.app_slug || 'GitHub'} · {run.status.replaceAll('_', ' ')}</span></span><Badge tone={run.conclusion === 'success' ? 'success' : ['failure', 'timed_out', 'startup_failure', 'action_required'].includes(run.conclusion || '') ? 'danger' : 'pending'}>{run.conclusion?.replaceAll('_', ' ') || 'pending'}</Badge>{detailsUrl && <ExternalLink className="h-4 w-4 text-ink-muted" />}</>
      return detailsUrl ? <a key={run.id} href={detailsUrl} target="_blank" rel="noopener noreferrer" className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-3 py-2 transition-colors duration-150 hover:bg-surface-sunken">{content}</a> : <div key={run.id} className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2">{content}</div>
    })}</div> : <p className="rounded-xl border border-line bg-surface-sunken px-4 py-3 text-sm text-ink-secondary">GitHub returned no check runs for this commit.</p>}
  </div>
}

function QueueLink({ label, submissionId, returnTo, queue, queueCohortId, icon, guard }: { label: string; submissionId: number | null; returnTo: string; queue: SubmissionQueue; queueCohortId?: number; icon: 'previous' | 'next'; guard?: (submissionId: number) => Promise<void> }) {
  const Icon = icon === 'previous' ? ChevronLeft : ChevronRight
  const shortcut = icon === 'previous' ? 'K' : 'J'
  if (!submissionId) return <span aria-disabled="true" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>{icon === 'previous' && <Icon className="h-4 w-4" aria-hidden="true" />}{label}{icon === 'next' && <Icon className="h-4 w-4" aria-hidden="true" />}</span>
  return <Link to={submissionPath(submissionId, { returnTo, queue, queueCohortId })} onClick={guard ? (event) => { event.preventDefault(); void guard(submissionId) } : undefined} aria-keyshortcuts={shortcut} title={`${label} (${shortcut})`} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>{icon === 'previous' && <Icon className="h-4 w-4" aria-hidden="true" />}{label}{icon === 'next' && <Icon className="h-4 w-4" aria-hidden="true" />}</Link>
}
