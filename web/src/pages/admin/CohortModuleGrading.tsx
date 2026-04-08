import { useEffect, useMemo, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, RefreshCw, Filter, RotateCcw, Clock, Check, ChevronRight, Github, User, Keyboard } from 'lucide-react'
import { api } from '../../lib/api'
import { sanitizeUrl } from '../../lib/sanitizeUrl'
import { GradeDisplay } from '../../components/shared/GradeDisplay'
import { CodeEditor, detectLanguage } from '../../components/shared/CodeEditor'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { EmptyState } from '../../components/shared/EmptyState'
import { Modal } from '../../components/shared/Modal'
import { MarkdownRenderer } from '../../components/shared/MarkdownRenderer'

type QueueFilter = 'ungraded' | 'redo' | 'all'
type ViewMode = 'students' | 'queue' | 'grid'

interface StudentSummary {
  user_id: number
  full_name: string
  email: string
  github_username: string | null
  total_exercises: number
  submitted: number
  ungraded: number
  graded: number
  redo: number
}

interface SubmissionItem {
  id: number
  content_block_id: number
  user_id: number
  user_name: string
  user_email?: string
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
  filename?: string | null
  language_hint?: string | null
  solution?: string
  exercise_body?: string
  exercise_video_url?: string
  github_issue_url?: string | null
  github_code_url?: string | null
}

interface GitHubIssueData {
  title: string
  body: string
  state: string
  created_at: string
  html_url: string
  comments: Array<{
    id: number
    user: string
    body: string
    created_at: string
    updated_at: string
  }>
}

interface ExerciseInfo {
  id: number
  filename: string | null
  title: string
  release_day: number
  lesson_title: string
}

interface GradingData {
  cohort_id: number
  cohort_name: string
  module_id: number
  module_name: string
  requires_github: boolean
  repository_name: string
  students: StudentSummary[]
  exercises: ExerciseInfo[]
  submissions: SubmissionItem[]
}

