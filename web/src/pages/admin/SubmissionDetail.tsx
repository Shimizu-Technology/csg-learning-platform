import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, BookOpen, CheckCircle2, ChevronLeft, ChevronRight, ExternalLink, FileCheck2, GitBranch, MessageSquareText, RefreshCw, RotateCcw, UserRound } from 'lucide-react'
import { api } from '../../lib/api'
import { cohortPath, cohortStudentPath, directMessagePath, safeInternalReturnPath, submissionPath } from '../../lib/routes'
import { orderSubmissionQueue, type SubmissionQueueFilter } from '../../lib/submissionQueue'
import { formatShortDateTime } from '../../lib/format'
import { sanitizeUrl } from '../../lib/sanitizeUrl'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/shared/EmptyState'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { CodeEditor, detectLanguage } from '../../components/shared/CodeEditor'
import { GradeDisplay } from '../../components/shared/GradeDisplay'
import { useToast } from '../../contexts/ToastContext'
import { StudentContextDrawer } from '../../components/admin/StudentContextDrawer'
import type { RubricRating, StudentProgressResponse, Submission } from '../../types/api'

interface ValidatedWorkspaceContext {
  cohortId: number
  cohortName: string
  evidenceScope?: StudentProgressResponse['learning_evidence_scope']
}

type SubmissionQueue = SubmissionQueueFilter

