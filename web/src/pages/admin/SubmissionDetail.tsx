import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, BookOpen, CheckCircle2, ExternalLink, FileCheck2, GitBranch, MessageSquareText, RefreshCw, RotateCcw, UserRound } from 'lucide-react'
import { api } from '../../lib/api'
import { cohortPath, cohortStudentPath, safeInternalReturnPath } from '../../lib/routes'
import { formatShortDateTime } from '../../lib/format'
import { sanitizeUrl } from '../../lib/sanitizeUrl'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/shared/EmptyState'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { CodeEditor, detectLanguage } from '../../components/shared/CodeEditor'
import { GradeDisplay } from '../../components/shared/GradeDisplay'
import { useToast } from '../../contexts/ToastContext'
import type { RubricRating, Submission } from '../../types/api'

export function SubmissionDetail() {
  const { id } = useParams<{ id: string }>()
  const submissionId = Number(id)
  const [searchParams] = useSearchParams()
  const requestedCohortId = Number(searchParams.get('cohort_id')) || null
  const requestedStudentId = Number(searchParams.get('student_id')) || null
  const navigate = useNavigate()
  const toast = useToast()
  const [submission, setSubmission] = useState<Submission | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState('')
  const [criterionResults, setCriterionResults] = useState<Record<number, { rating: RubricRating | null; feedback: string }>>({})
  const [grading, setGrading] = useState(false)
  const [openingMessage, setOpeningMessage] = useState(false)
  const [validatedCohortId, setValidatedCohortId] = useState<number | null>(null)

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
    let nextCohortId: number | null = null
    if (requestedCohortId && (!requestedStudentId || requestedStudentId === next.user_id)) {
      const progressResult = await api.getStudentProgress(next.user_id, requestedCohortId)
      const cohortBlockIds = new Set(progressResult.data?.modules.flatMap((mod) => mod.lessons.flatMap((lesson) => lesson.blocks.map((block) => block.id))) || [])
      if (cohortBlockIds.has(next.content_block_id)) nextCohortId = requestedCohortId
    }
    setSubmission(next)
    setValidatedCohortId(nextCohortId)
    setFeedback(next.feedback || '')
    setCriterionResults(Object.fromEntries((next.rubric?.criteria || []).map((criterion) => [criterion.id, { rating: criterion.rating || null, feedback: criterion.feedback || '' }])))
    setLoading(false)
  }, [requestedCohortId, requestedStudentId, submissionId])

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
  }

  async function openMessage() {
    if (!submission || !validatedCohortId) return
    setOpeningMessage(true)
    const result = await api.createDirectConversation({ cohort_id: validatedCohortId, user_ids: [submission.user_id] })
    setOpeningMessage(false)
    if (result.data) navigate(`/messages/dm/${result.data.direct_conversation.id}`)
    else toast.error(result.error || 'Could not open a direct message.')
  }

  if (loading) return <LoadingSpinner message="Loading submission record…" />
  if (!submission || error) return <div className="app-page"><EmptyState icon={FileCheck2} title="Could not open this submission" description={error || 'The submission was not found.'} action={<Button onClick={() => void load()}><RefreshCw className="h-4 w-4" />Try again</Button>} /></div>

  const studentPath = validatedCohortId ? cohortStudentPath(validatedCohortId, submission.user_id, 'work') : `/admin/students/${submission.user_id}`
  const returnFallback = validatedCohortId ? studentPath : '/admin/grading'
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
        {validatedCohortId && <><span className="text-slate-300">/</span><Link className="app-link px-1" to={cohortPath(validatedCohortId)}>Cohort</Link></>}
        <span className="text-slate-300">/</span><Link className="app-link px-1" to={studentPath}>{submission.user_name}</Link>
        <span className="text-slate-300">/</span><span className="px-1 text-slate-700">Submission #{submission.id}</span>
      </nav>

      <header className="app-surface p-5 sm:p-6">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <div>
            <p className="app-eyebrow">Submission record</p>
            <h1 className="app-title mt-2">{submission.content_block_title}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-500">
              <Link className="app-link inline-flex items-center gap-1 font-bold" to={studentPath}><UserRound className="h-4 w-4" />{submission.user_name}</Link>
              <span className="inline-flex items-center gap-1"><BookOpen className="h-4 w-4" />{submission.module_name} · {submission.lesson_title}</span>
              <span>Attempt {submission.num_submissions}</span>
              <span>{formatShortDateTime(submission.created_at)}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {submission.grade ? <GradeDisplay grade={submission.grade} size="md" /> : <span className="rounded-full bg-amber-50 px-3 py-1.5 text-sm font-bold text-amber-800">Ungraded</span>}
            {validatedCohortId && <Button variant="secondary" onClick={() => void openMessage()} disabled={openingMessage}><MessageSquareText className="h-4 w-4" />{openingMessage ? 'Opening…' : 'Message student'}</Button>}
          </div>
        </div>
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
        <main className="space-y-6">
          <section className="app-surface p-5 sm:p-6">
            <h2 className="text-lg font-extrabold text-slate-950">Student submission</h2>
            {submission.text ? <div className="mt-4"><CodeEditor value={submission.text} language={language} readOnly minHeight={280} /></div> : <p className="mt-4 text-sm italic text-slate-500">No text or code was submitted.</p>}
            {submission.notes && <div className="mt-4 rounded-xl bg-slate-50 p-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Student notes</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{submission.notes}</p></div>}
          </section>

          {artifactLinks.length > 0 && <section className="app-surface p-5 sm:p-6"><h2 className="text-lg font-extrabold text-slate-950">Related artifacts</h2><div className="mt-4 grid gap-2 sm:grid-cols-2">{artifactLinks.map(([label, url]) => <a key={label} href={sanitizeUrl(url)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 hover:border-primary-300 hover:text-primary-700"><span className="inline-flex items-center gap-2"><GitBranch className="h-4 w-4" />{label}</span><ExternalLink className="h-4 w-4" /></a>)}</div></section>}

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
    </div>
  )
}