export function CohortModuleGrading() {
  const { cohortId, moduleId } = useParams<{ cohortId: string; moduleId: string }>()
  const navigate = useNavigate()
  const [data, setData] = useState<GradingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncingStudentId, setSyncingStudentId] = useState<number | null>(null)
  const [message, setMessage] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [queueFilter, setQueueFilter] = useState<QueueFilter>('ungraded')
  const [selectedStudentId, setSelectedStudentId] = useState<number | null>(null)
  const [selectedSubmission, setSelectedSubmission] = useState<SubmissionItem | null>(null)
  const [feedback, setFeedback] = useState('')
  const [grading, setGrading] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [gridModalSubmission, setGridModalSubmission] = useState<SubmissionItem | null>(null)
  const [gridFeedback, setGridFeedback] = useState('')
  const [gridModalOpen, setGridModalOpen] = useState(false)
  const [gridModalTab, setGridModalTab] = useState<'exercise' | 'answer' | 'solution' | 'feedback' | 'github_issue'>('answer')
  const [githubIssueData, setGithubIssueData] = useState<GitHubIssueData | null>(null)
  const [githubIssueError, setGithubIssueError] = useState<string | null>(null)
  const [loadingGithubIssue, setLoadingGithubIssue] = useState(false)

  const loadData = async () => {
    if (!cohortId || !moduleId) return
    const res = await api.getCohortModuleSubmissions(Number(cohortId), Number(moduleId))
    if (res.data) {
      setData(res.data)
    }
    setLoading(false)
  }

  useEffect(() => {
    loadData()
  }, [cohortId, moduleId])

  const handleSyncAll = async () => {
    if (!cohortId || !moduleId) return
    setSyncing(true)
    setMessage('')
    const res = await api.syncCohortModuleGithub(Number(cohortId), Number(moduleId))
    if (res.error) {
      setMessage(`Sync failed: ${res.error}`)
    } else {
      const synced = res.data?.synced || 0
      const errors = res.data?.errors || []
      setMessage(`Synced ${synced} new submission${synced !== 1 ? 's' : ''}${errors.length > 0 ? ` (${errors.length} error${errors.length !== 1 ? 's' : ''})` : ''}`)
      await loadData()
    }
    setSyncing(false)
  }

  const handleSyncStudent = async (userId: number) => {
    if (!cohortId || !moduleId) return
    setSyncingStudentId(userId)
    setMessage('')
    const res = await api.syncStudentGithub(Number(cohortId), Number(moduleId), userId)
    if (res.error) {
      setMessage(`Sync failed: ${res.error}`)
    } else {
      const synced = res.data?.synced || 0
      const errors = res.data?.errors || []
      setMessage(`Synced ${synced} submission${synced !== 1 ? 's' : ''}${errors.length > 0 ? ` — ${errors.join(', ')}` : ''}`)
      await loadData()
    }
    setSyncingStudentId(null)
  }

  const selectSubmission = async (submission: SubmissionItem) => {
    setLoadingDetail(true)
    const res = await api.getSubmission(submission.id)
    const fullSubmission = res.data?.submission || submission
    setSelectedSubmission(fullSubmission)
    setFeedback(fullSubmission.feedback || '')
    setLoadingDetail(false)
  }

  const gradedSubmissionRef = useRef<number | null>(null)

  const handleGrade = async (grade: string) => {
    if (!selectedSubmission) return
    setGrading(true)
    gradedSubmissionRef.current = selectedSubmission.id
    const res = await api.gradeSubmission(selectedSubmission.id, { grade, feedback })
    if (!res.error) {
      setFeedback('')
      await loadData()
    }
    setGrading(false)
  }

  // Auto-advance to next ungraded submission after data reload
  useEffect(() => {
    if (gradedSubmissionRef.current === null || !data) return
    const justGradedId = gradedSubmissionRef.current
    gradedSubmissionRef.current = null

    const nextUngraded = filteredSubmissions.find(
      (s) => s.id !== justGradedId && s.grade === null && latestSubmissionIds.has(s.id)
    )
    if (nextUngraded) {
      selectSubmission(nextUngraded)
    } else {
      setSelectedSubmission(null)
    }
  }, [data])


  const counts = useMemo(() => {
    if (!data) return { ungraded: 0, redo: 0, all: 0 }
    return {
      ungraded: data.submissions.filter((s) => s.grade === null).length,
      redo: data.submissions.filter((s) => s.grade === 'R').length,
      all: data.submissions.length,
    }
  }, [data])

  const latestSubmissionIds = useMemo(() => {
    if (!data) return new Set<number>()
    const latest = new Map<string, number>()
    data.submissions.forEach((sub) => {
      const key = `${sub.user_id}:${sub.content_block_id}`
      if (!latest.has(key)) latest.set(key, sub.id)
    })
    return new Set(latest.values())
  }, [data])

  const filteredSubmissions = useMemo(() => {
    if (!data) return []
    let filtered = data.submissions

    if (selectedStudentId) {
      filtered = filtered.filter((s) => s.user_id === selectedStudentId)
    }

    if (viewMode === 'queue' || !selectedStudentId) {
      filtered = filtered.filter((sub) => {
        if (queueFilter === 'ungraded') return sub.grade === null
        if (queueFilter === 'redo') return sub.grade === 'R'
        return true
      })
    }

    return filtered.sort((a, b) => {
      const aLatest = latestSubmissionIds.has(a.id)
      const bLatest = latestSubmissionIds.has(b.id)
      if (aLatest !== bLatest) return aLatest ? -1 : 1
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })
  }, [data, queueFilter, selectedStudentId, viewMode, latestSubmissionIds])

  const weekGroups = useMemo(() => {
    if (!data?.exercises) return []
    const groups = new Map<number, ExerciseInfo[]>()
    data.exercises.forEach((ex) => {
      const week = Math.floor(ex.release_day / 7) + 1
      if (!groups.has(week)) groups.set(week, [])
      groups.get(week)!.push(ex)
    })
    return Array.from(groups.entries()).sort(([a], [b]) => a - b)
  }, [data])

  const submissionLookup = useMemo(() => {
    if (!data) return new Map<string, SubmissionItem>()
    const lookup = new Map<string, SubmissionItem>()
    data.submissions.forEach((sub) => {
      const key = `${sub.user_id}:${sub.content_block_id}`
      if (!lookup.has(key)) lookup.set(key, sub)
    })
    return lookup
  }, [data])

  const openGridCell = async (userId: number, exerciseId: number) => {
    const key = `${userId}:${exerciseId}`
    const sub = submissionLookup.get(key)
    if (!sub) return
    setGridModalOpen(true)
    setGridModalSubmission(null)
    setGridModalTab('answer')
    setGithubIssueData(null)
    setGithubIssueError(null)
    const res = await api.getSubmission(sub.id)
    const full = res.data?.submission || sub
    setGridModalSubmission(full)
    setGridFeedback(full.feedback || '')
  }

  const loadGithubIssue = async () => {
    if (!gridModalSubmission || !gridModalSubmission.github_issue_url) return
    setLoadingGithubIssue(true)
    setGithubIssueError(null)
    try {
      const res = await api.getSubmissionGithubIssue(gridModalSubmission.id)
      if (res.data && !res.data.error) {
        setGithubIssueData(res.data)
      } else {
        const msg = res.data?.error || 'Failed to load GitHub issue'
        setGithubIssueError(msg)
        console.error('GitHub issue load failed:', msg)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network request failed'
      setGithubIssueError(msg)
      console.error('GitHub issue request failed:', err)
    } finally {
      setLoadingGithubIssue(false)
    }
  }

  const handleGridGrade = async (grade: string) => {
    if (!gridModalSubmission) return
    setGrading(true)
    const res = await api.gradeSubmission(gridModalSubmission.id, { grade, feedback: gridFeedback })
    if (!res.error) {
      setGridFeedback('')
      setGridModalSubmission(null)
      setGridModalOpen(false)
      await loadData()
    }
    setGrading(false)
  }

  // Keyboard shortcuts for grading (works for both side panel and grid modal)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (grading) return
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return

      const key = e.key.toUpperCase()
      if (!['A', 'B', 'C', 'R'].includes(key)) return

      if (gridModalSubmission) {
        e.preventDefault()
        if (key === 'R' && !gridFeedback.trim()) {
          if (!window.confirm('No feedback written. The student won\'t know what to fix. Grade as Redo without feedback?')) return
        }
        handleGridGrade(key)
      } else if (selectedSubmission && !loadingDetail) {
        e.preventDefault()
        if (key === 'R' && !feedback.trim()) {
          if (!window.confirm('No feedback written. The student won\'t know what to fix. Grade as Redo without feedback?')) return
        }
        handleGrade(key)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [selectedSubmission, gridModalSubmission, grading, loadingDetail, feedback, gridFeedback, handleGridGrade, handleGrade])

  if (loading) return <LoadingSpinner message="Loading grading data..." />
  if (!data) return null

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <h1 className="text-2xl font-bold text-slate-900">
            {data.module_name} — Grading
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {data.cohort_name} · {data.students.length} student{data.students.length !== 1 ? 's' : ''}
          </p>
        </div>

        {data.requires_github && (
          <button
            onClick={handleSyncAll}
            disabled={syncing}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 transition-colors shrink-0"
          >
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing...' : 'Sync All from GitHub'}
          </button>
        )}
      </div>

      {message && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          {message}
        </div>
      )}

      {/* Stats cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <button
          onClick={() => {
            setViewMode('queue'); setQueueFilter('ungraded'); setSelectedStudentId(null)
            const firstUngraded = data.submissions.find((s) => s.grade === null && latestSubmissionIds.has(s.id))
            if (firstUngraded) selectSubmission(firstUngraded); else setSelectedSubmission(null)
          }}
          className={`rounded-xl border p-4 text-left transition-all ${viewMode === 'queue' && queueFilter === 'ungraded' ? 'border-primary-300 bg-primary-50' : 'border-slate-200 bg-white hover:border-primary-200'}`}
        >
          <div className="flex items-center gap-2 text-slate-500 text-sm font-medium">
            <Filter className="h-4 w-4" />
            Ungraded Queue
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-900">{counts.ungraded}</p>
        </button>
        <button
          onClick={() => { setViewMode('queue'); setQueueFilter('redo'); setSelectedStudentId(null); setSelectedSubmission(null) }}
          className={`rounded-xl border p-4 text-left transition-all ${viewMode === 'queue' && queueFilter === 'redo' ? 'border-orange-300 bg-orange-50' : 'border-slate-200 bg-white hover:border-orange-200'}`}
        >
          <div className="flex items-center gap-2 text-slate-500 text-sm font-medium">
            <RotateCcw className="h-4 w-4" />
            Redo Requested
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-900">{counts.redo}</p>
        </button>
        <button
          onClick={() => { setViewMode('queue'); setQueueFilter('all'); setSelectedStudentId(null); setSelectedSubmission(null) }}
          className={`rounded-xl border p-4 text-left transition-all ${viewMode === 'queue' && queueFilter === 'all' ? 'border-slate-400 bg-slate-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}
        >
          <div className="flex items-center gap-2 text-slate-500 text-sm font-medium">
            <Clock className="h-4 w-4" />
            All Submissions
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-900">{counts.all}</p>
        </button>
      </div>

      {/* View toggle */}
      <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 w-fit">
        <button
          onClick={() => { setViewMode('grid'); setSelectedStudentId(null); setSelectedSubmission(null) }}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${viewMode === 'grid' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
        >
          Grid
        </button>
        <button
          onClick={() => { setViewMode('students'); setSelectedStudentId(null); setSelectedSubmission(null) }}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${viewMode === 'students' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
        >
          By Student
        </button>
        <button
          onClick={() => { setViewMode('queue'); setSelectedStudentId(null); setSelectedSubmission(null) }}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${viewMode === 'queue' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
        >
          Queue
        </button>
      </div>

      {/* Grid View */}
      {viewMode === 'grid' && (
        <>
          {/* Legend */}
          <div className="rounded-2xl bg-white border border-slate-200 px-5 py-4">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-600">
              <span className="flex items-center gap-1.5">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-blue-100 text-blue-700 font-bold text-[10px]">+</span>
                Awaiting Review
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-success-100 text-success-700 font-bold text-[10px]">A</span>
                Passing (A, B, C)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-orange-100 text-orange-600 font-bold text-[10px]">R</span>
                Redo
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-slate-100 text-slate-300 font-bold text-[10px]">&mdash;</span>
                Not Submitted
              </span>
            </div>
          </div>

          {weekGroups.map(([week, exercises]) => {
            const pending = exercises.reduce((acc, ex) => acc + data.students.filter((s) => {
              const sub = submissionLookup.get(`${s.user_id}:${ex.id}`)
              return sub && sub.grade === null
            }).length, 0)
            const redos = exercises.reduce((acc, ex) => acc + data.students.filter((s) => {
              const sub = submissionLookup.get(`${s.user_id}:${ex.id}`)
              return sub && sub.grade === 'R'
            }).length, 0)
            const completed = exercises.reduce((acc, ex) => acc + data.students.filter((s) => {
              const sub = submissionLookup.get(`${s.user_id}:${ex.id}`)
              return sub && sub.grade && sub.grade !== 'R'
            }).length, 0)

            return (
              <div key={week} className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-slate-900">Week {week}</h3>
                  <div className="flex items-center gap-3 text-xs">
                    {pending > 0 && (
                      <span className="inline-flex items-center gap-1 text-blue-600">
                        <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold">{pending}</span>
                        pending
                      </span>
                    )}
                    {redos > 0 && (
                      <span className="inline-flex items-center gap-1 text-orange-600">
                        <span className="rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold">{redos}</span>
                        redo
                      </span>
                    )}
                    {completed > 0 && (
                      <span className="inline-flex items-center gap-1 text-success-600">
                        <span className="rounded-full bg-success-100 px-1.5 py-0.5 text-[10px] font-bold">{completed}</span>
                        graded
                      </span>
                    )}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50">
                        <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider sticky left-0 bg-slate-50 z-10 min-w-[110px]">Student</th>
                        {exercises.map((ex) => (
                          <th key={ex.id} className="px-0.5 py-2 text-center min-w-[42px]" title={ex.title}>
                            <span className="text-[10px] font-medium text-slate-500">{ex.filename}</span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.students.map((student) => (
                        <tr key={student.user_id} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-4 py-2 text-xs font-medium text-slate-700 sticky left-0 z-10 bg-white whitespace-nowrap">
                            {(() => {
                              const name = student.full_name || student.email
                              const parts = name.split(' ')
                              if (parts.length >= 2) return `${parts[0]} ${parts[parts.length - 1][0]}.`
                              return parts[0]
                            })()}
                          </td>
                          {exercises.map((ex) => {
                            const sub = submissionLookup.get(`${student.user_id}:${ex.id}`)
                            let cellClass = ''
                            let label = ''
                            let title = ''
                            let clickable = false

                            if (sub) {
                              clickable = true
                              if (sub.grade === null) {
                                cellClass = 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                                label = '+'
                                title = 'Awaiting review — Click to grade'
                              } else if (sub.grade === 'R') {
                                cellClass = 'bg-orange-100 text-orange-700 hover:bg-orange-200 ring-1 ring-inset ring-orange-300'
                                label = 'R'
                                title = 'Redo — Click to review'
                              } else {
                                cellClass = 'bg-success-100 text-success-700 hover:bg-success-200'
                                label = sub.grade
                                title = `Grade: ${sub.grade} — Click to review`
                              }
                            } else {
                              cellClass = 'bg-slate-50 text-slate-300'
                              label = '\u2014'
                              title = 'Not submitted'
                            }

                            return (
                              <td key={ex.id} className="px-0.5 py-1 text-center">
                                <button
                                  onClick={() => clickable && openGridCell(student.user_id, ex.id)}
                                  disabled={!clickable}
                                  title={title}
                                  className={`inline-flex items-center justify-center w-7 h-7 rounded text-[10px] font-bold transition-colors ${cellClass} ${clickable ? 'cursor-pointer' : 'cursor-default'}`}
                                >
                                  {label}
                                </button>
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}

          {/* Grid grading modal */}
          <Modal
            open={gridModalOpen}
            onClose={() => { setGridModalOpen(false); setGridModalSubmission(null); setGridFeedback(''); setGithubIssueData(null); setGithubIssueError(null) }}
            title={gridModalSubmission ? gridModalSubmission.content_block_title : 'Loading...'}
            subtitle={gridModalSubmission ? `Student: ${gridModalSubmission.user_name}  |  File: ${gridModalSubmission.filename || 'N/A'}  |  Submission #${gridModalSubmission.num_submissions}` : ''}
            size="xl"
            fixedHeight
            footer={gridModalSubmission ? (
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <textarea
                    value={gridFeedback}
                    onChange={(e) => setGridFeedback(e.target.value)}
                    placeholder="Leave feedback for the student... (visible on their end)"
                    rows={3}
                    className="flex-1 rounded-lg border border-slate-200 p-2.5 text-sm resize-y min-h-[72px] focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                  {gridModalSubmission.grade && (
                    <div className="flex flex-col items-center gap-1 shrink-0 pt-1">
                      <span className="text-[10px] text-slate-400 uppercase tracking-wider">Current</span>
                      <GradeDisplay grade={gridModalSubmission.grade} size="sm" />
                      {gridModalSubmission.graded_by && (
                        <span className="text-[10px] text-slate-400">{gridModalSubmission.graded_by}</span>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {['A', 'B', 'C'].map((g) => (
                    <button
                      key={g}
                      onClick={() => handleGridGrade(g)}
                      disabled={grading}
                      className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${
                        g === 'A' ? 'bg-success-500 text-white hover:bg-success-600' :
                        g === 'B' ? 'bg-blue-500 text-white hover:bg-blue-600' :
                        'bg-amber-500 text-white hover:bg-amber-600'
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                  <button
                    onClick={() => {
                      if (!gridFeedback.trim()) {
                        if (!window.confirm('No feedback written. The student won\'t know what to fix. Grade as Redo without feedback?')) return
                      }
                      handleGridGrade('R')
                    }}
                    disabled={grading}
                    className="flex-1 rounded-lg py-2 text-sm font-semibold bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-50 transition-colors"
                  >
                    <RotateCcw className="h-4 w-4 inline mr-1" />
                    Redo
                  </button>
                </div>
              </div>
            ) : undefined}
          >
            {!gridModalSubmission ? (
              <LoadingSpinner message="Loading submission..." />
            ) : (
              <div className="flex flex-col h-full">
                {/* Tabs */}
                <div className="flex items-center border-b border-slate-200 -mx-6 px-6 shrink-0">
                  {([
                    { key: 'exercise' as const, label: 'Exercise' },
                    { key: 'answer' as const, label: `${gridModalSubmission.user_name.split(' ')[0]}'s Answer` },
                    { key: 'solution' as const, label: 'Solution' },
                    { key: 'feedback' as const, label: 'Feedback' },
                    ...(gridModalSubmission.github_issue_url ? [{ key: 'github_issue' as const, label: 'GitHub Issue' }] : []),
                  ]).map((tab) => (
                    <button
                      key={tab.key}
                      onClick={() => setGridModalTab(tab.key)}
                      className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap ${
                        gridModalTab === tab.key
                          ? 'border-primary-500 text-primary-700'
                          : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Tab content */}
                <div className="flex-1 overflow-y-auto pt-4 -mx-6 px-6 flex flex-col min-h-0">
                  {gridModalTab === 'exercise' && (
                    <div>
                      {gridModalSubmission.exercise_body ? (
                        <MarkdownRenderer content={gridModalSubmission.exercise_body} />
                      ) : (
                        <p className="text-sm text-slate-400 italic">No exercise instructions available</p>
                      )}
                    </div>
                  )}

                  {gridModalTab === 'answer' && (
                    <div className="flex flex-col flex-1 min-h-0">
                      {gridModalSubmission.github_code_url && (
                        <a
                          href={sanitizeUrl(gridModalSubmission.github_code_url)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs text-primary-600 hover:text-primary-700 mb-3 shrink-0"
                        >
                          <Github className="h-3.5 w-3.5" />
                          View on GitHub
                        </a>
                      )}
                      {gridModalSubmission.text ? (
                        <div className="flex-1 min-h-0">
                          <CodeEditor
                            value={gridModalSubmission.text}
                            language={detectLanguage(gridModalSubmission.filename, gridModalSubmission.language_hint)}
                            readOnly
                            height="100%"
                            minHeight={520}
                          />
                        </div>
                      ) : (
                        <p className="text-sm text-slate-400 italic">No code submitted</p>
                      )}
                    </div>
                  )}

                  {gridModalTab === 'solution' && (
                    <div className="flex flex-col flex-1 min-h-0">
                      {gridModalSubmission.solution ? (
                        <div className="flex-1 min-h-0">
                          <CodeEditor
                            value={gridModalSubmission.solution}
                            language={detectLanguage(gridModalSubmission.filename, gridModalSubmission.language_hint)}
                            readOnly
                            height="100%"
                            minHeight={520}
                          />
                        </div>
                      ) : (
                        <p className="text-sm text-slate-400 italic">No solution available</p>
                      )}
                    </div>
                  )}

                  {gridModalTab === 'feedback' && (
                    <div className="space-y-4">
                      {gridModalSubmission.grade ? (
                        <div className={`rounded-xl border p-4 ${gridModalSubmission.grade === 'R' ? 'border-orange-200 bg-orange-50' : 'border-success-200 bg-success-50'}`}>
                          <div className="flex items-center gap-2 mb-2">
                            <GradeDisplay grade={gridModalSubmission.grade} size="sm" />
                            <span className="text-sm font-medium text-slate-700">
                              Graded by {gridModalSubmission.graded_by || 'Unknown'}
                            </span>
                            {gridModalSubmission.graded_at && (
                              <span className="text-xs text-slate-400">
                                {new Date(gridModalSubmission.graded_at).toLocaleString()}
                              </span>
                            )}
                          </div>
                          {gridModalSubmission.feedback ? (
                            <div className="text-sm text-slate-700 whitespace-pre-wrap">{gridModalSubmission.feedback}</div>
                          ) : (
                            <p className="text-sm text-slate-400 italic">No written feedback yet — add feedback below when grading</p>
                          )}
                        </div>
                      ) : (
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center">
                          <p className="text-sm text-slate-500">Not yet graded</p>
                          <p className="text-xs text-slate-400 mt-1">Use the grade buttons below to grade this submission</p>
                        </div>
                      )}

                      {(gridModalSubmission.github_code_url || gridModalSubmission.github_issue_url) && (
                        <div className="rounded-xl border border-slate-200 p-4 space-y-2">
                          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">GitHub Links</p>
                          {gridModalSubmission.github_code_url && (
                            <a
                              href={sanitizeUrl(gridModalSubmission.github_code_url)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1.5 text-sm text-primary-600 hover:text-primary-700"
                            >
                              <Github className="h-4 w-4 shrink-0" />
                              View student code on GitHub
                            </a>
                          )}
                          {gridModalSubmission.github_issue_url && (
                            <a
                              href={sanitizeUrl(gridModalSubmission.github_issue_url)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1.5 text-sm text-primary-600 hover:text-primary-700"
                            >
                              <Github className="h-4 w-4 shrink-0" />
                              View issue thread (instructor comments)
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {gridModalTab === 'github_issue' && gridModalSubmission.github_issue_url && (
                    <div className="space-y-4">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={loadGithubIssue}
                          disabled={loadingGithubIssue}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700 transition-colors disabled:opacity-50"
                        >
                          {loadingGithubIssue ? (
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Github className="h-3.5 w-3.5" />
                          )}
                          {githubIssueData ? 'Refresh Issue' : 'Load GitHub Issue'}
                        </button>
                        <a
                          href={sanitizeUrl(gridModalSubmission.github_issue_url)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-primary-600 hover:text-primary-700"
                        >
                          See issue on GitHub
                        </a>
                      </div>

                      {githubIssueData && (
                        <div className="space-y-4">
                          <div className="rounded-xl border border-slate-200 overflow-hidden">
                            <div className="bg-slate-50 px-4 py-3 border-b border-slate-200">
                              <div className="flex items-center gap-2">
                                <h4 className="text-sm font-semibold text-slate-800">{githubIssueData.title}</h4>
                                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                                  githubIssueData.state === 'open' ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700'
                                }`}>
                                  {githubIssueData.state}
                                </span>
                              </div>
                            </div>
                            <div className="p-4">
                              <pre className="whitespace-pre-wrap text-sm text-slate-700 font-mono bg-slate-50 rounded-lg border border-slate-200 p-3 max-h-64 overflow-y-auto">{githubIssueData.body}</pre>
                            </div>
                          </div>

                          {githubIssueData.comments.length > 0 && (
                            <div className="space-y-3">
                              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                                Comments ({githubIssueData.comments.length})
                              </p>
                              {githubIssueData.comments.map((comment) => (
                                <div key={comment.id} className="rounded-xl border border-slate-200 overflow-hidden">
                                  <div className="bg-slate-50 px-4 py-2 border-b border-slate-200 flex items-center justify-between">
                                    <span className="text-sm font-medium text-slate-700">{comment.user}</span>
                                    <span className="text-xs text-slate-400">{new Date(comment.created_at).toLocaleString()}</span>
                                  </div>
                                  <div className="p-4">
                                    <div className="text-sm text-slate-700 whitespace-pre-wrap">{comment.body}</div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {githubIssueError && (
                        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-center">
                          <p className="text-sm font-medium text-red-700">Failed to load GitHub issue</p>
                          <p className="text-xs text-red-500 mt-1">{githubIssueError}</p>
                        </div>
                      )}

                      {!githubIssueData && !loadingGithubIssue && !githubIssueError && (
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center">
                          <Github className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                          <p className="text-sm text-slate-500">Click "Load GitHub Issue" to fetch the issue details and comments</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </Modal>
        </>
      )}

      {viewMode !== 'grid' && <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left panel: student list or submission queue */}
        <div className="lg:col-span-2 space-y-3">
          {viewMode === 'students' && !selectedStudentId ? (
            /* Student list */
            data.students.length === 0 ? (
              <EmptyState icon={User} title="No students" description="No active students in this cohort." />
            ) : (
              data.students.map((student) => (
                <button
                  key={student.user_id}
                  onClick={() => { setSelectedStudentId(student.user_id); setSelectedSubmission(null) }}
                  className="w-full text-left rounded-2xl border border-slate-200 bg-white p-4 hover:border-primary-200 hover:shadow-sm transition-all"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900">{student.full_name || student.email}</p>
                      {student.github_username && (
                        <div className="flex items-center gap-1 mt-0.5 text-xs text-slate-400">
                          <Github className="h-3 w-3" />
                          {student.github_username}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {student.ungraded > 0 && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                          {student.ungraded} ungraded
                        </span>
                      )}
                      {student.redo > 0 && (
                        <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700">
                          {student.redo} redo
                        </span>
                      )}
                      <ChevronRight className="h-4 w-4 text-slate-300" />
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-4 text-xs text-slate-500">
                    <span>{student.submitted}/{student.total_exercises} submitted</span>
                    <span>{student.graded} graded</span>
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-linear-to-r from-success-400 to-success-500 transition-all"
                      style={{ width: `${student.total_exercises > 0 ? (student.graded / student.total_exercises) * 100 : 0}%` }}
                    />
                  </div>
                </button>
              ))
            )
          ) : (
            /* Submission list (queue or per-student) */
            <>
              {selectedStudentId && (
                <button
                  onClick={() => { setSelectedStudentId(null); setSelectedSubmission(null) }}
                  className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to student list
                </button>
              )}

              {selectedStudentId && data.requires_github && (() => {
                const student = data.students.find((s) => s.user_id === selectedStudentId)
                if (!student?.github_username) return null
                return (
                  <button
                    onClick={() => handleSyncStudent(selectedStudentId)}
                    disabled={syncingStudentId === selectedStudentId}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${syncingStudentId === selectedStudentId ? 'animate-spin' : ''}`} />
                    {syncingStudentId === selectedStudentId ? 'Syncing...' : `Sync ${student.full_name || student.email}`}
                  </button>
                )
              })()}

              {filteredSubmissions.length === 0 ? (
                <EmptyState
                  icon={Check}
                  title={selectedStudentId ? 'No submissions yet' : queueFilter === 'ungraded' ? 'All caught up!' : queueFilter === 'redo' ? 'No redo queue' : 'No submissions'}
                  description={selectedStudentId ? 'This student hasn\'t submitted any work yet.' : queueFilter === 'ungraded' ? 'No ungraded submissions.' : queueFilter === 'redo' ? 'No redo-requested submissions.' : 'No submissions yet.'}
                />
              ) : (
                filteredSubmissions.map((sub) => {
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
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            {!selectedStudentId && (
                              <p className="text-sm font-medium text-slate-900">{sub.user_name}</p>
                            )}
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
                          <p className="mt-0.5 text-xs text-slate-400">
                            Submission #{sub.num_submissions} · {new Date(sub.created_at).toLocaleDateString()}
                          </p>
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
            </>
          )}
        </div>

        {/* Right panel: grading detail */}
        <div className="lg:col-span-3">
          {selectedSubmission ? (
            <div className="rounded-2xl bg-white border border-slate-200 p-6 space-y-4 sticky top-4">
              {loadingDetail ? (
                <LoadingSpinner message="Loading submission..." />
              ) : (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold text-slate-900">{selectedSubmission.user_name}</h3>
                      <p className="text-sm text-slate-500">{selectedSubmission.lesson_title}</p>
                      <p className="text-xs text-slate-400">
                        {selectedSubmission.content_block_title} · Submission #{selectedSubmission.num_submissions}
                      </p>
                      {selectedSubmission.github_code_url && (
                        <a
                          href={sanitizeUrl(selectedSubmission.github_code_url)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 inline-flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700"
                        >
                          <Github className="h-3 w-3" />
                          View on GitHub
                        </a>
                      )}
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
                      onClick={() => {
                        if (!feedback.trim()) {
                          if (!window.confirm('No feedback written. The student won\'t know what to fix. Grade as Redo without feedback?')) return
                        }
                        handleGrade('R')
                      }}
                      disabled={grading}
                      className="flex-1 rounded-lg py-2.5 text-sm font-semibold bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-50 transition-colors"
                    >
                      <RotateCcw className="h-4 w-4 inline mr-1" />
                      Redo
                    </button>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-slate-400 pt-1">
                    <Keyboard className="h-3.5 w-3.5" />
                    Press <kbd className="px-1.5 py-0.5 bg-slate-100 rounded border border-slate-200 font-mono text-[10px]">A</kbd>
                    <kbd className="px-1.5 py-0.5 bg-slate-100 rounded border border-slate-200 font-mono text-[10px]">B</kbd>
                    <kbd className="px-1.5 py-0.5 bg-slate-100 rounded border border-slate-200 font-mono text-[10px]">C</kbd>
                    <kbd className="px-1.5 py-0.5 bg-slate-100 rounded border border-slate-200 font-mono text-[10px]">R</kbd>
                    to grade &middot; auto-advances to next
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 flex items-center justify-center min-h-[400px]">
              <div className="text-center">
                <Check className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                <p className="text-sm text-slate-500">Select a submission to start grading</p>
                <p className="text-xs text-slate-400 mt-1">Or click Ungraded Queue above to start grading all</p>
              </div>
            </div>
          )}
        </div>
      </div>}
    </div>
  )
}
