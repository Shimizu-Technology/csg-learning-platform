import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, CalendarClock, CheckCircle2, ClipboardCheck, History, LifeBuoy, MessageSquareText, RefreshCw, ShieldAlert, UserRound } from 'lucide-react'
import { api } from '../../lib/api'
import { analyticsAgeBucket, captureProductEvent } from '../../lib/analytics'
import { cohortStudentPath, safeInternalReturnPath } from '../../lib/routes'
import { formatShortDateTime } from '../../lib/format'
import { useToast } from '../../contexts/ToastContext'
import { EmptyState } from '../../components/shared/EmptyState'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { Button } from '../../components/ui/Button'
import { PageHeader } from '../../components/ui/PageHeader'
import type { Intervention, InterventionOutcome, InterventionStatus, RecoveryPlan } from '../../types/api'

const activeStatuses: Array<{ value: InterventionStatus; label: string }> = [
  { value: 'open', label: 'Open' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'waiting_on_student', label: 'Waiting on student' },
  { value: 'monitoring', label: 'Monitoring' },
]

const outcomes: Array<{ value: InterventionOutcome; label: string }> = [
  { value: 're_engaged', label: 'Re-engaged' },
  { value: 'plan_completed', label: 'Plan completed' },
  { value: 'support_resolved', label: 'Support resolved' },
  { value: 'referred', label: 'Referred for added support' },
  { value: 'paused', label: 'Enrollment paused' },
  { value: 'withdrawn', label: 'Student withdrew' },
  { value: 'no_change', label: 'No change yet' },
]

