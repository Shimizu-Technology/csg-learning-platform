import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { ArrowRight, CalendarClock, CheckCircle2, CircleHelp, ClipboardPlus, Clock3, LifeBuoy, RefreshCw, ShieldAlert, UserRound, UserRoundCheck } from 'lucide-react'
import { api } from '../../lib/api'
import { helpRequestPath, interventionPath } from '../../lib/routes'
import { analyticsAgeBucket, captureProductEvent } from '../../lib/analytics'
import { formatShortDateTime } from '../../lib/format'
import { useToast } from '../../contexts/ToastContext'
import { EmptyState } from '../../components/shared/EmptyState'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { ProgressBar } from '../../components/shared/ProgressBar'
import { Modal } from '../../components/shared/Modal'
import { Button } from '../../components/ui/Button'
import { PageHeader } from '../../components/ui/PageHeader'
import { StudentContextDrawer } from '../../components/admin/StudentContextDrawer'
import type { HelpRequest, InterventionTrigger, SupportQueue as SupportQueueData, SupportQueueStudent } from '../../types/api'

export function SupportQueue() {
  const toast = useToast()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [queue, setQueue] = useState<SupportQueueData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<number | null>(null)
  const [resolving, setResolving] = useState<HelpRequest | null>(null)
  const [response, setResponse] = useState('')
  const [selectedStudent, setSelectedStudent] = useState<{ id: number; cohortId: number } | null>(null)
  const [creatingFor, setCreatingFor] = useState<SupportQueueStudent | null>(null)
  const [triggerType, setTriggerType] = useState<InterventionTrigger>('manual')
  const [actionSummary, setActionSummary] = useState('')
  const [followUpAt, setFollowUpAt] = useState(() => localDateTime(7))

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

  function startIntervention(student: SupportQueueStudent) {
    const trigger: InterventionTrigger = student.urgent_help_count || student.help_request_count ? 'help_request' : student.redo_count ? 'redo' : student.ungraded_count ? 'ungraded' : student.inactive ? 'inactivity' : 'manual'
    setCreatingFor(student)
    setTriggerType(trigger)
    setActionSummary(trigger === 'help_request' ? 'Respond to the request and confirm the next learning step.' : trigger === 'redo' ? 'Review the redo feedback and agree on a resubmission plan.' : trigger === 'ungraded' ? 'Review outstanding work and give the student a clear next step.' : trigger === 'inactivity' ? 'Check in with the student and identify a sustainable return plan.' : '')
    setFollowUpAt(localDateTime(trigger === 'help_request' ? 2 : 7))
  }

  async function createIntervention(event: React.FormEvent) {
    event.preventDefault()
    if (!creatingFor || !actionSummary.trim() || !followUpAt) return
    setSavingId(-1)
    const helpRequest = triggerType === 'help_request' ? queue?.help_requests.find((request) => request.student?.id === creatingFor.user_id && request.cohort.id === creatingFor.cohort_id) : undefined
    const result = await api.createIntervention({
      enrollment_id: creatingFor.enrollment_id,
      help_request_id: helpRequest?.id,
      trigger_type: triggerType,
      severity: helpRequest?.urgency === 'urgent' ? 'urgent' : 'normal',
      action_summary: actionSummary.trim(),
      next_follow_up_at: new Date(followUpAt).toISOString(),
    })
    setSavingId(null)
    if (!result.data) return toast.error(result.error || 'Could not create the intervention.')
    captureProductEvent('intervention_opened', { cohort_id: creatingFor.cohort_id, intervention_id: result.data.intervention.id, trigger_type: result.data.intervention.trigger_type, severity: result.data.intervention.severity })
    setCreatingFor(null)
    toast.success('Owned intervention created with a scheduled follow-up.')
    await loadQueue()
  }

  if (loading) return <LoadingSpinner message="Loading student support…" />
  if (error && !queue) return <EmptyState icon={LifeBuoy} title="Could not load student support" description={error} action={<Button onClick={() => { setLoading(true); void loadQueue() }}><RefreshCw className="h-4 w-4" />Try again</Button>} />
  if (!queue) return null

  const view = searchParams.get('view') === 'resolved' ? 'resolved' : 'active'
  const urgentOnly = searchParams.get('urgency') === 'urgent'
  const filteredRequests = (view === 'active' ? queue.help_requests : queue.recently_resolved)
    .filter((request) => !urgentOnly || request.urgency === 'urgent')
  const returnTo = `${location.pathname}${location.search}`
  const setFilter = (key: 'view' | 'urgency', value: string) => {
    const next = new URLSearchParams(searchParams)
    if ((key === 'view' && value === 'active') || (key === 'urgency' && value === 'all')) next.delete(key)
    else next.set(key, value)
    setSearchParams(next)
  }

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
        <SummaryCard label="Active interventions" value={queue.summary.active_intervention_count} icon={UserRoundCheck} tone="slate" />
        <SummaryCard label="Follow-ups due" value={queue.summary.due_follow_up_count} icon={CalendarClock} tone="red" />
        <SummaryCard label="Recovery check-ins due" value={queue.summary.due_recovery_check_in_count} icon={ClipboardPlus} tone="amber" />
      </section>

      <section aria-labelledby="interventions-heading" className="app-surface overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 px-5 py-4 sm:px-6"><div><p className="app-eyebrow">Owned work</p><h2 id="interventions-heading" className="mt-1 text-lg font-extrabold tracking-tight text-slate-950">Interventions and scheduled follow-ups</h2><p className="mt-1 text-sm text-slate-500">Every active case has an owner, next action, and due date.</p></div><span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-extrabold text-slate-700">{queue.summary.active_intervention_count} active</span></div>
        {queue.interventions.length === 0 ? <p className="px-6 py-8 text-center text-sm text-slate-500">No active interventions. Create one from an explainable signal below.</p> : <div className="divide-y divide-slate-100">{queue.interventions.map((intervention) => <Link key={intervention.id} to={interventionPath(intervention.id, returnTo)} className={`group grid gap-3 px-5 py-4 transition hover:bg-slate-50 sm:grid-cols-[minmax(0,1fr)_minmax(160px,0.6fr)_minmax(160px,0.7fr)_auto] sm:items-center sm:px-6 ${intervention.follow_up_due ? 'bg-red-50/70' : ''}`}><div><div className="flex flex-wrap items-center gap-2"><p className="font-extrabold text-slate-950 group-hover:text-primary-700">{intervention.enrollment.student.full_name}</p>{intervention.severity === 'urgent' && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-extrabold text-red-700">URGENT</span>}</div><p className="mt-0.5 text-xs text-slate-500">{intervention.enrollment.cohort.name} · {intervention.trigger_type.replaceAll('_', ' ')}</p></div><div><p className="text-xs font-extrabold uppercase tracking-wide text-slate-400">Owner</p><p className="mt-1 text-sm font-bold text-slate-700">{intervention.owner.full_name}</p></div><div><p className={`text-xs font-extrabold uppercase tracking-wide ${intervention.follow_up_due ? 'text-red-700' : 'text-slate-400'}`}>{intervention.follow_up_due ? 'Follow-up due' : 'Next follow-up'}</p><p className={`mt-1 text-sm font-bold ${intervention.follow_up_due ? 'text-red-800' : 'text-slate-700'}`}>{formatShortDateTime(intervention.next_follow_up_at)}</p></div><ArrowRight className="h-4 w-4 text-slate-300 transition group-hover:translate-x-1 group-hover:text-primary-600" /></Link>)}</div>}
      </section>

      <section aria-labelledby="requests-heading" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><p className="app-eyebrow">Direct requests</p><h2 id="requests-heading" className="mt-1 text-xl font-extrabold tracking-tight text-slate-950">{view === 'active' ? 'Students who asked for help' : 'Recently resolved requests'}</h2></div>
          <div className="flex flex-wrap items-center gap-2" aria-label="Support filters"><div className="flex rounded-xl bg-slate-100 p-1">{(['active', 'resolved'] as const).map((value) => <button key={value} type="button" onClick={() => setFilter('view', value)} className={`min-h-11 rounded-lg px-3 text-xs font-extrabold capitalize ${view === value ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500'}`}>{value}</button>)}</div><button type="button" onClick={() => setFilter('urgency', urgentOnly ? 'all' : 'urgent')} className={`inline-flex min-h-11 items-center gap-1.5 rounded-xl border px-3 text-xs font-extrabold ${urgentOnly ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-200 bg-white text-slate-600'}`}><ShieldAlert className="h-4 w-4" />Urgent only</button></div>
        </div>
        {filteredRequests.length === 0 ? (
          <div className="app-surface flex items-center gap-4 p-5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-green-100 text-green-700"><CheckCircle2 className="h-5 w-5" /></span>
            <div><p className="text-sm font-extrabold text-slate-950">No matching help requests.</p><p className="mt-0.5 text-xs text-slate-500">Adjust the URL-backed filters or check again later.</p></div>
          </div>
        ) : filteredRequests.map((request) => (
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
                  <Link className="app-link inline-flex items-center gap-1" to={helpRequestPath(request.id, returnTo)}>Open record <ArrowRight className="h-3.5 w-3.5" /></Link>
                  {request.student && <button type="button" className="app-link inline-flex items-center gap-1" onClick={() => setSelectedStudent({ id: request.student!.id, cohortId: request.cohort.id })}>Student context <UserRound className="h-3.5 w-3.5" /></button>}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 lg:w-40 lg:flex-col">
                {request.status === 'open' && <Button variant="secondary" fullWidth onClick={() => void acknowledge(request)} disabled={savingId === request.id}><UserRoundCheck className="h-4 w-4" />Acknowledge</Button>}
                {(request.status === 'open' || request.status === 'acknowledged') && <Button fullWidth onClick={() => { setResolving(request); setResponse('') }} disabled={savingId === request.id}><CheckCircle2 className="h-4 w-4" />Respond & resolve</Button>}
                <Link to={helpRequestPath(request.id, returnTo)} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl border border-slate-300 px-3 text-sm font-bold text-slate-700 hover:bg-slate-50">Open record <ArrowRight className="h-4 w-4" /></Link>
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
            {queue.students.map((student) => <StudentSignalRow key={`${student.cohort_id}-${student.user_id}`} student={student} onSelect={() => setSelectedStudent({ id: student.user_id, cohortId: student.cohort_id })} onCreate={() => startIntervention(student)} returnTo={returnTo} />)}
          </div>
        )}
      </section>

      {view === 'active' && queue.recently_resolved.length > 0 && (
        <details className="app-surface overflow-hidden">
          <summary className="min-h-11 cursor-pointer px-5 py-4 text-sm font-extrabold text-slate-900 sm:px-6">Recently resolved · {queue.recently_resolved.length}</summary>
          <div className="divide-y divide-slate-100 border-t border-slate-200">
            {queue.recently_resolved.map((request) => (
              <Link to={helpRequestPath(request.id, returnTo)} key={request.id} className="grid gap-2 px-5 py-4 text-sm transition hover:bg-slate-50 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto] sm:px-6">
                <div><p className="font-extrabold text-slate-950">{request.student?.full_name}</p><p className="text-xs text-slate-500">{request.context_label}</p></div>
                <p className="whitespace-pre-wrap leading-6 text-slate-700">{request.staff_response}</p>
                <span className="text-xs font-semibold text-slate-400">{formatShortDateTime(request.resolved_at)}</span>
              </Link>
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
      <Modal open={Boolean(creatingFor)} onClose={() => { if (!savingId) setCreatingFor(null) }} title="Create owned intervention" subtitle={creatingFor ? `${creatingFor.full_name} · ${creatingFor.cohort_name}` : undefined} icon={<span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary-700"><ClipboardPlus className="h-5 w-5" /></span>} size="md">
        <form className="space-y-4" onSubmit={createIntervention}><label className="block text-sm font-bold text-slate-900">Trigger<select value={triggerType} onChange={(event) => setTriggerType(event.target.value as InterventionTrigger)} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"><option value="help_request">Help request</option><option value="redo">Redo requested</option><option value="ungraded">Ungraded work</option><option value="inactivity">Inactivity</option><option value="extended_absence">Extended absence</option><option value="manual">Manual check-in</option></select></label><label className="block text-sm font-bold text-slate-900">Action / next step<textarea value={actionSummary} onChange={(event) => setActionSummary(event.target.value)} rows={5} maxLength={2000} required className="mt-2 w-full rounded-xl border border-slate-300 px-3.5 py-3 text-sm leading-6" /></label><label className="block text-sm font-bold text-slate-900">Next follow-up<input type="datetime-local" value={followUpAt} onChange={(event) => setFollowUpAt(event.target.value)} required className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" /></label><p className="rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">You become the owner. Evidence is generated from the selected source using IDs, dates, categories, and counts only.</p><Button type="submit" fullWidth disabled={savingId === -1 || !actionSummary.trim() || !followUpAt}><ClipboardPlus className="h-4 w-4" />{savingId === -1 ? 'Creating…' : 'Create intervention'}</Button></form>
      </Modal>
      {selectedStudent && <StudentContextDrawer open cohortId={selectedStudent.cohortId} studentId={selectedStudent.id} onClose={() => setSelectedStudent(null)} />}
    </div>
  )
}

function SummaryCard({ label, value, icon: Icon, tone }: { label: string; value: number; icon: typeof CircleHelp; tone: 'primary' | 'slate' | 'red' | 'amber' }) {
  const tones = { primary: 'bg-primary-50 text-primary-700', slate: 'bg-slate-100 text-slate-600', red: 'bg-red-50 text-red-700', amber: 'bg-amber-50 text-amber-700' }
  return <div className="app-surface p-4 sm:p-5"><span className={`flex h-10 w-10 items-center justify-center rounded-xl ${tones[tone]}`}><Icon className="h-5 w-5" /></span><p className="mt-4 text-3xl font-extrabold tabular-nums text-slate-950">{value}</p><p className="mt-1 text-xs font-bold text-slate-500">{label}</p></div>
}

function StudentSignalRow({ student, onSelect, onCreate, returnTo }: { student: SupportQueueStudent; onSelect: () => void; onCreate: () => void; returnTo: string }) {
  const signals = [
    student.urgent_help_count > 0 && `${student.urgent_help_count} urgent`,
    student.help_request_count > 0 && `${student.help_request_count} help request${student.help_request_count === 1 ? '' : 's'}`,
    student.redo_count > 0 && `${student.redo_count} redo${student.redo_count === 1 ? '' : 's'}`,
    student.ungraded_count > 0 && `${student.ungraded_count} ungraded`,
    student.inactive && 'No activity in 7+ days',
  ].filter(Boolean) as string[]
  return (
    <div className="grid w-full gap-3 px-5 py-4 text-left transition hover:bg-slate-50 sm:grid-cols-[minmax(180px,0.8fr)_minmax(240px,1fr)_160px_minmax(150px,auto)] sm:items-center sm:px-6">
      <button type="button" onClick={onSelect} className="min-w-0 text-left"><p className="truncate text-sm font-extrabold text-slate-950 hover:text-primary-700">{student.full_name}</p><p className="truncate text-xs text-slate-500">{student.cohort_name}</p></button>
      <div className="flex flex-wrap gap-1.5">{signals.map((signal) => <span key={signal} className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${signal.includes('urgent') ? 'bg-red-100 text-red-700' : 'bg-amber-50 text-amber-800'}`}>{signal}</span>)}</div>
      <div><ProgressBar value={student.progress_percentage} size="sm" showPercentage={false} /><p className="mt-1 text-xs font-semibold text-slate-500">{student.progress_percentage}% complete</p></div>
      {student.active_intervention_id ? <Link to={interventionPath(student.active_intervention_id, returnTo)} className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border px-3 text-xs font-extrabold ${student.follow_up_due ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-300 bg-white text-slate-700'}`}><CalendarClock className="h-4 w-4" />{student.follow_up_due ? 'Follow-up due' : 'Open case'}</Link> : <button type="button" onClick={onCreate} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-primary-600 px-3 text-xs font-extrabold text-white hover:bg-primary-700"><ClipboardPlus className="h-4 w-4" />Create case</button>}
    </div>
  )
}

function localDateTime(daysFromNow: number) { const date = new Date(Date.now() + daysFromNow * 86_400_000); const offset = date.getTimezoneOffset() * 60_000; return new Date(date.getTime() - offset).toISOString().slice(0, 16) }
