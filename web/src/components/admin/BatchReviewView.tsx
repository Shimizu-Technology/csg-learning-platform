import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCheck,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  ExternalLink,
  GitCommitHorizontal,
  ListChecks,
  Loader2,
  RefreshCw,
  SquareArrowOutUpRight,
  XCircle,
} from 'lucide-react'
import { api } from '../../lib/api'
import { runCodeChecks, codeChecksSummary, type CodeChecksRun } from '../../lib/codeChecks'
import { activeRunnerChecks, codeRunnerLanguageFromEditor, normalizeCodeRunnerConfig } from '../../lib/codeRunner'
import { canSelectSuggestedGrade, gradeSuggestionQueueBadge, suggestedPassingGrade } from '../../lib/gradeSuggestion'
import { gradeLabel } from '../../lib/glossary'
import { waitingLabel, waitingTooLong } from '../../lib/gradingQueue'
import { sanitizeUrl } from '../../lib/sanitizeUrl'
import { useConfirm } from '../../contexts/ConfirmContext'
import { useToast } from '../../contexts/ToastContext'
import type { BatchReview, BatchReviewSubmission, BatchGradeSkippedItem } from '../../types/api'
import { detectLanguage } from '../shared/CodeEditor'
import { CodeChecksList } from '../shared/CodeChecksResults'
import { EmptyState } from '../shared/EmptyState'
import { LoadError } from '../shared/LoadError'
import { LoadingSpinner } from '../shared/LoadingSpinner'
import { RecordLink } from '../shared/RecordLink'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { checksSuggestedGrade } from './RunnerChecksCard'

type CheckState = { status: 'queued' | 'running' } | { status: 'done'; run: CodeChecksRun }

interface Props {
  cohortId: number | null
  moduleId: number | null
  lessonId: number | null
  contentBlockId: number | null
  /** Picks the exercise (also called once to pin the default, so a refresh stays on it). */
  onChooseExercise: (contentBlockId: number) => void
  onOpenReview: (submissionId: number) => void
  onExit: () => void
}

/**
 * Batch review: every waiting attempt on one exercise as a card to skim, with the exercise's
 * automated checks run in this browser one submission at a time. Work whose checks passed (or
 * whose fresh GitHub suggestion is the scale's passing grade) starts selected; anything else
 * is left for the instructor to choose or open in full review. One confirmation approves the
 * selection as Pass or B (POST /submissions/batch_grade); the API re-checks every item.
 */