export function SubmissionDetail() {
  const { id } = useParams<{ id: string }>()
  const submissionId = Number(id)
  const [searchParams] = useSearchParams()
  const requestedCohortId = Number(searchParams.get('cohort_id')) || null
  const requestedStudentId = Number(searchParams.get('student_id')) || null
  const queueMode = (['ungraded', 'redo', 'all'] as const).includes(searchParams.get('queue') as SubmissionQueue) ? searchParams.get('queue') as SubmissionQueue : null
  const navigate = useNavigate()
  const toast = useToast()
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
      const queueResult = await api.getSubmissions()
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
  }, [queueMode, requestedCohortId, requestedStudentId, submissionId])

  useEffect(() => { void load() }, [load])

  const language = useMemo(() => submission ? detectLanguage(submission.filename, submission.language_hint) : 'ruby', [submission])

  async function grade(gradeValue: string) {
    if (!submission) return
    if (submission.rubric?.criteria.some((criterion) => !criterionResults[criterion.id]?.rating)) {
      toast.error('Rate every rubric criterion before grading.')
      return
    }
    setGrading(true)
    const result = await api.gradeSubmission(submission.id, {
      grade: gradeValue,
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
      return
    }
    setSubmission(result.data.submission)
    toast.success(`Submission graded ${gradeValue}.`)
    if (queueMode === 'ungraded' && queueContext?.nextId) navigate(submissionPath(queueContext.nextId, { returnTo: searchParams.get('return_to') || '/admin/grading?filter=ungraded', queue: queueMode }))
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
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm font-semibold text-slate-500">
        <Link to={returnTo} className="app-link inline-flex min-h-11 items-center gap-1 px-1"><ArrowLeft className="h-4 w-4" />Back</Link>
        {validatedContext && <><span className="text-slate-300">/</span><Link className="app-link px-1" to={cohortPath(validatedContext.cohortId)}>Workspace: {validatedContext.cohortName}</Link></>}
        <span className="text-slate-300">/</span><Link className="app-link px-1" to={studentPath}>{submission.user_name}</Link>
        <span className="text-slate-300">/</span><span className="px-1 text-slate-700">Submission #{submission.id}</span>
      </nav>

      {queueContext && <div className="app-surface flex flex-wrap items-center justify-between gap-3 px-4 py-3"><p className="text-xs font-extrabold uppercase tracking-wide text-slate-500">{queueMode} queue · {queueContext.position} of {queueContext.total}</p><div className="flex gap-2"><QueueLink label="Previous" submissionId={queueContext.previousId} returnTo={returnTo} queue={queueMode!} icon="previous" /><QueueLink label="Next" submissionId={queueContext.nextId} returnTo={returnTo} queue={queueMode!} icon="next" /></div></div>}

      <header className="app-surface p-5 sm:p-6">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <div>
            <p className="app-eyebrow">Submission record</p>
            <h1 className="app-title mt-2">{submission.content_block_title}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-500">
              {validatedContext ? <button type="button" onClick={() => setShowStudentContext(true)} className="app-link inline-flex min-h-11 items-center gap-1 font-bold"><UserRound className="h-4 w-4" />{submission.user_name}</button> : <Link className="app-link inline-flex items-center gap-1 font-bold" to={studentPath}><UserRound className="h-4 w-4" />{submission.user_name}</Link>}
              <span className="inline-flex items-center gap-1"><BookOpen className="h-4 w-4" />{submission.module_name} · {submission.lesson_title}</span>
              <span>Attempt {submission.num_submissions}</span>
              <span>{formatShortDateTime(submission.created_at)}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {submission.grade ? <GradeDisplay grade={submission.grade} size="md" /> : <span className="rounded-full bg-amber-50 px-3 py-1.5 text-sm font-bold text-amber-800">Ungraded</span>}
            {validatedContext && <Button variant="secondary" onClick={() => setShowStudentContext(true)}><UserRound className="h-4 w-4" />Student context</Button>}
            {validatedContext && <Button variant="secondary" onClick={() => void openMessage()} disabled={openingMessage}><MessageSquareText className="h-4 w-4" />{openingMessage ? 'Opening…' : `Message in ${validatedContext.cohortName}`}</Button>}
          </div>
        </div>
        {validatedContext?.evidenceScope?.shared_across_enrollments && <div className="mt-5 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-950"><span className="font-extrabold">Curriculum evidence:</span> this submission follows the learner across enrollments using {validatedContext.evidenceScope.curriculum_name}. The selected workspace and message action are scoped to {validatedContext.cohortName}.</div>}
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
        <main className="space-y-6">
          <section className="app-surface p-5 sm:p-6">
            <h2 className="text-lg font-extrabold text-slate-950">Student submission</h2>
            {submission.text ? <div className="mt-4"><CodeEditor value={submission.text} language={language} readOnly minHeight={280} /></div> : <p className="mt-4 text-sm italic text-slate-500">No text or code was submitted.</p>}
            {submission.notes && <div className="mt-4 rounded-xl bg-slate-50 p-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Student notes</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{submission.notes}</p></div>}
          </section>

          {artifactLinks.length > 0 && <section className="app-surface p-5 sm:p-6"><h2 className="text-lg font-extrabold text-slate-950">Related artifacts</h2><div className="mt-4 grid gap-2 sm:grid-cols-2">{artifactLinks.map(([label, url]) => <a key={label} href={sanitizeUrl(url)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 hover:border-primary-300 hover:text-primary-700"><span className="inline-flex items-center gap-2"><GitBranch className="h-4 w-4" />{label}</span><ExternalLink className="h-4 w-4" /></a>)}</div></section>}

          {(submission.repo_url || submission.pr_url || submission.github_code_url) && <section className="app-surface p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="app-eyebrow">Automated evidence</p>
                <h2 className="mt-1 text-lg font-extrabold text-slate-950">GitHub checks</h2>
                <p className="mt-1 text-sm leading-6 text-slate-500">Persisted check status for the exact commit attached to this submission. Check output and logs are never copied into the learning platform.</p>
              </div>
              <Button variant="secondary" onClick={() => void refreshGithubChecks()} disabled={refreshingChecks || !submission.commit_sha}>
                <RefreshCw className={`h-4 w-4 ${refreshingChecks ? 'animate-spin' : ''}`} />{refreshingChecks ? 'Refreshing…' : 'Refresh checks'}
              </Button>
            </div>
            {!submission.commit_sha ? <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"><span className="font-extrabold">Commit needed.</span> Sync or save a commit SHA on this submission before refreshing its checks.</div> : <GithubChecksPanel checks={submission.github_checks} />}
          </section>}

          {submission.solution && <details className="app-surface p-5 sm:p-6"><summary className="min-h-11 cursor-pointer font-extrabold text-slate-900">Reference solution</summary><div className="mt-4"><CodeEditor value={submission.solution} language={language} readOnly minHeight={220} /></div></details>}
        </main>

        <aside className="app-surface self-start p-5 sm:p-6 xl:sticky xl:top-20">
          <h2 className="text-lg font-extrabold text-slate-950">Review and feedback</h2>
          {submission.grade === 'R' && submission.feedback && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900"><p className="font-bold">Current redo feedback</p><p className="mt-1 whitespace-pre-wrap">{submission.feedback}</p></div>}

          {submission.rubric && <div className="mt-5 space-y-4"><div><p className="text-xs font-bold uppercase tracking-wide text-green-700">Rubric</p><p className="mt-1 font-extrabold text-slate-900">{submission.rubric.title}</p></div>{submission.rubric.criteria.map((criterion) => <div key={criterion.id} className="rounded-xl border border-slate-200 p-3"><p className="text-sm font-extrabold text-slate-900">{criterion.title}</p><p className="mt-1 text-xs leading-5 text-slate-500">{criterion.description}</p><div className="mt-3 grid grid-cols-2 gap-2">{([['exceeds', 'Exceeds'], ['meets', 'Meets'], ['developing', 'Developing'], ['redo', 'Revision']] as Array<[RubricRating, string]>).map(([rating, label]) => <button key={rating} type="button" onClick={() => setCriterionResults((current) => ({ ...current, [criterion.id]: { rating, feedback: current[criterion.id]?.feedback || '' } }))} className={`min-h-11 rounded-xl border px-2 text-xs font-bold ${criterionResults[criterion.id]?.rating === rating ? 'border-green-500 bg-green-50 text-green-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{label}</button>)}</div><textarea aria-label={`Feedback for ${criterion.title}`} value={criterionResults[criterion.id]?.feedback || ''} onChange={(event) => setCriterionResults((current) => ({ ...current, [criterion.id]: { rating: current[criterion.id]?.rating || null, feedback: event.target.value } }))} placeholder="Optional criterion feedback" className="mt-2 min-h-20 w-full rounded-xl border border-slate-300 p-3 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-200" /></div>)}</div>}

          <label htmlFor="submission-feedback" className="mt-5 block text-sm font-extrabold text-slate-900">Overall feedback</label>
          <textarea id="submission-feedback" value={feedback} onChange={(event) => setFeedback(event.target.value)} rows={7} placeholder="Give the student a clear next step…" className="mt-2 w-full rounded-xl border border-slate-300 p-3 text-sm leading-6 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-200" />
          <div className="mt-4 grid grid-cols-2 gap-2">
            {['A', 'B', 'C'].map((gradeValue) => <Button key={gradeValue} variant="secondary" onClick={() => void grade(gradeValue)} disabled={grading}><CheckCircle2 className="h-4 w-4" />Grade {gradeValue}</Button>)}
            <Button variant="danger" onClick={() => void grade('R')} disabled={grading}><RotateCcw className="h-4 w-4" />Request redo</Button>
          </div>
        </aside>
      </div>
      {validatedContext && <StudentContextDrawer open={showStudentContext} cohortId={validatedContext.cohortId} studentId={submission.user_id} source={{ type: 'submission', id: submission.id, label: submission.content_block_title }} onClose={() => setShowStudentContext(false)} />}
    </div>
  )
}

function GithubChecksPanel({ checks }: { checks: Submission['github_checks'] }) {
  if (!checks) return <p className="mt-4 text-sm text-slate-500">Checks have not been fetched for this commit yet.</p>
  const counts = [
    ['Passed', checks.summary.passed, 'text-green-800 bg-green-50 border-green-200'],
    ['Failed', checks.summary.failed, 'text-red-800 bg-red-50 border-red-200'],
    ['Pending', checks.summary.pending, 'text-amber-800 bg-amber-50 border-amber-200'],
    ['Other', checks.summary.neutral, 'text-slate-700 bg-slate-50 border-slate-200'],
  ] as const
  return <div className="mt-4 space-y-4">
    <div className="flex flex-wrap items-center gap-2">
      {counts.map(([label, count, classes]) => <span key={label} className={`rounded-full border px-3 py-1 text-xs font-extrabold ${classes}`}>{count} {label.toLowerCase()}</span>)}
      <span className="text-xs text-slate-500">Commit <span className="font-mono font-bold text-slate-700">{checks.head_sha?.slice(0, 8)}</span>{checks.fetched_at ? ` · refreshed ${formatShortDateTime(checks.fetched_at)}` : ''}</span>
    </div>
    {checks.runs.length ? <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">{checks.runs.map((run) => {
      const detailsUrl = run.details_url ? sanitizeUrl(run.details_url) : null
      const content = <><span className="min-w-0"><span className="block truncate text-sm font-extrabold text-slate-800">{run.name}</span><span className="block truncate text-xs text-slate-500">{run.workflow_name || run.app_slug || 'GitHub'} · {run.status.replaceAll('_', ' ')}</span></span><span className={`rounded-full px-2.5 py-1 text-xs font-extrabold ${run.conclusion === 'success' ? 'bg-green-50 text-green-800' : ['failure', 'timed_out', 'startup_failure', 'action_required'].includes(run.conclusion || '') ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-800'}`}>{run.conclusion?.replaceAll('_', ' ') || 'pending'}</span>{detailsUrl && <ExternalLink className="h-4 w-4 text-slate-400" />}</>
      return detailsUrl ? <a key={run.id} href={detailsUrl} target="_blank" rel="noopener noreferrer" className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-3 py-2 hover:bg-slate-50">{content}</a> : <div key={run.id} className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2">{content}</div>
    })}</div> : <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">GitHub returned no check runs for this commit.</p>}
  </div>
}

function QueueLink({ label, submissionId, returnTo, queue, icon }: { label: string; submissionId: number | null; returnTo: string; queue: SubmissionQueue; icon: 'previous' | 'next' }) {
  const Icon = icon === 'previous' ? ChevronLeft : ChevronRight
  if (!submissionId) return <span className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-slate-200 px-3 text-sm font-bold text-slate-300">{icon === 'previous' && <Icon className="h-4 w-4" />}{label}{icon === 'next' && <Icon className="h-4 w-4" />}</span>
  return <Link to={submissionPath(submissionId, { returnTo, queue })} className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-slate-300 px-3 text-sm font-bold text-slate-700 hover:border-primary-300 hover:text-primary-700">{icon === 'previous' && <Icon className="h-4 w-4" />}{label}{icon === 'next' && <Icon className="h-4 w-4" />}</Link>
}