export function InterventionDetail() {
  const interventionId = Number(useParams<{ id: string }>().id)
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const toast = useToast()
  const [intervention, setIntervention] = useState<Intervention | null>(null)
  const [plan, setPlan] = useState<RecoveryPlan | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actionSummary, setActionSummary] = useState('')
  const [followUpAt, setFollowUpAt] = useState('')
  const [noteBody, setNoteBody] = useState('')
  const [outcome, setOutcome] = useState<InterventionOutcome>('re_engaged')
  const [resolution, setResolution] = useState('')
  const [checkInBody, setCheckInBody] = useState('')
  const [showPlanForm, setShowPlanForm] = useState(false)
  const [planDraft, setPlanDraft] = useState({ target_pace: 'Two required lessons each week', required_scope: 'Complete the currently required curriculum checkpoints.', optional_scope: 'Use recordings and optional practice where they support the required work.' })

  const load = useCallback(async () => {
    if (!Number.isInteger(interventionId) || interventionId <= 0) {
      setError('This intervention link is invalid.')
      setLoading(false)
      return
    }
    setError(null)
    const result = await api.getIntervention(interventionId)
    if (!result.data) {
      setError(result.error || 'Could not load this intervention.')
      setLoading(false)
      return
    }
    const record = result.data.intervention
    setIntervention(record)
    setActionSummary(record.action_summary || '')
    setFollowUpAt(toLocalDateTime(record.next_follow_up_at))
    if (record.recovery_plan_id) {
      const planResult = await api.getRecoveryPlan(record.recovery_plan_id)
      if (planResult.data) setPlan(planResult.data.recovery_plan)
    } else setPlan(null)
    setLoading(false)
  }, [interventionId])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!intervention) return
    captureProductEvent('intervention_opened', { cohort_id: intervention.enrollment.cohort.id, intervention_id: intervention.id, trigger_type: intervention.trigger_type, severity: intervention.severity })
  }, [intervention?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function saveWorkflow(event: React.FormEvent) {
    event.preventDefault()
    if (!intervention) return
    setSaving(true)
    const result = await api.updateIntervention(intervention.id, {
      action_summary: actionSummary.trim(),
      next_follow_up_at: new Date(followUpAt).toISOString(),
    })
    setSaving(false)
    if (!result.data) return toast.error(result.error || 'Could not update the intervention.')
    setIntervention(result.data.intervention)
    toast.success('Intervention workflow updated.')
  }

  async function setStatus(status: InterventionStatus) {
    if (!intervention || status === intervention.status) return
    setSaving(true)
    const result = await api.updateIntervention(intervention.id, { status })
    setSaving(false)
    if (!result.data) return toast.error(result.error || 'Could not update the status.')
    setIntervention(result.data.intervention)
    toast.success(`Intervention moved to ${status.replaceAll('_', ' ')}.`)
  }

  async function addNote(event: React.FormEvent) {
    event.preventDefault()
    if (!intervention || !noteBody.trim()) return
    setSaving(true)
    const result = await api.createInterventionNote(intervention.id, noteBody.trim())
    setSaving(false)
    if (!result.data) return toast.error(result.error || 'Could not add the private note.')
    setNoteBody('')
    await load()
    toast.success('Private staff note added.')
  }

  async function resolveIntervention(event: React.FormEvent) {
    event.preventDefault()
    if (!intervention || !resolution.trim()) return
    setSaving(true)
    const result = await api.updateIntervention(intervention.id, { status: 'resolved', outcome, resolution_summary: resolution.trim() })
    setSaving(false)
    if (!result.data) return toast.error(result.error || 'Could not resolve the intervention.')
    captureProductEvent('intervention_resolved', { cohort_id: intervention.enrollment.cohort.id, intervention_id: intervention.id, trigger_type: intervention.trigger_type, outcome, age_bucket: analyticsAgeBucket(intervention.created_at) })
    setIntervention(result.data.intervention)
    toast.success('Intervention resolved with an auditable outcome.')
  }

  async function openMessage() {
    if (!intervention) return
    setSaving(true)
    const result = await api.createDirectConversation({ cohort_id: intervention.enrollment.cohort.id, user_ids: [intervention.enrollment.student.id] })
    setSaving(false)
    if (result.data) navigate(`/messages/dm/${result.data.direct_conversation.id}`)
    else toast.error(result.error || 'Could not open the direct message.')
  }

  async function createPlan(event: React.FormEvent) {
    event.preventDefault()
    if (!intervention) return
    setSaving(true)
    const result = await api.createRecoveryPlan({
      enrollment_id: intervention.enrollment.id,
      intervention_id: intervention.id,
      source: intervention.trigger_type === 'extended_absence' ? 'extended_absence' : 'manual',
      target_pace: planDraft.target_pace.trim(),
      required_scope: planDraft.required_scope.trim(),
      optional_scope: planDraft.optional_scope.trim(),
      next_check_in_at: intervention.next_follow_up_at || undefined,
    })
    setSaving(false)
    if (!result.data) return toast.error(result.error || 'Could not create the recovery plan.')
    setPlan(result.data.recovery_plan)
    setShowPlanForm(false)
    await load()
    toast.success('Recovery plan created and connected to this intervention.')
  }

  async function addCheckIn(event: React.FormEvent) {
    event.preventDefault()
    if (!plan || !checkInBody.trim()) return
    setSaving(true)
    const result = await api.createRecoveryPlanCheckIn(plan.id, { body: checkInBody.trim() })
    setSaving(false)
    if (!result.data) return toast.error(result.error || 'Could not record the check-in.')
    setPlan(result.data.recovery_plan)
    setCheckInBody('')
    toast.success('Recovery check-in recorded; the next check-in is scheduled.')
  }

  if (loading) return <LoadingSpinner message="Loading intervention history…" />
  if (!intervention || error) return <div className="app-page"><EmptyState icon={ShieldAlert} title="Could not open intervention" description={error || 'This record is unavailable.'} action={<Button onClick={() => { setLoading(true); void load() }}><RefreshCw className="h-4 w-4" />Try again</Button>} /></div>

  const studentPath = cohortStudentPath(intervention.enrollment.cohort.id, intervention.enrollment.student.id, 'support')
  const returnTo = safeInternalReturnPath(searchParams.get('return_to'), '/admin/support')
  const terminal = intervention.status === 'resolved' || intervention.status === 'canceled'

  return <div className="app-page-wide space-y-6">
    <Link to={returnTo} className="app-link inline-flex min-h-11 items-center gap-2 text-sm font-bold"><ArrowLeft className="h-4 w-4" />Back to support</Link>
    <PageHeader eyebrow="Intervention record" title={intervention.enrollment.student.full_name} description={`${intervention.enrollment.cohort.name} · ${intervention.trigger_type.replaceAll('_', ' ')} · opened ${formatShortDateTime(intervention.created_at)}`} actions={<div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => void openMessage()} disabled={saving}><MessageSquareText className="h-4 w-4" />Message</Button><Link to={studentPath} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 text-sm font-bold text-white hover:bg-primary-700"><UserRound className="h-4 w-4" />Student workspace</Link></div>} />

    <section className={`rounded-2xl border p-5 sm:p-6 ${intervention.follow_up_due ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-white'}`}>
      <div className="flex flex-wrap items-center gap-2"><Badge value={intervention.severity} urgent={intervention.severity === 'urgent'} /><Badge value={intervention.status} /><Badge value={intervention.trigger_type} /></div>
      <div className="mt-4 grid gap-4 sm:grid-cols-3"><Info label="Owner" value={intervention.owner.full_name} /><Info label="Next follow-up" value={formatShortDateTime(intervention.next_follow_up_at, 'Not scheduled')} /><Info label="Created by" value={intervention.created_by.full_name} /></div>
      {intervention.follow_up_due && <p className="mt-4 inline-flex items-center gap-2 text-sm font-extrabold text-red-700"><CalendarClock className="h-4 w-4" />Follow-up is due now</p>}
    </section>

    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
      <div className="space-y-6">
        <section className="app-surface p-5 sm:p-6"><h2 className="text-lg font-extrabold text-slate-950">Evidence snapshot</h2><p className="mt-1 text-sm text-slate-500">Server-generated record IDs, dates, categories, and counts only. No messages, student work, or private feedback are copied here.</p><dl className="mt-4 grid gap-3 sm:grid-cols-2">{Object.entries(intervention.evidence_snapshot).map(([key, value]) => <Info key={key} label={key.replaceAll('_', ' ')} value={formatEvidence(value)} />)}{Object.keys(intervention.evidence_snapshot).length === 0 && <p className="text-sm text-slate-500">This manual intervention has no source evidence snapshot.</p>}</dl></section>

        {!terminal && <form onSubmit={saveWorkflow} className="app-surface p-5 sm:p-6"><h2 className="text-lg font-extrabold text-slate-950">Owned workflow</h2><div className="mt-4 grid gap-4"><label className="text-sm font-bold text-slate-800">Current state<select value={intervention.status} onChange={(event) => void setStatus(event.target.value as InterventionStatus)} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm">{activeStatuses.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}</select></label><label className="text-sm font-bold text-slate-800">Action / next step<textarea value={actionSummary} onChange={(event) => setActionSummary(event.target.value)} rows={4} maxLength={2000} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm leading-6" placeholder="Document what staff will do next." /></label><label className="text-sm font-bold text-slate-800">Next follow-up<input type="datetime-local" required value={followUpAt} onChange={(event) => setFollowUpAt(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" /></label><Button type="submit" disabled={saving || !followUpAt}><CalendarClock className="h-4 w-4" />{saving ? 'Saving…' : 'Save workflow'}</Button></div></form>}

        <section className="app-surface overflow-hidden"><div className="border-b border-slate-100 px-5 py-4 sm:px-6"><h2 className="text-lg font-extrabold text-slate-950">Private staff history</h2><p className="mt-1 text-sm text-slate-500">These notes never appear in student or session payloads.</p></div><div className="divide-y divide-slate-100">{(intervention.notes || []).map((note) => <article key={note.id} className="px-5 py-4 sm:px-6"><p className="whitespace-pre-wrap text-sm leading-6 text-slate-800">{note.body}</p><p className="mt-2 text-xs font-semibold text-slate-400">{note.author.full_name} · {formatShortDateTime(note.created_at)}</p></article>)}{!intervention.notes?.length && <p className="px-6 py-5 text-sm text-slate-500">No private notes yet.</p>}</div>{!terminal && <form onSubmit={addNote} className="border-t border-slate-100 p-5 sm:p-6"><label className="text-sm font-bold text-slate-800">Add private note<textarea value={noteBody} onChange={(event) => setNoteBody(event.target.value)} rows={4} maxLength={4000} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm leading-6" /></label><Button className="mt-3" type="submit" disabled={saving || !noteBody.trim()}><History className="h-4 w-4" />Add to history</Button></form>}</section>
      </div>

      <div className="space-y-6">
        <RecoveryPlanCard plan={plan} showForm={showPlanForm} draft={planDraft} setDraft={setPlanDraft} onShowForm={() => setShowPlanForm(true)} onCreate={createPlan} checkInBody={checkInBody} setCheckInBody={setCheckInBody} onCheckIn={addCheckIn} saving={saving} />
        {!terminal ? <form onSubmit={resolveIntervention} className="rounded-2xl border border-green-200 bg-green-50 p-5 sm:p-6"><CheckCircle2 className="h-7 w-7 text-green-700" /><h2 className="mt-3 text-lg font-extrabold text-green-950">Resolve with an outcome</h2><p className="mt-1 text-sm text-green-800">Closing a case requires a categorical outcome and a concise resolution summary.</p><label className="mt-4 block text-sm font-bold text-green-950">Outcome<select value={outcome} onChange={(event) => setOutcome(event.target.value as InterventionOutcome)} className="mt-2 min-h-11 w-full rounded-xl border border-green-300 bg-white px-3 text-sm">{outcomes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label className="mt-4 block text-sm font-bold text-green-950">Resolution summary<textarea value={resolution} onChange={(event) => setResolution(event.target.value)} rows={5} maxLength={2000} className="mt-2 w-full rounded-xl border border-green-300 bg-white px-3 py-2 text-sm leading-6" /></label><Button className="mt-4" type="submit" disabled={saving || !resolution.trim()}><CheckCircle2 className="h-4 w-4" />Resolve intervention</Button></form> : <section className="rounded-2xl border border-green-200 bg-green-50 p-5 sm:p-6"><CheckCircle2 className="h-7 w-7 text-green-700" /><h2 className="mt-3 text-lg font-extrabold text-green-950">{intervention.status === 'resolved' ? 'Resolved' : 'Canceled'}</h2>{intervention.outcome && <p className="mt-2 text-sm font-bold capitalize text-green-900">Outcome: {intervention.outcome.replaceAll('_', ' ')}</p>}<p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-green-900">{intervention.resolution_summary}</p><p className="mt-3 text-xs font-semibold text-green-700">Closed {formatShortDateTime(intervention.resolved_at)}</p></section>}
        {intervention.help_request_id && <Link to={`/admin/help-requests/${intervention.help_request_id}?return_to=${encodeURIComponent(location.pathname)}`} className="app-surface group flex min-h-16 items-center gap-3 p-4"><LifeBuoy className="h-5 w-5 text-primary-700" /><span className="flex-1 text-sm font-bold text-slate-800">Open source help request</span><ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-primary-700" /></Link>}
      </div>
    </div>
  </div>
}

function RecoveryPlanCard({ plan, showForm, draft, setDraft, onShowForm, onCreate, checkInBody, setCheckInBody, onCheckIn, saving }: { plan: RecoveryPlan | null; showForm: boolean; draft: { target_pace: string; required_scope: string; optional_scope: string }; setDraft: React.Dispatch<React.SetStateAction<{ target_pace: string; required_scope: string; optional_scope: string }>>; onShowForm: () => void; onCreate: (event: React.FormEvent) => void; checkInBody: string; setCheckInBody: (value: string) => void; onCheckIn: (event: React.FormEvent) => void; saving: boolean }) {
  if (!plan && !showForm) return <section className="app-surface p-5 sm:p-6"><ClipboardCheck className="h-7 w-7 text-primary-700" /><h2 className="mt-3 text-lg font-extrabold text-slate-950">No recovery plan</h2><p className="mt-1 text-sm leading-6 text-slate-600">Add a pace, required scope, and weekly check-in when a learner is returning after an interruption.</p><Button className="mt-4" variant="secondary" onClick={onShowForm}><ClipboardCheck className="h-4 w-4" />Create recovery plan</Button></section>
  if (!plan) return <form onSubmit={onCreate} className="app-surface p-5 sm:p-6"><h2 className="text-lg font-extrabold text-slate-950">Create recovery plan</h2><div className="mt-4 grid gap-4"><PlanField label="Target pace" value={draft.target_pace} onChange={(value) => setDraft((current) => ({ ...current, target_pace: value }))} /><PlanField label="Required scope" value={draft.required_scope} onChange={(value) => setDraft((current) => ({ ...current, required_scope: value }))} multiline /><PlanField label="Optional scope" value={draft.optional_scope} onChange={(value) => setDraft((current) => ({ ...current, optional_scope: value }))} multiline /><Button type="submit" disabled={saving || !draft.target_pace.trim() || !draft.required_scope.trim()}>Create plan</Button></div></form>
  return <section className={`rounded-2xl border p-5 sm:p-6 ${plan.check_in_due ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'}`}><div className="flex items-center justify-between gap-3"><div><p className="app-eyebrow">Recovery plan</p><h2 className="mt-1 text-lg font-extrabold text-slate-950">{plan.target_pace}</h2></div><Badge value={plan.status} /></div><p className="mt-4 text-sm font-bold text-slate-800">Required</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-600">{plan.required_scope}</p>{plan.optional_scope && <><p className="mt-4 text-sm font-bold text-slate-800">Optional</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-600">{plan.optional_scope}</p></>}<p className={`mt-4 inline-flex items-center gap-2 text-sm font-bold ${plan.check_in_due ? 'text-amber-800' : 'text-slate-600'}`}><CalendarClock className="h-4 w-4" />Next check-in {formatShortDateTime(plan.next_check_in_at)}</p>{plan.check_ins?.map((checkIn) => <article key={checkIn.id} className="mt-4 border-t border-slate-200 pt-4"><p className="text-sm leading-6 text-slate-700">{checkIn.body}</p><p className="mt-1 text-xs font-semibold text-slate-400">{checkIn.author.full_name} · {formatShortDateTime(checkIn.created_at)}</p></article>)}{plan.status === 'active' && <form onSubmit={onCheckIn} className="mt-5 border-t border-slate-200 pt-4"><label className="text-sm font-bold text-slate-800">Record check-in<textarea value={checkInBody} onChange={(event) => setCheckInBody(event.target.value)} rows={4} maxLength={4000} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm leading-6" /></label><Button className="mt-3" type="submit" disabled={saving || !checkInBody.trim()}><ClipboardCheck className="h-4 w-4" />Save check-in</Button></form>}</section>
}

function PlanField({ label, value, onChange, multiline = false }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean }) {
  return <label className="text-sm font-bold text-slate-800">{label}{multiline ? <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={3} maxLength={2000} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm leading-6" /> : <input value={value} onChange={(event) => onChange(event.target.value)} maxLength={200} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" />}</label>
}

function Badge({ value, urgent = false }: { value: string; urgent?: boolean }) { return <span className={`rounded-full px-2.5 py-1 text-xs font-extrabold capitalize ${urgent ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-700'}`}>{value.replaceAll('_', ' ')}</span> }
function Info({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs font-extrabold uppercase tracking-wide text-slate-400">{label}</dt><dd className="mt-1 text-sm font-bold text-slate-800">{value}</dd></div> }
function formatEvidence(value: unknown) { if (Array.isArray(value)) return value.join(', ') || 'None'; if (value && typeof value === 'object') return Object.entries(value).map(([key, item]) => `${key.replaceAll('_', ' ')}: ${item}`).join(' · '); return String(value) }
function toLocalDateTime(value: string | null) { if (!value) return ''; const date = new Date(value); const offset = date.getTimezoneOffset() * 60_000; return new Date(date.getTime() - offset).toISOString().slice(0, 16) }
