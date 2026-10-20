import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Filter, Check, RotateCcw, Clock, ChevronRight, Layers3, BookmarkPlus, MessageSquareText, ExternalLink } from 'lucide-react'
import { api } from '../../lib/api'
import { submissionPath } from '../../lib/routes'
import { getLatestSubmissionIds, orderSubmissionQueue, type SubmissionQueueFilter, submissionWhereLabel } from '../../lib/submissionQueue'
import { GradeDisplay } from '../../components/shared/GradeDisplay'
import { CodeEditor, detectLanguage } from '../../components/shared/CodeEditor'
import { CodeRunner } from '../../components/shared/CodeRunner'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { EmptyState } from '../../components/shared/EmptyState'
import { CODE_RUNNER_TIMEOUT_MS, codeRunnerLanguageFromEditor, normalizeCodeRunnerConfig } from '../../lib/codeRunner'
import { useToast } from '../../contexts/ToastContext'
import { appendFeedbackSnippet } from '../../lib/feedbackSnippets'
import type { FeedbackSnippet, Rubric, RubricRating } from '../../types/api'
import { FeedbackBody, FeedbackFormattingHint } from '../../components/shared/FeedbackBody'
import { StatusBadge } from '../../components/shared/StatusBadge'
import { Avatar } from '../../components/ui/Avatar'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { FilterChip, SegmentButton } from '../../components/ui/Choice'
import { formatShortDateTime } from '../../lib/format'

type QueueFilter = SubmissionQueueFilter

const RUBRIC_RATINGS: [RubricRating, string][] = [['exceeds', 'Exceeds'], ['meets', 'Meets'], ['developing', 'Developing'], ['redo', 'Revision']]

/** Redo is a request for another attempt, not an error: a secondary button with warning tones. */
const REDO_BUTTON_CLASSES = 'border-warning-300! text-warning-800! hover:bg-warning-50!'

interface SubmissionItem {
  id: number
  content_block_id: number
  user_id: number
  user_name: string
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
  solution?: string
  filename?: string | null
  submission_config?: Record<string, unknown>
  language_hint?: string | null
  rubric?: Rubric | null
}

interface CohortSummary {
  id: number
  name: string
  curriculum_name: string
  modules?: { id: number; name: string }[]
}