export function BatchReviewView({ cohortId, moduleId, lessonId, contentBlockId, onChooseExercise, onOpenReview, onExit }: Props) {
  const confirm = useConfirm()
  const toast = useToast()
  const [data, setData] = useState<BatchReview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [checks, setChecks] = useState<Record<number, CheckState>>({})
  const [selected, setSelected] = useState<Set<number>>(new Set())
  /** Cards the instructor ticked or unticked themselves: automated results never override them. */
  const touched = useRef<Set<number>>(new Set())
  const [feedback, setFeedback] = useState('')
  const [approving, setApproving] = useState(false)
  const [skipped, setSkipped] = useState<BatchGradeSkippedItem[]>([])
  const loadGeneration = useRef(0)

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current
    setLoading(true)
    const result = await api.getBatchReview({ cohort_id: cohortId, module_id: moduleId, lesson_id: lessonId, content_block_id: contentBlockId })
    if (generation !== loadGeneration.current) return
    setLoading(false)
    if (!result.data) {
      setError(result.error || 'Could not load batch review.')
      return
    }
    setError(null)
    touched.current = new Set()
    setChecks({})
    setData(result.data)
  }, [cohortId, moduleId, lessonId, contentBlockId])

  const loadedFor = useRef<{ key: string; exerciseId: number | null } | null>(null)
  useEffect(() => {
    const key = JSON.stringify([cohortId, moduleId, lessonId])
    // Pinning the default exercise in the URL names the one already loaded: nothing to fetch.
    if (loadedFor.current?.key === key && contentBlockId !== null && loadedFor.current.exerciseId === contentBlockId) return
    loadedFor.current = { key, exerciseId: null }
    void load()
  }, [load, cohortId, moduleId, lessonId, contentBlockId])
  useEffect(() => () => {
    loadGeneration.current += 1
  }, [])

  const exercise = data?.exercise ?? null
  useEffect(() => {
    if (loadedFor.current) loadedFor.current.exerciseId = exercise?.content_block_id ?? null
  }, [exercise])
  useEffect(() => {
    if (!contentBlockId && exercise) onChooseExercise(exercise.content_block_id)
  }, [contentBlockId, exercise, onChooseExercise])

  const scale = exercise?.grading_scale ?? 'pass_redo'
  const grade = checksSuggestedGrade(scale)
  const runner = useMemo(() => {
    const language = detectLanguage(exercise?.filename, exercise?.language_hint)
    return normalizeCodeRunnerConfig(exercise?.submission_config, codeRunnerLanguageFromEditor(language) || 'ruby')
  }, [exercise])
  const runnerChecks = useMemo(() => (exercise?.submission_type === 'text_submission' ? activeRunnerChecks(runner) : []), [exercise, runner])
  const submissions = useMemo(() => data?.submissions ?? [], [data])
  const checkable = useCallback((submission: BatchReviewSubmission) => runnerChecks.length > 0 && Boolean(submission.text?.trim()), [runnerChecks])

  // Which cards start selected: automated evidence that the work passes, and nothing else.
  const autoSelected = useCallback((submission: BatchReviewSubmission, state: CheckState | undefined) => {
    const suggestion = submission.grade_suggestion
    const githubPasses = Boolean(suggestion && canSelectSuggestedGrade(suggestion, scale) && suggestedPassingGrade(suggestion) === grade)
    const browserPasses = state?.status === 'done' && state.run.failed === 0 && state.run.total > 0
    return githubPasses || browserPasses
  }, [scale, grade])

  useEffect(() => {
    setSelected(new Set(submissions.filter((submission) => autoSelected(submission, undefined)).map((submission) => submission.id)))
  }, [submissions, autoSelected])

  // Run every card's checks in this browser, one submission at a time.
  useEffect(() => {
    let cancelled = false
    const queue = submissions.filter(checkable)
    if (!queue.length) return
    setChecks(Object.fromEntries(queue.map((submission) => [submission.id, { status: 'queued' } as CheckState])))
    void (async () => {
      for (const submission of queue) {
        if (cancelled) return
        setChecks((current) => ({ ...current, [submission.id]: { status: 'running' } }))
        const run = await runCodeChecks({ language: runner.language, code: submission.text ?? '', checks: runnerChecks })
        if (cancelled) return
        const state: CheckState = { status: 'done', run }
        setChecks((current) => ({ ...current, [submission.id]: state }))
        if (!touched.current.has(submission.id)) {
          setSelected((current) => {
            const next = new Set(current)
            if (autoSelected(submission, state)) next.add(submission.id)
            else next.delete(submission.id)
            return next
          })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [submissions, checkable, runner.language, runnerChecks, autoSelected])

  function toggle(id: number, value: boolean) {
    touched.current.add(id)
    setSelected((current) => {
      const next = new Set(current)
      if (value) next.add(id)
      else next.delete(id)
      return next
    })
  }
  function selectAll(value: boolean) {
    submissions.forEach((submission) => touched.current.add(submission.id))
    setSelected(value ? new Set(submissions.map((submission) => submission.id)) : new Set())
  }

  const chosen = submissions.filter((submission) => selected.has(submission.id))
  const gradeName = gradeLabel(grade)
  async function approve() {
    if (!chosen.length || approving) return
    const notPassing = chosen.filter((submission) => !autoSelected(submission, checks[submission.id])).length
    const ok = await confirm({
      title: `Approve ${chosen.length} ${chosen.length === 1 ? 'submission' : 'submissions'} as ${gradeName}?`,
      description: `Each student gets ${gradeName}${feedback.trim() ? ' and your feedback' : ''} on ${exercise?.title || 'this exercise'}.${notPassing ? ` ${notPassing} of them ${notPassing === 1 ? "doesn't" : "don't"} have passing automated checks.` : ''} Work that changed since it loaded is skipped.`,
      confirmLabel: `Approve as ${gradeName}`,
    })
    if (!ok) return
    setApproving(true)
    const result = await api.batchGradeSubmissions({
      grade,
      feedback: feedback.trim() ? feedback : null,
      items: chosen.map((submission) => ({ submission_id: submission.id, base_submission_updated_at: submission.updated_at })),
    })
    setApproving(false)
    const skippedItems = result.data?.skipped ?? result.errorSkipped ?? []
    setSkipped(skippedItems)
    if (result.data) {
      const count = result.data.graded.length
      toast.success(`Approved ${count} ${count === 1 ? 'submission' : 'submissions'} as ${gradeName}${skippedItems.length ? ` · ${skippedItems.length} skipped` : ''}`)
      setFeedback('')
      await load()
    } else {
      toast.error(result.error || 'Could not approve these submissions.')
      if (skippedItems.length) await load()
    }
  }

  if (!data && loading) return <LoadingSpinner message="Loading batch review..." fullScreen={false} />
  if (!data) return <LoadError error={error || 'Batch review unavailable.'} retry={() => void load()} />

  const nameFor = (id: number) => submissions.find((submission) => submission.id === id)?.user_name
  const checkedCount = Object.values(checks).filter((state) => state.status === 'done').length
  const checksRunning = runnerChecks.length > 0 && submissions.some(checkable) && checkedCount < submissions.filter(checkable).length

  return (
    <section aria-label="Batch review" className="min-w-0 space-y-4 pb-4">
      <div className="app-surface space-y-3 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="min-w-0 flex-1">
            <span className="mb-1 block text-sm font-semibold text-ink-secondary">Exercise</span>
            <select
              className="app-control min-h-11 w-full min-w-0 truncate"
              value={exercise ? String(exercise.content_block_id) : ''}
              onChange={(event) => Number(event.target.value) && onChooseExercise(Number(event.target.value))}
            >
              {!exercise && <option value="">No exercises waiting</option>}
              {exercise && !data.exercises.some((option) => option.content_block_id === exercise.content_block_id) && (
                <option value={exercise.content_block_id}>{exercise.lesson_title} · {exercise.title} (0)</option>
              )}
              {data.exercises.map((option) => (
                <option key={option.content_block_id} value={option.content_block_id}>
                  {option.module_name} · {option.lesson_title}{option.title !== option.lesson_title ? ` · ${option.title}` : ''} ({option.waiting})
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void load()} disabled={loading || approving}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
              Refresh
            </Button>
          </div>
        </div>
        {exercise && (
          <p className="text-sm text-ink-secondary">
            <span className="tabular-nums">{data.total_count} waiting</span>
            {data.total_count > submissions.length && <span className="tabular-nums"> · showing the oldest {submissions.length}</span>}
            {' · '}Grading scale: {scale === 'pass_redo' ? 'Pass / Redo' : 'A / B / C / Redo'}
            {runnerChecks.length > 0 && <> · {runnerChecks.length} automated {runnerChecks.length === 1 ? 'check' : 'checks'} run in your browser</>}
          </p>
        )}
      </div>

      {skipped.length > 0 && (
        <div role="status" className="space-y-1 rounded-2xl border border-warning-line bg-warning-soft px-4 py-3 text-sm text-warning-ink">
          <p className="font-semibold">{skipped.length} {skipped.length === 1 ? 'submission was' : 'submissions were'} skipped</p>
          <ul className="list-disc space-y-0.5 pl-5">
            {skipped.map((item) => (
              <li key={item.submission_id} className="[overflow-wrap:anywhere]">{nameFor(item.submission_id) || `Submission #${item.submission_id}`}: {item.reason}</li>
            ))}
          </ul>
        </div>
      )}

      {!exercise ? (
        <EmptyState icon={CheckCheck} title="Nothing waiting for review" description="New work appears here as students submit it." />
      ) : exercise.has_rubric ? (
        <div className="app-surface flex flex-col items-start gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2.5">
            <ClipboardCheck className="mt-0.5 h-5 w-5 shrink-0 text-ink-muted" aria-hidden="true" />
            <p className="text-sm text-ink-secondary">Exercises with a rubric are graded individually so you can rate each criterion.</p>
          </div>
          <Button variant="secondary" onClick={onExit}>Back to individual review</Button>
        </div>
      ) : submissions.length === 0 ? (
        <EmptyState icon={CheckCheck} title="Everything here is reviewed" description="Choose another exercise, or go back to individual review." />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-ink-secondary" aria-live="polite">
              {checksRunning ? (
                <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Running checks · {checkedCount} of {submissions.filter(checkable).length} done</span>
              ) : (
                <><span className="tabular-nums">{chosen.length} of {submissions.length}</span> selected</>
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="quiet" size="sm" onClick={() => selectAll(true)} disabled={chosen.length === submissions.length}>Select all</Button>
              <Button variant="quiet" size="sm" onClick={() => selectAll(false)} disabled={!chosen.length}>Clear selection</Button>
            </div>
          </div>
          <ul className="space-y-3" aria-label={`${submissions.length} submissions on ${exercise.title}`}>
            {submissions.map((submission) => (
              <BatchCard
                key={submission.id}
                submission={submission}
                scale={scale}
                checkState={checkable(submission) ? checks[submission.id] : undefined}
                hasRunnerChecks={runnerChecks.length > 0}
                selected={selected.has(submission.id)}
                disabled={approving}
                showCohort={!cohortId}
                onToggle={(value) => toggle(submission.id, value)}
                onOpen={() => onOpenReview(submission.id)}
              />
            ))}
          </ul>
          <div className="sticky bottom-[calc(4.25rem+1px+env(safe-area-inset-bottom,0px))] z-10 lg:bottom-3 [html[data-keyboard=open]_&]:bottom-0">
            <div className="flex flex-col gap-2 rounded-2xl border border-line bg-surface-raised p-3 shadow-lg sm:flex-row sm:items-center">
              <label className="min-w-0 flex-1">
                <span className="sr-only">Feedback for every approved submission (optional)</span>
                <input
                  value={feedback}
                  onChange={(event) => setFeedback(event.target.value)}
                  disabled={approving}
                  placeholder="Feedback for everyone (optional), e.g. Nice work!"
                  className="app-control min-h-11 w-full"
                />
              </label>
              <Button onClick={() => void approve()} disabled={!chosen.length || approving} className="w-full sm:w-auto">
                {approving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
                {approving ? 'Approving…' : `Approve selected as ${gradeName} (${chosen.length})`}
              </Button>
            </div>
          </div>
        </>
      )}
    </section>
  )
}

function BatchCard({
  submission,
  scale,
  checkState,
  hasRunnerChecks,
  selected,
  disabled,
  showCohort,
  onToggle,
  onOpen,
}: {
  submission: BatchReviewSubmission
  scale: string
  checkState: CheckState | undefined
  hasRunnerChecks: boolean
  selected: boolean
  disabled: boolean
  showCohort: boolean
  onToggle: (value: boolean) => void
  onOpen: () => void
}) {
  const suggestionBadge = submission.grade_suggestion ? gradeSuggestionQueueBadge(submission.grade_suggestion, scale) : null
  const run = checkState?.status === 'done' ? checkState.run : null
  const links = [
    ['Repository', submission.repo_url],
    ['GitHub code', submission.github_code_url],
    ['Pull request', submission.pr_url],
    ['Live site', submission.live_url],
  ].filter((item): item is [string, string] => Boolean(item[1]))
  const checkboxId = `batch-select-${submission.id}`

  return (
    <li
      data-batch-submission={submission.id}
      data-batch-selected={selected ? 'true' : 'false'}
      className={`min-w-0 rounded-2xl border bg-surface-raised p-4 transition-colors duration-150 ${selected ? 'border-info-line' : 'border-line'}`}
    >
      <div className="flex min-w-0 items-start gap-3">
        <label htmlFor={checkboxId} className="-m-2 flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center">
          <input
            id={checkboxId}
            type="checkbox"
            checked={selected}
            disabled={disabled}
            onChange={(event) => onToggle(event.target.checked)}
            aria-label={`Select ${submission.user_name}`}
            className="size-5 accent-action-primary"
          />
        </label>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h3 className="min-w-0 break-words font-bold text-ink">
              <RecordLink record={{ type: 'student', id: submission.user_id, cohortId: submission.cohort_id ?? undefined }} variant="plain" touchTarget>{submission.user_name}</RecordLink>
            </h3>
            <span className="text-xs tabular-nums text-ink-muted">
              Attempt {submission.num_submissions}
              {showCohort && submission.cohort_name && submission.cohort_id && (
                <> · <RecordLink record={{ type: 'cohort', id: submission.cohort_id }} variant="plain" touchTarget className="font-normal text-ink-muted">{submission.cohort_name}</RecordLink></>
              )}
            </span>
            <span className={`inline-flex items-center gap-1 text-xs font-semibold tabular-nums ${waitingTooLong(submission.created_at) ? 'text-danger-ink' : 'text-ink-muted'}`}>
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="sr-only">Waiting </span>{waitingLabel(submission.created_at)}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {suggestionBadge && <Badge tone={suggestionBadge.tone}><GitCommitHorizontal className="h-3.5 w-3.5" aria-hidden="true" />{suggestionBadge.label}</Badge>}
            {checkState?.status === 'queued' && <Badge tone="neutral"><ListChecks className="h-3.5 w-3.5" aria-hidden="true" />Checks queued</Badge>}
            {checkState?.status === 'running' && <Badge tone="pending"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />Running checks</Badge>}
            {run && (
              <Badge tone={run.failed === 0 ? 'success' : 'danger'}>
                {run.failed === 0 ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : <XCircle className="h-3.5 w-3.5" aria-hidden="true" />}
                {codeChecksSummary(run)}
              </Badge>
            )}
            {!checkState && !suggestionBadge && <Badge tone="neutral">{hasRunnerChecks ? 'Nothing to check' : 'No automated checks'}</Badge>}
          </div>
          {submission.text ? (
            <pre
              tabIndex={0}
              aria-label={`${submission.user_name}'s submission`}
              className="max-h-56 overflow-auto rounded-xl border border-code-line bg-code-bg p-3 font-mono text-xs leading-5 text-code-ink"
            >{submission.text}</pre>
          ) : (
            <p className="text-sm text-ink-muted">No inline code. Open the links or the full review.</p>
          )}
          {(links.length > 0 || submission.commit_sha) && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {links.map(([label, url]) => (
                <a key={label} href={sanitizeUrl(url)} target="_blank" rel="noopener noreferrer" className="app-link inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-line px-3">
                  {label}
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              ))}
              {submission.commit_sha && <span className="font-mono text-xs text-ink-muted">{submission.commit_sha.slice(0, 7)}</span>}
            </div>
          )}
          {run && run.failed > 0 && (
            <details className="text-xs">
              <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-ink-secondary">Check details</summary>
              <CodeChecksList run={run} />
            </details>
          )}
          <div className="flex justify-end">
            <Button variant="secondary" size="sm" onClick={onOpen}>
              <SquareArrowOutUpRight className="h-4 w-4" aria-hidden="true" />
              Open full review
            </Button>
          </div>
        </div>
      </div>
    </li>
  )
}
