import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, BookOpen, CheckCircle2, FileCheck2, LifeBuoy, MessageSquareText, RotateCcw, UserRound, X } from 'lucide-react'
import { api } from '../../lib/api'
import { cohortStudentPath, directMessagePath, submissionPath } from '../../lib/routes'
import type { HelpRequest, StudentProgressResponse, Submission } from '../../types/api'
import { Button } from '../ui/Button'
import { LoadingSpinner } from '../shared/LoadingSpinner'

interface StudentContextDrawerProps {
  open: boolean
  cohortId: number
  studentId: number
  onClose: () => void
  source?: { type: 'submission' | 'help_request'; id: number; label: string }
}

interface DrawerData {
  progress: StudentProgressResponse
  submissions: Submission[]
  helpRequests: HelpRequest[]
}

export function StudentContextDrawer({ open, cohortId, studentId, onClose, source }: StudentContextDrawerProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const closeRef = useRef<HTMLButtonElement>(null)
  const [data, setData] = useState<DrawerData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openingMessage, setOpeningMessage] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([
      api.getStudentProgress(studentId, cohortId),
      api.getSubmissions({ user_id: String(studentId) }),
      api.getHelpRequests({ cohort_id: cohortId, student_id: studentId }),
    ]).then(([progressResult, submissionResult, helpResult]) => {
      if (cancelled) return
      if (!progressResult.data) {
        setError(progressResult.error || 'Could not load this student context.')
        setData(null)
      } else {
        const blockIds = new Set(progressResult.data.modules.flatMap((mod) => mod.lessons.flatMap((lesson) => lesson.blocks.map((block) => block.id))))
        setData({
          progress: progressResult.data,
          submissions: (submissionResult.data?.submissions || []).filter((submission) => blockIds.has(submission.content_block_id)),
          helpRequests: helpResult.data?.help_requests || [],
        })
      }
      setLoading(false)
    })
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    requestAnimationFrame(() => closeRef.current?.focus())
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      cancelled = true
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [cohortId, onClose, open, studentId])

  const latestReview = useMemo(() => data?.submissions.find((submission) => submission.grade === null), [data?.submissions])
  if (!open) return null

  async function openMessage() {
    setOpeningMessage(true)
    const result = await api.createDirectConversation({ cohort_id: cohortId, user_ids: [studentId] })
    setOpeningMessage(false)
    if (result.data) {
      onClose()
      navigate(directMessagePath(result.data.direct_conversation.id, source))
    } else setError(result.error || 'Could not open a direct message.')
  }

  const returnTo = `${location.pathname}${location.search}`
  const activeHelp = data?.helpRequests.filter((request) => request.status === 'open' || request.status === 'acknowledged') || []
  const redo = data?.submissions.filter((submission) => submission.grade === 'R') || []
  const ungraded = data?.submissions.filter((submission) => submission.grade === null) || []

  return createPortal(
    <div className="fixed inset-0 z-50" role="presentation">
      <button type="button" aria-label="Close student context" onClick={onClose} className="absolute inset-0 h-full w-full bg-slate-950/45 backdrop-blur-[1px]" />
      <aside role="dialog" aria-modal="true" aria-label="Student context" className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-white shadow-2xl">
        <header className="flex min-h-20 items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div><p className="app-eyebrow">Student context</p><h2 className="mt-1 text-lg font-extrabold text-slate-950">{data?.progress.user.full_name || 'Loading student…'}</h2></div>
          <button ref={closeRef} type="button" onClick={onClose} className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100" aria-label="Close student context"><X className="h-5 w-5" /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {loading && !data ? <LoadingSpinner message="Loading student context…" /> : error && !data ? <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"><p className="font-bold">Context unavailable</p><p className="mt-1">{error}</p></div> : data && <div className="space-y-5">
            <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-start gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white"><UserRound className="h-5 w-5" /></span><div className="min-w-0"><p className="truncate font-extrabold text-slate-950">{data.progress.user.full_name}</p><p className="truncate text-xs text-slate-500">{data.progress.user.email}</p><p className="mt-1 text-xs font-bold text-primary-700">{data.progress.cohort.name}</p></div></div>
              <div className="mt-4 flex items-end justify-between"><div><p className="text-3xl font-extrabold tabular-nums text-slate-950">{Math.round(data.progress.overall_progress.percentage)}%</p><p className="text-xs font-semibold text-slate-500">curriculum progress</p></div><p className="text-xs font-bold text-slate-500">{data.progress.overall_progress.completed}/{data.progress.overall_progress.total} steps</p></div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-primary-600" style={{ width: `${Math.min(100, data.progress.overall_progress.percentage)}%` }} /></div>
            </section>

            <section className="grid grid-cols-3 gap-2" aria-label="Student signals">
              <Signal icon={FileCheck2} value={ungraded.length} label="to review" tone="primary" />
              <Signal icon={RotateCcw} value={redo.length} label="redo" tone="amber" />
              <Signal icon={LifeBuoy} value={activeHelp.length} label="open help" tone="red" />
            </section>

            {source && <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-900"><span className="font-extrabold">Opened from:</span> {source.label}</div>}
            {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</p>}

            <section className="space-y-2">
              <Button fullWidth onClick={() => void openMessage()} disabled={openingMessage}><MessageSquareText className="h-4 w-4" />{openingMessage ? 'Opening…' : `Message in ${data.progress.cohort.name}`}</Button>
              <Link to={cohortStudentPath(cohortId, studentId)} onClick={onClose} className="inline-flex min-h-11 w-full items-center justify-between rounded-xl border border-slate-300 px-3 text-sm font-bold text-slate-700 hover:bg-slate-50"><span className="inline-flex items-center gap-2"><UserRound className="h-4 w-4" />Open full workspace</span><ArrowRight className="h-4 w-4" /></Link>
              {latestReview && <Link to={submissionPath(latestReview.id, { cohortId, userId: studentId, returnTo, queue: 'ungraded' })} onClick={onClose} className="inline-flex min-h-11 w-full items-center justify-between rounded-xl border border-slate-300 px-3 text-sm font-bold text-slate-700 hover:bg-slate-50"><span className="inline-flex items-center gap-2"><CheckCircle2 className="h-4 w-4" />Grade next submission</span><ArrowRight className="h-4 w-4" /></Link>}
            </section>

            <section><div className="flex items-center gap-2"><BookOpen className="h-4 w-4 text-primary-600" /><h3 className="text-sm font-extrabold text-slate-950">Current learning</h3></div><div className="mt-3 space-y-2">{data.progress.modules.slice(0, 3).map((mod) => <div key={mod.id} className="rounded-xl border border-slate-200 px-3 py-3"><div className="flex items-center justify-between gap-3"><p className="truncate text-xs font-bold text-slate-800">{mod.name}</p><span className="text-xs font-extrabold text-slate-500">{Math.round(mod.progress_percentage)}%</span></div></div>)}</div></section>
          </div>}
        </div>
      </aside>
    </div>,
    document.body,
  )
}

function Signal({ icon: Icon, value, label, tone }: { icon: typeof FileCheck2; value: number; label: string; tone: 'primary' | 'amber' | 'red' }) {
  const styles = { primary: 'bg-primary-50 text-primary-700', amber: 'bg-amber-50 text-amber-700', red: 'bg-red-50 text-red-700' }
  return <div className={`rounded-2xl p-3 ${styles[tone]}`}><Icon className="h-4 w-4" /><p className="mt-3 text-xl font-extrabold tabular-nums">{value}</p><p className="mt-0.5 text-[11px] font-bold">{label}</p></div>
}
