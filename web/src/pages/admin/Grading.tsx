import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Filter, Check, RotateCcw, Clock, ChevronRight, Layers3, BookmarkPlus, MessageSquareText, ExternalLink } from 'lucide-react'
import { api } from '../../lib/api'
import { submissionPath } from '../../lib/routes'
import { GradeDisplay } from '../../components/shared/GradeDisplay'
import { CodeEditor, detectLanguage } from '../../components/shared/CodeEditor'
import { CodeRunner } from '../../components/shared/CodeRunner'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { EmptyState } from '../../components/shared/EmptyState'
import { CODE_RUNNER_TIMEOUT_MS, codeRunnerLanguageFromEditor, normalizeCodeRunnerConfig } from '../../lib/codeRunner'
import { useToast } from '../../contexts/ToastContext'
import { appendFeedbackSnippet } from '../../lib/feedbackSnippets'
import type { FeedbackSnippet, Rubric, RubricRating } from '../../types/api'

type QueueFilter = 'ungraded' | 'redo' | 'all'

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

  const latestSubmissionIds = useMemo(() => {
    const latest = new Map<string, number>()
    submissions.forEach((sub) => {
      const key = `${sub.user_id}:${sub.content_block_id}`
      if (!latest.has(key)) latest.set(key, sub.id)
    })
    return new Set(latest.values())
  }, [submissions])

  const queue = useMemo(() => {
    const filtered = submissions.filter((sub) => {
      if (queueFilter === 'ungraded') return sub.grade === null
      if (queueFilter === 'redo') return sub.grade === 'R'
      return true
    })

    return filtered.sort((a, b) => {
      const aLatest = latestSubmissionIds.has(a.id)
      const bLatest = latestSubmissionIds.has(b.id)
      if (aLatest !== bLatest) return aLatest ? -1 : 1
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })
  }, [submissions, queueFilter, latestSubmissionIds])

  const counts = useMemo(() => ({
    ungraded: submissions.filter((s) => s.grade === null).length,
    redo: submissions.filter((s) => s.grade === 'R').length,
    all: submissions.length,
  }), [submissions])

  const loadSubmissions = () => {
    setLoading(true)
    Promise.all([
      api.getSubmissions(),
      api.getCohorts(),
    ]).then(([subRes, cohortRes]) => {
      if (subRes.data?.submissions) setSubmissions(subRes.data.submissions)
      if (cohortRes.data?.cohorts) setCohorts(cohortRes.data.cohorts)
      setLoading(false)
    })
  }

  useEffect(() => {
    loadSubmissions()
    void api.getFeedbackSnippets().then((response) => {
      if (response.data) setFeedbackSnippets(response.data.feedback_snippets)
    })
  }, [])

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

  const activeCohorts = cohorts.filter((c: CohortSummary & { status?: string }) => (c as CohortSummary & { status?: string }).status === 'active' || true)
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
        <Link to="/admin" className="mb-2 inline-flex min-h-11 items-center gap-1 rounded-xl px-2 text-sm font-bold text-slate-500 hover:bg-slate-100 hover:text-slate-900">
          <ArrowLeft className="h-4 w-4" />
          Staff home
        </Link>
        <p className="app-eyebrow">Feedback workflow</p>
        <h1 className="app-title mt-2">Grading inbox</h1>
        <p className="app-description mt-2">Review ungraded work across cohorts, then move through focused module queues.</p>
      </header>

      {/* Quick links to cohort grading */}
      {activeCohorts.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2 mb-3">
            <Layers3 className="h-4 w-4 text-primary-500" />
            Grade by Cohort
          </h2>
          <div className="space-y-2">
            {activeCohorts.map((cohort) => (
              <div key={cohort.id} className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-slate-700 min-w-[140px]">{cohort.name}</span>
                {cohort.modules?.map((mod) => (
                  <Link
                    key={mod.id}
                    to={`/admin/cohorts/${cohort.id}/modules/${mod.id}/grading`}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:border-primary-200 transition-colors"
                  >
                    {mod.name}
                    <ChevronRight className="h-3 w-3 text-slate-400" />
                  </Link>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <button
          onClick={() => chooseFilter('ungraded')}
          className={`rounded-xl border p-4 text-left transition-all ${queueFilter === 'ungraded' ? 'border-primary-300 bg-primary-50' : 'border-slate-200 bg-white hover:border-primary-200'}`}
        >
          <div className="flex items-center gap-2 text-slate-500 text-sm font-medium">
            <Filter className="h-4 w-4" />
            Ungraded Queue
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-900">{counts.ungraded}</p>
        </button>
        <button
          onClick={() => chooseFilter('redo')}
          className={`rounded-xl border p-4 text-left transition-all ${queueFilter === 'redo' ? 'border-orange-300 bg-orange-50' : 'border-slate-200 bg-white hover:border-orange-200'}`}
        >
          <div className="flex items-center gap-2 text-slate-500 text-sm font-medium">
            <RotateCcw className="h-4 w-4" />
            Redo Requested
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-900">{counts.redo}</p>
        </button>
        <button
          onClick={() => chooseFilter('all')}
          className={`rounded-xl border p-4 text-left transition-all ${queueFilter === 'all' ? 'border-slate-400 bg-slate-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}
        >
          <div className="flex items-center gap-2 text-slate-500 text-sm font-medium">
            <Clock className="h-4 w-4" />
            All Submissions
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-900">{counts.all}</p>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-3">
          {queue.length === 0 ? (
            <EmptyState
              icon={Check}
              title={queueFilter === 'ungraded' ? 'All caught up!' : queueFilter === 'redo' ? 'No redo queue' : 'No submissions yet'}
              description={queueFilter === 'ungraded' ? 'No ungraded submissions.' : queueFilter === 'redo' ? 'No redo-requested submissions right now.' : 'No submissions have been made yet.'}
            />
          ) : (
            queue.map((sub) => {
              const isLatest = latestSubmissionIds.has(sub.id)
              return (
                <div key={sub.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-stretch gap-2">
                  <button
                    onClick={() => selectSubmission(sub)}
                    className={`w-full text-left rounded-2xl border p-4 transition-all ${
                    selectedSubmission?.id === sub.id
                      ? 'border-primary-300 bg-primary-50'
                      : sub.grade === 'R'
                      ? 'border-orange-200 bg-orange-50 hover:border-orange-300'
                      : 'border-slate-200 bg-white hover:border-primary-200'
                  }`}
                  >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-slate-900">{sub.user_name}</p>
                        {isLatest ? (
                          <span className="rounded-full bg-primary-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-700">Latest</span>
                        ) : (
                          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">Previous</span>
                        )}
                        {sub.grade === 'R' && (
                          <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-700">Redo</span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{sub.lesson_title} · {sub.content_block_title}</p>
                      <p className="mt-1 text-xs text-slate-400">Submission #{sub.num_submissions} · {new Date(sub.created_at).toLocaleDateString()}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {sub.grade ? <GradeDisplay grade={sub.grade} size="sm" /> : (
                        <span className="text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">Ungraded</span>
                      )}
                      <ChevronRight className="h-4 w-4 text-slate-300" />
                    </div>
                  </div>
                  </button>
                  <Link
                    to={submissionPath(sub.id, { userId: sub.user_id, returnTo: `${location.pathname}${location.search}`, queue: queueFilter })}
                    aria-label={`Open ${sub.user_name}'s submission record`}
                    title="Open submission record"
                    className="inline-flex min-h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:border-primary-300 hover:text-primary-700"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Link>
                </div>
              )
            })
          )}
        </div>

        {selectedSubmission && (
          <div className="rounded-2xl bg-white border border-slate-200 p-6 space-y-4 sticky top-20">
            {loadingDetail ? (
              <LoadingSpinner message="Loading submission..." />
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900">{selectedSubmission.user_name}</h3>
                    <p className="text-sm text-slate-500">{selectedSubmission.lesson_title}</p>
                    <p className="text-xs text-slate-400">{selectedSubmission.content_block_title} · Submission #{selectedSubmission.num_submissions}</p>
                  </div>
                  {selectedSubmission.grade ? <GradeDisplay grade={selectedSubmission.grade} size="md" /> : (
                    <span className="text-xs font-medium text-amber-600 bg-amber-50 px-2 py-1 rounded-full">Ungraded</span>
                  )}
                </div>

                {selectedSubmission.grade === 'R' && selectedSubmission.feedback && (
                  <div className="rounded-xl border border-orange-200 bg-orange-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-orange-700">Current redo feedback</p>
                    <p className="mt-1 text-sm text-orange-900">{selectedSubmission.feedback}</p>
                  </div>
                )}

                <div>
                  <h4 className="text-sm font-medium text-slate-700 mb-2">Student Submission</h4>
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
                    <p className="text-sm text-slate-400 italic">No code submitted</p>
                  )}
                </div>

                {selectedSubmission.solution && (
                  <details className="group">
                    <summary className="cursor-pointer text-sm font-medium text-slate-700 hover:text-slate-900 select-none">
                      Show Solution
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
                  {selectedSubmission.rubric && <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4"><p className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-700">Criterion review</p><h3 className="mt-1 font-extrabold text-slate-950">{selectedSubmission.rubric.title}</h3><div className="mt-4 space-y-3">{selectedSubmission.rubric.criteria.map((criterion) => <div key={criterion.id} className="rounded-xl border border-emerald-100 bg-white p-3"><p className="text-sm font-bold text-slate-900">{criterion.title}</p><p className="mt-1 text-xs leading-5 text-slate-500">{criterion.description}</p><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{([['exceeds', 'Exceeds'], ['meets', 'Meets'], ['developing', 'Developing'], ['redo', 'Revision']] as [RubricRating, string][]).map(([rating, label]) => <button key={rating} type="button" onClick={() => setCriterionResults((current) => ({ ...current, [criterion.id]: { rating, feedback: current[criterion.id]?.feedback || '' } }))} className={`min-h-11 rounded-xl border px-2 text-xs font-bold ${criterionResults[criterion.id]?.rating === rating ? 'border-emerald-500 bg-emerald-100 text-emerald-900' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{label}</button>)}</div><textarea aria-label={`Feedback for ${criterion.title}`} value={criterionResults[criterion.id]?.feedback || ''} onChange={(event) => setCriterionResults((current) => ({ ...current, [criterion.id]: { rating: current[criterion.id]?.rating || null, feedback: event.target.value } }))} placeholder="Optional focused feedback for this criterion" className="mt-2 min-h-20 w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" /></div>)}</div></div>}
                  {feedbackSnippets.length > 0 && <div className="mb-3 rounded-2xl border border-slate-200 bg-slate-50 p-3"><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500"><MessageSquareText className="h-4 w-4" />Reusable snippets</div><div className="mt-2 flex flex-wrap gap-2">{feedbackSnippets.map((snippet) => <button key={snippet.id} type="button" title={snippet.body} onClick={() => applyFeedbackSnippet(snippet)} className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-left text-xs font-bold text-slate-700 hover:border-primary-300 hover:text-primary-700">{snippet.title}</button>)}</div><p className="mt-2 text-xs leading-5 text-slate-500">A snippet is inserted into the draft below. Edit it for this student before grading.</p></div>}
                  <label className="text-sm font-medium text-slate-700">Feedback</label>
                  <textarea
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    placeholder="Feedback for the student..."
                    className="mt-1 w-full rounded-lg border border-slate-200 p-3 text-sm resize-y min-h-[100px] focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                  <button type="button" disabled={!feedback.trim() || savingSnippet} onClick={() => void saveFeedbackSnippet()} className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40"><BookmarkPlus className="h-4 w-4" />{savingSnippet ? 'Saving…' : 'Save draft as reusable snippet'}</button>
                </div>

                <div className="flex flex-wrap gap-2">
                  {['A', 'B', 'C'].map((grade) => (
                    <button
                      key={grade}
                      onClick={() => handleGrade(grade)}
                      disabled={grading}
                      className={`flex-1 rounded-lg py-2.5 text-sm font-semibold transition-colors disabled:opacity-50 ${
                        grade === 'A' ? 'bg-success-500 text-white hover:bg-success-600' :
                        grade === 'B' ? 'bg-blue-500 text-white hover:bg-blue-600' :
                        'bg-amber-500 text-white hover:bg-amber-600'
                      }`}
                    >
                      {grade}
                    </button>
                  ))}
                  <button
                    onClick={() => handleGrade('R')}
                    disabled={grading}
                    className="flex-1 rounded-lg py-2.5 text-sm font-semibold bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-50 transition-colors"
                  >
                    <RotateCcw className="h-4 w-4 inline mr-1" />
                    Redo
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
