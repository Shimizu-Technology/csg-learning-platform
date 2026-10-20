import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, BookOpen, CheckCircle2, FileCheck2, LifeBuoy, MessageSquareText, RotateCcw, UserRound, X } from 'lucide-react'
import { api } from '../../lib/api'
import { cohortStudentPath, directMessagePath, submissionPath } from '../../lib/routes'
import type { HelpRequest, StudentProgressResponse, Submission } from '../../types/api'
import { Button, IconButton, LinkButton } from '../ui/Button'
import { Avatar } from '../ui/Avatar'
import { LoadingSpinner } from '../shared/LoadingSpinner'
import { playModalExit } from '../shared/Modal'
import { ProgressBar } from '../shared/ProgressBar'

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
      api.getSubmissions({ user_id: String(studentId), cohort_id: String(cohortId) }),
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
  // Slide the drawer out from a static copy of its last frame (see Modal's playModalExit).
  const setRoot = useCallback((node: HTMLDivElement | null) => {
    if (!node) return
    return () => playModalExit(node)
  }, [])

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
    <div ref={setRoot} data-state="open" className="app-drawer-overlay fixed inset-0 z-50" role="presentation">
      <button type="button" aria-label="Close student context" onClick={onClose} className="absolute inset-0 h-full w-full bg-slate-950/50" />
      <aside role="dialog" aria-modal="true" aria-label="Student context" className="app-drawer-panel absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-surface-raised shadow-overlay">
        <header className="flex min-h-20 items-center justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0"><p className="app-eyebrow">Student context</p><h2 className="mt-1 truncate text-lg font-bold text-ink" title={data?.progress.user.full_name}>{data?.progress.user.full_name || 'Loading student…'}</h2></div>
          <IconButton ref={closeRef} label="Close student context" onClick={onClose}><X className="h-5 w-5" aria-hidden="true" /></IconButton>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {loading && !data ? <LoadingSpinner message="Loading student context…" /> : error && !data ? <div role="alert" className="rounded-2xl border border-danger-200 bg-danger-50 p-4 text-sm text-danger-700"><p className="font-semibold">Context unavailable</p><p className="mt-1">{error}</p></div> : data && <div className="space-y-5">
            <section className="app-surface-muted p-4">
              <div className="flex items-start gap-3"><Avatar name={data.progress.user.full_name} src={data.progress.user.avatar_url} size="md" /><div className="min-w-0"><p className="truncate font-semibold text-ink" title={data.progress.user.full_name}>{data.progress.user.full_name}</p><p className="truncate text-xs text-ink-muted" title={data.progress.user.email}>{data.progress.user.email}</p><p className="mt-1 truncate text-xs font-semibold text-ink-secondary" title={data.progress.cohort.name}>{data.progress.cohort.name}</p></div></div>
              <div className="mt-4 flex items-end justify-between"><div><p className="text-3xl font-bold tabular-nums text-ink">{Math.round(data.progress.overall_progress.percentage)}%</p><p className="text-xs font-semibold text-ink-muted">curriculum progress</p></div><p className="text-xs font-semibold tabular-nums text-ink-muted">{data.progress.overall_progress.completed}/{data.progress.overall_progress.total} steps</p></div>
              <div className="mt-3"><ProgressBar value={data.progress.overall_progress.percentage} showPercentage={false} /></div>
            </section>

            <section className="grid grid-cols-3 gap-2" aria-label="Student signals">
              <Signal icon={FileCheck2} value={ungraded.length} label="to review" tone="pending" />
              <Signal icon={RotateCcw} value={redo.length} label="redo" tone="warning" />
              <Signal icon={LifeBuoy} value={activeHelp.length} label="open help" tone="warning" />
            </section>

            {source && <div className="rounded-xl border border-info-200 bg-info-50 px-3 py-2 text-xs leading-5 text-info-800 [overflow-wrap:anywhere]"><span className="font-semibold">Opened from:</span> {source.label}</div>}
            {error && <p role="alert" className="rounded-xl border border-danger-200 bg-danger-50 px-3 py-2 text-xs font-semibold text-danger-700">{error}</p>}

            <section className="space-y-2">
              <Button fullWidth onClick={() => void openMessage()} disabled={openingMessage}><MessageSquareText className="h-4 w-4" /><span className="truncate">{openingMessage ? 'Opening…' : `Message in ${data.progress.cohort.name}`}</span></Button>
              <LinkButton to={cohortStudentPath(cohortId, studentId)} onClick={onClose} variant="secondary" fullWidth><span className="flex flex-1 items-center gap-2 text-left"><UserRound className="h-4 w-4" aria-hidden="true" />Open full workspace</span><ArrowRight className="h-4 w-4" aria-hidden="true" /></LinkButton>
              {latestReview && <LinkButton to={submissionPath(latestReview.id, { cohortId, userId: studentId, returnTo, queue: 'ungraded' })} onClick={onClose} variant="secondary" fullWidth><span className="flex flex-1 items-center gap-2 text-left"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Grade next submission</span><ArrowRight className="h-4 w-4" aria-hidden="true" /></LinkButton>}
            </section>

            <section><div className="flex items-center gap-2"><BookOpen className="h-4 w-4 text-ink-muted" aria-hidden="true" /><h3 className="text-sm font-semibold text-ink">Current learning</h3></div><div className="mt-3 space-y-2">{data.progress.modules.slice(0, 3).map((mod) => <div key={mod.id} className="rounded-xl border border-line px-3 py-3"><div className="flex items-center justify-between gap-3"><p className="min-w-0 truncate text-xs font-semibold text-ink" title={mod.name}>{mod.name}</p><span className="shrink-0 text-xs font-semibold tabular-nums text-ink-muted">{Math.round(mod.progress_percentage)}%</span></div></div>)}</div></section>
          </div>}
        </div>
      </aside>
    </div>,
    document.body,
  )
}

function Signal({ icon: Icon, value, label, tone }: { icon: typeof FileCheck2; value: number; label: string; tone: 'pending' | 'warning' }) {
  // Tinted only when there is something to act on; zero counts stay neutral.
  const styles = { pending: 'border-pending-200 bg-pending-50 text-pending-700', warning: 'border-warning-200 bg-warning-50 text-warning-800' }
  return <div className={`rounded-2xl border p-3 ${value > 0 ? styles[tone] : 'border-line bg-surface-raised text-ink-secondary'}`}><Icon className="h-4 w-4" aria-hidden="true" /><p className="mt-3 text-xl font-bold tabular-nums">{value}</p><p className="mt-0.5 text-xs font-semibold">{label}</p></div>
}
