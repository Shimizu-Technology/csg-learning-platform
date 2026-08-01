import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowRight, CheckCircle2, CircleHelp, Clock3, LifeBuoy, RefreshCw, ShieldAlert, UserRoundCheck } from 'lucide-react'
import { api } from '../../lib/api'
import { analyticsAgeBucket, captureProductEvent } from '../../lib/analytics'
import { formatShortDateTime } from '../../lib/format'
import { useToast } from '../../contexts/ToastContext'
import { EmptyState } from '../../components/shared/EmptyState'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { Modal } from '../../components/shared/Modal'
import { Button } from '../../components/ui/Button'
import { PageHeader } from '../../components/ui/PageHeader'
import type { HelpRequest, SupportQueue as SupportQueueData, SupportQueueStudent } from '../../types/api'

export function SupportQueue() {
  const toast = useToast()
  const [queue, setQueue] = useState<SupportQueueData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<number | null>(null)
  const [resolving, setResolving] = useState<HelpRequest | null>(null)
  const [response, setResponse] = useState('')

  const loadQueue = useCallback(async () => {
    setError(null)
    const result = await api.getSupportQueue()
    if (result.data) setQueue(result.data.support_queue)
    else setError(result.error || 'Could not load the support queue.')
    setLoading(false)
  }, [])

  useEffect(() => { void loadQueue() }, [loadQueue])

  async function acknowledge(request: HelpRequest) {
    setSavingId(request.id)
    const result = await api.updateHelpRequest(request.id, { status: 'acknowledged' })
    setSavingId(null)
    if (!result.data) {
      toast.error(result.error || 'Could not acknowledge this request.')
      return
    }
    toast.success(`${request.student?.full_name || 'The student'} can now see that you are taking a look.`)
    await loadQueue()
  }

  async function resolveRequest(event: React.FormEvent) {
    event.preventDefault()
    if (!resolving || !response.trim()) return
    setSavingId(resolving.id)
    const result = await api.updateHelpRequest(resolving.id, { status: 'resolved', staff_response: response.trim() })
    setSavingId(null)
    if (!result.data) {
      toast.error(result.error || 'Could not resolve this request.')
      return
    }
    captureProductEvent('help_request_resolved', {
      cohort_id: resolving.cohort.id,
      help_request_id: resolving.id,
      category: resolving.category,
      resolution_bucket: analyticsAgeBucket(resolving.created_at),
    })
    setResolving(null)
    setResponse('')
    toast.success('Response sent and request resolved.')
    await loadQueue()
  }

  if (loading) return <LoadingSpinner message="Loading student support…" />
  if (error && !queue) return <EmptyState icon={LifeBuoy} title="Could not load student support" description={error} action={<Button onClick={() => { setLoading(true); void loadQueue() }}><RefreshCw className="h-4 w-4" />Try again</Button>} />
  if (!queue) return null

  return (
    <div className="app-page-wide">
      <PageHeader
        eyebrow="Student support"
        title="Know who needs help—and why"
        description="Student requests appear first, followed by explainable signals from current learning activity."
        actions={<Button variant="secondary" onClick={() => void loadQueue()}><RefreshCw className="h-4 w-4" />Refresh</Button>}
      />

      <section aria-label="Support summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard label="Open requests" value={queue.summary.open_help_count} icon={CircleHelp} tone="primary" />
        <SummaryCard label="Acknowledged" value={queue.summary.acknowledged_help_count} icon={UserRoundCheck} tone="slate" />
        <SummaryCard label="Urgent" value={queue.summary.urgent_help_count} icon={ShieldAlert} tone="red" />
        <SummaryCard label="Students flagged" value={queue.summary.student_count} icon={AlertTriangle} tone="amber" />
      </section>

      <section aria-labelledby="requests-heading" className="space-y-3">
        <div>
          <p className="app-eyebrow">Direct requests</p>
          <h2 id="requests-heading" className="mt-1 text-xl font-extrabold tracking-tight text-slate-950">Students who asked for help</h2>
        </div>
        {queue.help_requests.length === 0 ? (
          <div className="app-surface flex items-center gap-4 p-5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-green-100 text-green-700"><CheckCircle2 className="h-5 w-5" /></span>
            <div><p className="text-sm font-extrabold text-slate-950">No active help requests.</p><p className="mt-0.5 text-xs text-slate-500">New student requests will appear here immediately.</p></div>
          </div>
        ) : queue.help_requests.map((request) => (
          <article key={request.id} className={`overflow-hidden rounded-[1.5rem] border bg-white shadow-sm ${request.urgency === 'urgent' ? 'border-red-200' : 'border-slate-200'}`}>
            <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start lg:p-6">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  {request.urgency === 'urgent' && <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-1 text-xs font-extrabold text-red-700"><ShieldAlert className="h-3.5 w-3.5" />Urgent</span>}
                  <span className={`rounded-full px-2.5 py-1 text-xs font-extrabold ${request.status === 'acknowledged' ? 'bg-amber-100 text-amber-800' : 'bg-primary-50 text-primary-700'}`}>{request.status === 'acknowledged' ? 'Acknowledged' : 'Open'}</span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold capitalize text-slate-600">{request.category}</span>
                </div>
                <h3 className="mt-3 text-lg font-extrabold text-slate-950">{request.student?.full_name}</h3>
                <p className="mt-0.5 text-sm text-slate-500">{request.cohort.name} · {request.context_label}</p>
                <p className="mt-4 whitespace-pre-wrap rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-800">{request.message}</p>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-semibold text-slate-500">
                  <span className="inline-flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" />Asked {formatShortDateTime(request.created_at)}</span>
                  {request.owner && <span>Owned by {request.owner.full_name}</span>}
                  <Link className="app-link inline-flex items-center gap-1" to={request.context_path}>Open context <ArrowRight className="h-3.5 w-3.5" /></Link>
                  {request.student && <Link className="app-link inline-flex items-center gap-1" to={`/admin/students/${request.student.id}`}>Student profile <ArrowRight className="h-3.5 w-3.5" /></Link>}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 lg:w-40 lg:flex-col">
                {request.status === 'open' && <Button variant="secondary" fullWidth onClick={() => void acknowledge(request)} disabled={savingId === request.id}><UserRoundCheck className="h-4 w-4" />Acknowledge</Button>}
                <Button fullWidth onClick={() => { setResolving(request); setResponse('') }} disabled={savingId === request.id}><CheckCircle2 className="h-4 w-4" />Respond & resolve</Button>
              </div>
            </div>
          </article>
        ))}
      </section>

      <section aria-labelledby="signals-heading" className="app-surface overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-4 sm:px-6">
          <p className="app-eyebrow">Explainable signals</p>
          <h2 id="signals-heading" className="mt-1 text-lg font-extrabold tracking-tight text-slate-950">Other students to check on</h2>
          <p className="mt-1 text-sm text-slate-500">These are prompts for human judgment—not automated risk scores.</p>
        </div>
        {queue.students.length === 0 ? <p className="px-6 py-8 text-center text-sm text-slate-500">No current learning signals need attention.</p> : (
          <div className="divide-y divide-slate-100">
            {queue.students.map((student) => <StudentSignalRow key={`${student.cohort_id}-${student.user_id}`} student={student} />)}
          </div>
        )}
      </section>

      {queue.recently_resolved.length > 0 && (
        <details className="app-surface overflow-hidden">
          <summary className="min-h-11 cursor-pointer px-5 py-4 text-sm font-extrabold text-slate-900 sm:px-6">Recently resolved · {queue.recently_resolved.length}</summary>
          <div className="divide-y divide-slate-100 border-t border-slate-200">
            {queue.recently_resolved.map((request) => (
              <div key={request.id} className="grid gap-2 px-5 py-4 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto] sm:px-6">
                <div><p className="font-extrabold text-slate-950">{request.student?.full_name}</p><p className="text-xs text-slate-500">{request.context_label}</p></div>
                <p className="whitespace-pre-wrap leading-6 text-slate-700">{request.staff_response}</p>
                <span className="text-xs font-semibold text-slate-400">{formatShortDateTime(request.resolved_at)}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      <Modal open={Boolean(resolving)} onClose={() => { if (!savingId) setResolving(null) }} title="Respond and resolve" subtitle={resolving ? `${resolving.student?.full_name} · ${resolving.context_label}` : undefined} icon={<span className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-50 text-green-700"><CheckCircle2 className="h-5 w-5" /></span>} size="md">
        <form className="space-y-4" onSubmit={resolveRequest}>
          <div className="rounded-xl bg-slate-50 p-3 text-sm leading-6 text-slate-700">{resolving?.message}</div>
          <div>
            <label htmlFor="support-response" className="text-sm font-bold text-slate-900">Response visible to the student</label>
            <textarea id="support-response" value={response} onChange={(event) => setResponse(event.target.value)} maxLength={2000} rows={6} required placeholder="Give a clear next step, explanation, or follow-up instruction." className="mt-2 w-full rounded-xl border border-slate-300 px-3.5 py-3 text-sm leading-6 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-200" />
            <p className="mt-1 text-right text-xs text-slate-400">{response.length}/2,000</p>
          </div>
          <Button type="submit" fullWidth disabled={!response.trim() || savingId === resolving?.id}><CheckCircle2 className="h-4 w-4" />{savingId === resolving?.id ? 'Sending…' : 'Send response and resolve'}</Button>
        </form>
      </Modal>
    </div>
  )
}

function SummaryCard({ label, value, icon: Icon, tone }: { label: string; value: number; icon: typeof CircleHelp; tone: 'primary' | 'slate' | 'red' | 'amber' }) {
  const tones = { primary: 'bg-primary-50 text-primary-700', slate: 'bg-slate-100 text-slate-600', red: 'bg-red-50 text-red-700', amber: 'bg-amber-50 text-amber-700' }
  return <div className="app-surface p-4 sm:p-5"><span className={`flex h-10 w-10 items-center justify-center rounded-xl ${tones[tone]}`}><Icon className="h-5 w-5" /></span><p className="mt-4 text-3xl font-extrabold tabular-nums text-slate-950">{value}</p><p className="mt-1 text-xs font-bold text-slate-500">{label}</p></div>
}

function StudentSignalRow({ student }: { student: SupportQueueStudent }) {
  const signals = [
    student.urgent_help_count > 0 && `${student.urgent_help_count} urgent`,
    student.help_request_count > 0 && `${student.help_request_count} help request${student.help_request_count === 1 ? '' : 's'}`,
    student.redo_count > 0 && `${student.redo_count} redo${student.redo_count === 1 ? '' : 's'}`,
    student.ungraded_count > 0 && `${student.ungraded_count} ungraded`,
    student.inactive && 'No activity in 7+ days',
  ].filter(Boolean) as string[]
  return (
    <Link to={`/admin/students/${student.user_id}`} className="group grid gap-3 px-5 py-4 transition hover:bg-slate-50 sm:grid-cols-[minmax(180px,0.8fr)_minmax(240px,1fr)_160px_auto] sm:items-center sm:px-6">
      <div className="min-w-0"><p className="truncate text-sm font-extrabold text-slate-950">{student.full_name}</p><p className="truncate text-xs text-slate-500">{student.cohort_name}</p></div>
      <div className="flex flex-wrap gap-1.5">{signals.map((signal) => <span key={signal} className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${signal.includes('urgent') ? 'bg-red-100 text-red-700' : 'bg-amber-50 text-amber-800'}`}>{signal}</span>)}</div>
      <div><div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-primary-500" style={{ width: `${Math.min(100, student.progress_percentage)}%` }} /></div><p className="mt-1 text-xs font-semibold text-slate-500">{student.progress_percentage}% complete</p></div>
      <ArrowRight className="h-4 w-4 text-slate-300 transition group-hover:translate-x-1 group-hover:text-primary-600" />
    </Link>
  )
}
