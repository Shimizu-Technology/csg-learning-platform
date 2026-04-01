import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Filter, Check, RotateCcw, Clock, ChevronRight } from 'lucide-react'
import { api } from '../../lib/api'
import { GradeDisplay } from '../../components/shared/GradeDisplay'
import { CodeEditor, detectLanguage } from '../../components/shared/CodeEditor'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { EmptyState } from '../../components/shared/EmptyState'

type QueueFilter = 'ungraded' | 'redo' | 'all'

interface SubmissionItem {
  id: number
  content_block_id: number
  user_id: number
  user_name: string
  text: string
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
  language_hint?: string | null
}

export function Grading() {
  const [submissions, setSubmissions] = useState<SubmissionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [queueFilter, setQueueFilter] = useState<QueueFilter>('ungraded')
  const [selectedSubmission, setSelectedSubmission] = useState<SubmissionItem | null>(null)
  const [feedback, setFeedback] = useState('')
  const [grading, setGrading] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)

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
    api.getSubmissions().then((res) => {
      if (res.data?.submissions) setSubmissions(res.data.submissions)
      setLoading(false)
    })
  }

  useEffect(() => {
    loadSubmissions()
  }, [])

  const selectSubmission = async (submission: SubmissionItem) => {
    setLoadingDetail(true)
    const res = await api.getSubmission(submission.id)
    const fullSubmission = res.data?.submission || submission
    setSelectedSubmission(fullSubmission)
    setFeedback(fullSubmission.feedback || '')
    setLoadingDetail(false)
  }

  const handleGrade = async (grade: string) => {
    if (!selectedSubmission) return
    setGrading(true)
    const res = await api.gradeSubmission(selectedSubmission.id, { grade, feedback })
    if (!res.error) {
      setSelectedSubmission(null)
      setFeedback('')
      loadSubmissions()
    }
    setGrading(false)
  }

  if (loading) return <LoadingSpinner message="Loading submissions..." />

  return (
    <div className="space-y-6">
      <div>
        <Link to="/admin" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-2">
          <ArrowLeft className="h-4 w-4" />
          Admin Dashboard
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">Grading</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <button
          onClick={() => setQueueFilter('ungraded')}
          className={`rounded-xl border p-4 text-left transition-all ${queueFilter === 'ungraded' ? 'border-primary-300 bg-primary-50' : 'border-slate-200 bg-white hover:border-primary-200'}`}
        >
          <div className="flex items-center gap-2 text-slate-500 text-sm font-medium">
            <Filter className="h-4 w-4" />
            Ungraded Queue
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-900">{counts.ungraded}</p>
        </button>
        <button
          onClick={() => setQueueFilter('redo')}
          className={`rounded-xl border p-4 text-left transition-all ${queueFilter === 'redo' ? 'border-orange-300 bg-orange-50' : 'border-slate-200 bg-white hover:border-orange-200'}`}
        >
          <div className="flex items-center gap-2 text-slate-500 text-sm font-medium">
            <RotateCcw className="h-4 w-4" />
            Redo Requested
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-900">{counts.redo}</p>
        </button>
        <button
          onClick={() => setQueueFilter('all')}
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
                <button
                  key={sub.id}
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
                    <CodeEditor
                      value={selectedSubmission.text}
                      language={detectLanguage(selectedSubmission.filename, selectedSubmission.language_hint)}
                      readOnly
                      minHeight={220}
                    />
                  ) : (
                    <p className="text-sm text-slate-400 italic">No code submitted</p>
                  )}
                </div>

                {selectedSubmission.solution && (
                  <div>
                    <h4 className="text-sm font-medium text-slate-700 mb-2">Solution</h4>
                    <CodeEditor
                      value={selectedSubmission.solution}
                      language={detectLanguage(selectedSubmission.filename, selectedSubmission.language_hint)}
                      readOnly
                      minHeight={180}
                    />
                  </div>
                )}

                <div>
                  <label className="text-sm font-medium text-slate-700">Feedback</label>
                  <textarea
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    placeholder="Feedback for the student..."
                    className="mt-1 w-full rounded-lg border border-slate-200 p-3 text-sm resize-y min-h-[100px] focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
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