export function Grading() {
  const toast = useToast()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const cohortId = Number(searchParams.get('cohort_id')) || undefined
  const [submissions, setSubmissions] = useState<SubmissionItem[]>([])
  const [cohorts, setCohorts] = useState<CohortSummary[]>([])
  const [loading, setLoading] = useState(true)
  const queueFilter = (['ungraded', 'redo', 'all'] as const).includes(searchParams.get('filter') as QueueFilter) ? searchParams.get('filter') as QueueFilter : 'ungraded'
  const [selectedSubmission, setSelectedSubmission] = useState<SubmissionItem | null>(null)
  const [feedback, setFeedback] = useState('')
  const [criterionResults, setCriterionResults] = useState<Record<number, { rating: RubricRating | null; feedback: string }>>({})
  const [grading, setGrading] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [feedbackSnippets, setFeedbackSnippets] = useState<FeedbackSnippet[]>([])
  const [savingSnippet, setSavingSnippet] = useState(false)

  const latestSubmissionIds = useMemo(() => getLatestSubmissionIds(submissions), [submissions])
  const queue = useMemo(() => orderSubmissionQueue(submissions, queueFilter), [submissions, queueFilter])

  const counts = useMemo(() => ({
    ungraded: submissions.filter((s) => s.grade === null).length,
    redo: submissions.filter((s) => s.grade === 'R').length,
    all: submissions.length,
  }), [submissions])

  const loadSubmissions = () => {
    setLoading(true)
    setSubmissions([])
    Promise.all([
      api.getSubmissions(cohortId ? { cohort_id: String(cohortId) } : undefined),
      api.getCohorts(),
    ]).then(([subRes, cohortRes]) => {
      if (subRes.data?.submissions) setSubmissions(subRes.data.submissions)
      if (cohortRes.data?.cohorts) setCohorts(cohortRes.data.cohorts)
      setLoading(false)
    })
  }

  useEffect(() => {
    setSelectedSubmission(null)
    loadSubmissions()
    void api.getFeedbackSnippets().then((response) => {
      if (response.data) setFeedbackSnippets(response.data.feedback_snippets)
    })
  }, [cohortId])

  const applyFeedbackSnippet = (snippet: FeedbackSnippet) => {
    setFeedback((current) => appendFeedbackSnippet(current, snippet.body))
    setFeedbackSnippets((current) => current.map((item) => item.id === snippet.id ? { ...item, usage_count: item.usage_count + 1 } : item))
    void api.useFeedbackSnippet(snippet.id)
  }

  const saveFeedbackSnippet = async () => {
    const body = feedback.trim()
    if (!body) return
    setSavingSnippet(true)
    const response = await api.createFeedbackSnippet(body)
    if (response.data) {
      setFeedbackSnippets((current) => [response.data!.feedback_snippet, ...current])
      toast.success('Feedback snippet saved')
    } else {
      toast.error(response.error || 'Could not save feedback snippet')
    }
    setSavingSnippet(false)
  }

  const selectSubmission = async (submission: SubmissionItem) => {
    const nextParams = new URLSearchParams(searchParams)
    nextParams.set('submission', String(submission.id))
    setSearchParams(nextParams, { replace: true })
    setLoadingDetail(true)
    const res = await api.getSubmission(submission.id)
    const fullSubmission = res.data?.submission || submission
    setSelectedSubmission(fullSubmission)
    setFeedback(fullSubmission.feedback || '')
    setCriterionResults(Object.fromEntries((fullSubmission.rubric?.criteria || []).map((criterion) => [criterion.id, { rating: criterion.rating || null, feedback: criterion.feedback || '' }])))
    setLoadingDetail(false)
  }

  useEffect(() => {
    const selectedId = Number(searchParams.get('submission'))
    if (!selectedId || selectedSubmission?.id === selectedId || loading || loadingDetail) return
    const match = submissions.find((submission) => submission.id === selectedId)
    if (match) void selectSubmission(match)
    // selectSubmission deliberately follows URL restoration rather than function identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, loadingDetail, searchParams, selectedSubmission?.id, submissions])

  const chooseFilter = (value: QueueFilter) => {
    const nextParams = new URLSearchParams(searchParams)
    if (value === 'ungraded') nextParams.delete('filter')
    else nextParams.set('filter', value)
    nextParams.delete('submission')
    setSelectedSubmission(null)
    setSearchParams(nextParams)
  }

  const handleGrade = async (grade: string) => {
    if (!selectedSubmission) return
    if (selectedSubmission.rubric?.criteria.some((criterion) => !criterionResults[criterion.id]?.rating)) {
      toast.error('Rate every rubric criterion before grading')
      return
    }
    setGrading(true)
    const res = await api.gradeSubmission(selectedSubmission.id, {
      grade,
      base_submission_updated_at: selectedSubmission.updated_at,
      feedback,
      criterion_results: selectedSubmission.rubric?.criteria.map((criterion) => ({
        rubric_criterion_id: criterion.id,
        rating: criterionResults[criterion.id].rating!,
        feedback: criterionResults[criterion.id].feedback,
      })) || [],
    })
    if (!res.error) {
      setSelectedSubmission(null)
      const nextParams = new URLSearchParams(searchParams)
      nextParams.delete('submission')
      setSearchParams(nextParams, { replace: true })
      setFeedback('')
      loadSubmissions()
      toast.success(`Submission graded ${grade}`)
    } else {
      toast.error(res.error)
    }
    setGrading(false)
  }

  if (loading) return <LoadingSpinner message="Loading submissions..." />

  const activeCohorts = cohorts.filter((c: CohortSummary) => !cohortId || c.id === cohortId)
  const selectedLanguage = selectedSubmission
    ? detectLanguage(selectedSubmission.filename, selectedSubmission.language_hint)
    : 'ruby'
  const selectedRunnerConfig = selectedSubmission
    ? normalizeCodeRunnerConfig(
        selectedSubmission.submission_config,
        codeRunnerLanguageFromEditor(selectedLanguage) || 'ruby'
      )
    : null

  return (
    <div className="app-page-wide">
      <header>
        <Link to="/admin" className="mb-2 inline-flex min-h-11 items-center gap-1 rounded-xl px-2 text-sm font-semibold text-ink-muted transition-colors duration-150 hover:bg-surface-sunken hover:text-ink">
          <ArrowLeft className="h-4 w-4" />
          Staff home
        </Link>
        <p className="app-eyebrow">Feedback workflow</p>
        <h1 className="app-title mt-2">Grading inbox</h1>
        <p className="app-description mt-2">{cohortId ? 'Review work for this cohort, then move through focused module queues.' : 'Review ungraded work across cohorts, then move through focused module queues.'}</p>
      </header>

      {/* Quick links to cohort grading */}
      {activeCohorts.length > 0 && (
        <div className="app-surface p-4">
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-ink">
            <Layers3 className="h-4 w-4 text-ink-muted" />
            Grade by cohort
          </h2>
          <div className="space-y-2">
            {activeCohorts.map((cohort) => (
              <div key={cohort.id} className="flex flex-wrap items-center gap-2">
                <span className="min-w-[140px] max-w-full truncate text-sm font-semibold text-ink-secondary" title={cohort.name}>{cohort.name}</span>
                {cohort.modules?.map((mod) => (
                  <Link
                    key={mod.id}
                    to={`/admin/cohorts/${cohort.id}/modules/${mod.id}/grading`}
                    className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-line bg-surface-raised px-3 py-1.5 text-xs font-semibold text-ink-secondary transition-colors duration-150 hover:border-line-strong hover:bg-surface-sunken hover:text-ink lg:min-h-9"
                  >
                    {mod.name}
                    <ChevronRight className="h-3 w-3 text-ink-muted" />
                  </Link>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      <div role="group" aria-label="Submission queue" className="flex flex-wrap gap-2">
        <FilterChip selected={queueFilter === 'ungraded'} count={counts.ungraded} onClick={() => chooseFilter('ungraded')}>
          <Filter className="h-4 w-4" aria-hidden="true" />
          Ungraded queue
        </FilterChip>
        <FilterChip selected={queueFilter === 'redo'} count={counts.redo} onClick={() => chooseFilter('redo')}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Redo requested
        </FilterChip>
        <FilterChip selected={queueFilter === 'all'} count={counts.all} onClick={() => chooseFilter('all')}>
          <Clock className="h-4 w-4" aria-hidden="true" />
          All submissions
        </FilterChip>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="min-w-0 space-y-2">
          {queue.length === 0 ? (
            <EmptyState
              icon={Check}
              title={queueFilter === 'ungraded' ? 'All caught up!' : queueFilter === 'redo' ? 'No redo queue' : 'No submissions yet'}
              description={queueFilter === 'ungraded' ? 'No ungraded submissions.' : queueFilter === 'redo' ? 'No redo-requested submissions right now.' : 'No submissions have been made yet.'}
            />
          ) : (
            queue.map((sub) => {
              const isLatest = latestSubmissionIds.has(sub.id)
              const isSelected = selectedSubmission?.id === sub.id
              const where = submissionWhereLabel(sub.lesson_title, sub.content_block_title)
              return (
                <div key={sub.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-stretch gap-2">
                  <button
                    type="button"
                    onClick={() => selectSubmission(sub)}
                    aria-current={isSelected ? 'true' : undefined}
                    className={`pressable flex min-h-11 w-full min-w-0 items-start gap-3 rounded-2xl border p-3 text-left sm:p-4 ${
                      isSelected ? 'nav-selected border-line-strong' : 'border-line bg-surface-raised hover:bg-surface-sunken'
                    }`}
                  >
                    <Avatar name={sub.user_name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink" title={sub.user_name}>{sub.user_name}</p>
                      <p className="mt-0.5 truncate text-xs text-ink-secondary" title={where}>{where}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                        <SubmissionStatus grade={sub.grade} />
                        <Badge tone={isLatest ? 'info' : 'neutral'}>{isLatest ? 'Latest' : 'Previous'}</Badge>
                        <span className="text-xs tabular-nums text-ink-muted">Attempt {sub.num_submissions} · {formatShortDateTime(sub.created_at)}</span>
                      </div>
                    </div>
                    <ChevronRight className="mt-2 hidden h-4 w-4 shrink-0 text-ink-muted sm:block" aria-hidden="true" />
                  </button>
                  <Link
                    to={submissionPath(sub.id, { userId: sub.user_id, returnTo: `${location.pathname}${location.search}`, queue: queueFilter })}
                    aria-label={`Open ${sub.user_name}'s submission record`}
                    title="Open submission record"
                    className="inline-flex h-11 w-11 items-center justify-center self-center rounded-xl text-ink-muted transition-colors duration-150 hover:bg-surface-sunken hover:text-ink"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Link>
                </div>
              )
            })
          )}
        </div>

        {selectedSubmission && (
          <div className="app-surface min-w-0 space-y-4 p-4 sm:p-6 lg:sticky lg:top-20 lg:self-start">
            {loadingDetail ? (
              <LoadingSpinner message="Loading submission..." />
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <Avatar name={selectedSubmission.user_name} size="md" />
                    <div className="min-w-0">
                      <h3 className="truncate text-lg font-bold text-ink" title={selectedSubmission.user_name}>{selectedSubmission.user_name}</h3>
                      <p className="truncate text-sm text-ink-secondary" title={selectedSubmission.lesson_title}>{selectedSubmission.lesson_title}</p>
                      <p className="text-xs tabular-nums text-ink-muted">{selectedSubmission.content_block_title} · Attempt {selectedSubmission.num_submissions}</p>
                    </div>
                  </div>
                  {selectedSubmission.grade ? <GradeDisplay grade={selectedSubmission.grade} size="md" /> : <StatusBadge status="awaiting_review" short />}
                </div>

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
                      <CodeEditor
                        value={selectedSubmission.text}
                        language={selectedLanguage}
                        readOnly
                        minHeight={220}
                      />
                      {selectedRunnerConfig?.enabled && (
                        <CodeRunner
                          code={selectedSubmission.text}
                          language={selectedRunnerConfig.language}
                          timeoutMs={CODE_RUNNER_TIMEOUT_MS}
                        />
                      )}
                    </div>
                  ) : (
                    <p className="text-sm italic text-ink-muted">No code submitted</p>
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

                <div>
                  {selectedSubmission.rubric && <div className="mb-5 rounded-2xl border border-line bg-surface-sunken p-4"><p className="text-xs font-semibold text-ink-muted">Criterion review</p><h3 className="mt-1 text-base font-semibold text-ink">{selectedSubmission.rubric.title}</h3><div className="mt-4 space-y-3">{selectedSubmission.rubric.criteria.map((criterion) => <div key={criterion.id} className="rounded-xl border border-line bg-surface-raised p-3"><p className="text-sm font-semibold text-ink">{criterion.title}</p><p className="mt-1 text-xs leading-5 text-ink-muted">{criterion.description}</p><div role="group" aria-label={`Rating for ${criterion.title}`} className="mt-3 grid grid-cols-2 gap-1 rounded-xl border border-line bg-surface-sunken p-1 sm:grid-cols-4">{RUBRIC_RATINGS.map(([rating, label]) => <SegmentButton key={rating} selected={criterionResults[criterion.id]?.rating === rating} onClick={() => setCriterionResults((current) => ({ ...current, [criterion.id]: { rating, feedback: current[criterion.id]?.feedback || '' } }))}>{label}</SegmentButton>)}</div><textarea aria-label={`Feedback for ${criterion.title}`} value={criterionResults[criterion.id]?.feedback || ''} onChange={(event) => setCriterionResults((current) => ({ ...current, [criterion.id]: { rating: current[criterion.id]?.rating || null, feedback: event.target.value } }))} placeholder="Optional focused feedback for this criterion" className="app-control mt-2 min-h-20 w-full" /></div>)}</div></div>}
                  {feedbackSnippets.length > 0 && <div className="mb-3 rounded-2xl border border-line bg-surface-sunken p-3"><div className="flex items-center gap-2 text-xs font-semibold text-ink-muted"><MessageSquareText className="h-4 w-4" />Reusable snippets</div><div className="mt-2 flex flex-wrap gap-2">{feedbackSnippets.map((snippet) => <Button key={snippet.id} variant="secondary" size="sm" title={snippet.body} onClick={() => applyFeedbackSnippet(snippet)} className="text-left">{snippet.title}</Button>)}</div><p className="mt-2 text-xs leading-5 text-ink-muted">A snippet is inserted into the draft below. Edit it for this student before grading.</p></div>}
                  <label htmlFor="grading-feedback" className="text-sm font-semibold text-ink">Feedback</label>
                  <textarea
                    id="grading-feedback"
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    placeholder="Feedback for the student..."
                    className="app-control mt-1 min-h-[100px] w-full resize-y"
                  />
                  <FeedbackFormattingHint value={feedback} />
                  <Button variant="quiet" size="sm" disabled={!feedback.trim() || savingSnippet} onClick={() => void saveFeedbackSnippet()} className="mt-2"><BookmarkPlus className="h-4 w-4" />{savingSnippet ? 'Saving…' : 'Save draft as reusable snippet'}</Button>
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
                    onClick={() => handleGrade('R')}
                    disabled={grading}
                    className={REDO_BUTTON_CLASSES}
                  >
                    <RotateCcw className="h-4 w-4" />
                    Redo
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** Queue status: awaiting review and redo use the shared learner-status badge; graded work shows its grade. */
function SubmissionStatus({ grade }: { grade: string | null }) {
  if (grade === null) return <StatusBadge status="awaiting_review" short />
  if (grade === 'R') return <StatusBadge status="redo" short />
  return <GradeDisplay grade={grade} size="sm" />
}
