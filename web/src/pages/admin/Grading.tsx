import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Filter, Check, RotateCcw } from 'lucide-react'
import { api } from '../../lib/api'
import { GradeDisplay } from '../../components/shared/GradeDisplay'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { EmptyState } from '../../components/shared/EmptyState'

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
}

export function Grading() {
  const [submissions, setSubmissions] = useState<SubmissionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showUngraded, setShowUngraded] = useState(true)
  const [selectedSubmission, setSelectedSubmission] = useState<SubmissionItem | null>(null)
  const [feedback, setFeedback] = useState('')
  const [grading, setGrading] = useState(false)

  const loadSubmissions = () => {
    setLoading(true)
    const params: Record<string, string> = {}
    if (showUngraded) params.ungraded = 'true'
    api.getSubmissions(params).then((res) => {
      if (res.data?.submissions) setSubmissions(res.data.submissions)
      setLoading(false)
    })
  }

  useEffect(() => {
    loadSubmissions()
  }, [showUngraded])

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

      {/* Filter */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setShowUngraded(!showUngraded)}
          className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
            showUngraded ? 'bg-primary-50 text-primary-700 border border-primary-200' : 'bg-white text-slate-600 border border-slate-200'
          }`}
        >
          <Filter className="h-4 w-4" />
          {showUngraded ? 'Showing Ungraded' : 'Showing All'}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Submissions list */}
        <div className="space-y-3">
          {submissions.length === 0 ? (
            <EmptyState
              icon={Check}
              title={showUngraded ? 'All caught up!' : 'No submissions yet'}
              description={showUngraded ? 'No ungraded submissions.' : 'No submissions have been made yet.'}
            />
          ) : (
            submissions.map((sub) => (
              <button
                key={sub.id}
                onClick={() => {
                  setSelectedSubmission(sub)
                  setFeedback(sub.feedback || '')
                }}
                className={`w-full text-left rounded-2xl border p-4 transition-all ${
                  selectedSubmission?.id === sub.id
                    ? 'border-primary-300 bg-primary-50'
                    : 'border-slate-200 bg-white hover:border-primary-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-900">{sub.user_name}</p>
                  {sub.grade ? <GradeDisplay grade={sub.grade} size="sm" /> : (
                    <span className="text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">Ungraded</span>
                  )}
                </div>
                <p className="mt-1 text-xs text-slate-500">{sub.lesson_title} · {sub.content_block_title}</p>
                <p className="mt-1 text-xs text-slate-400">Submission #{sub.num_submissions} · {new Date(sub.created_at).toLocaleDateString()}</p>
              </button>
            ))
          )}
        </div>

        {/* Grading panel */}
        {selectedSubmission && (
          <div className="rounded-2xl bg-white border border-slate-200 p-6 space-y-4 sticky top-20">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">{selectedSubmission.user_name}</h3>
              <p className="text-sm text-slate-500">{selectedSubmission.lesson_title}</p>
              <p className="text-xs text-slate-400">{selectedSubmission.content_block_title}</p>
            </div>

            {/* Student code */}
            <div>
              <h4 className="text-sm font-medium text-slate-700 mb-2">Student Submission</h4>
              <div className="rounded-xl bg-slate-900 p-4 max-h-64 overflow-y-auto">
                <pre className="text-sm text-slate-100 whitespace-pre-wrap font-mono">
                  {selectedSubmission.text || 'No text submitted'}
                </pre>
              </div>
            </div>

            {/* Solution */}
            {selectedSubmission.solution && (
              <div>
                <h4 className="text-sm font-medium text-slate-700 mb-2">Solution</h4>
                <div className="rounded-xl bg-success-50 border border-success-200 p-4 max-h-64 overflow-y-auto">
                  <pre className="text-sm text-success-900 whitespace-pre-wrap font-mono">
                    {selectedSubmission.solution}
                  </pre>
                </div>
              </div>
            )}

            {/* Feedback */}
            <div>
              <label className="text-sm font-medium text-slate-700">Feedback</label>
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="Optional feedback for the student..."
                className="mt-1 w-full rounded-lg border border-slate-200 p-3 text-sm resize-y min-h-[80px] focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>

            {/* Grade buttons */}
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
          </div>
        )}
      </div>
    </div>
  )
}
