import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ReturnOrigin } from '../../contexts/PreviewNavigationContext'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowRight, CalendarClock, CheckCircle2, ClipboardCheck, History, MessageSquareText, RefreshCw, ShieldAlert, UserRound } from 'lucide-react'
import { api } from '../../lib/api'
import { analyticsAgeBucket, captureProductEvent } from '../../lib/analytics'
import { cohortPath, cohortStudentPath, directMessagePath } from '../../lib/routes'
import { recordRefFromDestination } from '../../lib/searchDestination'
import { useBackLink } from '../../lib/recordOrigin'
import { relatedRows, useRecordRelated } from '../../lib/recordRelated'
import { useRecordViewer } from '../../lib/useRecordPath'
import { RecordHeader, staffBreadcrumb } from '../../components/shared/RecordHeader'
import { RelatedPanel, scrollToSection } from '../../components/shared/RelatedPanel'
import { RecordLink } from '../../components/shared/RecordLink'
import { formatShortDateTime } from '../../lib/format'
import { useToast } from '../../contexts/ToastContext'
import { EmptyState } from '../../components/shared/EmptyState'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { Button, LinkButton } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import type { Intervention, InterventionOutcome, InterventionStatus, RecoveryPlan } from '../../types/api'
import { TERMS } from '../../lib/glossary'
import { FOLLOW_UP_OUTCOME_LABELS, FOLLOW_UP_STATUS_LABELS, HIDDEN_SNAPSHOT_KEYS, followUpLabel, snapshotLabel } from '../../lib/followUpLabels'

const activeStatuses: Array<{ value: InterventionStatus; label: string }> = (['open', 'contacted', 'waiting_on_student', 'monitoring'] as const)
  .map((value) => ({ value, label: FOLLOW_UP_STATUS_LABELS[value] }))

const outcomes: Array<{ value: InterventionOutcome; label: string }> = (Object.keys(FOLLOW_UP_OUTCOME_LABELS) as InterventionOutcome[])
  .map((value) => ({ value, label: FOLLOW_UP_OUTCOME_LABELS[value] }))

export function InterventionDetail() {
  const interventionId = Number(useParams<{ id: string }>().id)
  const location = useLocation()
  const viewer = useRecordViewer()
  const back = useBackLink({ returnTo: '/admin/support', returnLabel: 'Support' })
  const related = useRecordRelated('intervention', Number.isInteger(interventionId) && interventionId > 0 ? interventionId : null)
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
  const [planDraft, setPlanDraft] = useState({ target_pace: 'Two required lessons each week', required_scope: 'Finish the lessons that are required now.', optional_scope: 'Use recordings and optional practice where they help with the required work.' })

  const load = useCallback(async () => {
    if (!Number.isInteger(interventionId) || interventionId <= 0) {
      setError('This follow-up plan link is invalid.')
      setLoading(false)
      return
    }
    setError(null)
    const result = await api.getIntervention(interventionId)
    if (!result.data) {
      setError(result.error || 'Could not load this follow-up plan.')
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
    if (!result.data) return toast.error(result.error || 'Could not update the follow-up plan.')
    setIntervention(result.data.intervention)
    toast.success('Next steps saved.')
  }

  async function setStatus(status: InterventionStatus) {
    if (!intervention || status === intervention.status) return
    setSaving(true)
    const result = await api.updateIntervention(intervention.id, { status })
    setSaving(false)
    if (!result.data) return toast.error(result.error || 'Could not update the status.')
    setIntervention(result.data.intervention)
    toast.success(`Status changed to ${FOLLOW_UP_STATUS_LABELS[status].toLowerCase()}.`)
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
    if (!result.data) return toast.error(result.error || 'Could not resolve the follow-up plan.')
    captureProductEvent('intervention_resolved', { cohort_id: intervention.enrollment.cohort.id, intervention_id: intervention.id, trigger_type: intervention.trigger_type, outcome, age_bucket: analyticsAgeBucket(intervention.created_at) })
    setIntervention(result.data.intervention)
    toast.success('Follow-up plan resolved.')
  }

  async function openMessage() {
    if (!intervention) return
    setSaving(true)
    const result = await api.createDirectConversation({ cohort_id: intervention.enrollment.cohort.id, user_ids: [intervention.enrollment.student.id] })
    setSaving(false)
    // The plan is the message's source (L-2.5): staff see "From follow-up plan" and can get back here.
    if (result.data) navigate(directMessagePath(result.data.direct_conversation.id, { type: 'intervention', id: intervention.id, label: `${intervention.enrollment.student.full_name} · ${followUpLabel(intervention.trigger_type)}`, returnTo: back.fallback ? undefined : back.to }))
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
    if (!result.data) return toast.error(result.error || 'Could not create the return plan.')
    setPlan(result.data.recovery_plan)
    setShowPlanForm(false)
    await load()
    toast.success('Return plan added to this follow-up plan.')
  }

  async function addCheckIn(event: React.FormEvent) {
    event.preventDefault()
    if (!plan || !checkInBody.trim()) return
    setSaving(true)
    const result = await api.createRecoveryPlanCheckIn(plan.id, { body: checkInBody.trim() })
    setSaving(false)
    if (!result.data) return toast.error(result.error || 'Could not save the follow-up note.')
    setPlan(result.data.recovery_plan)
    setCheckInBody('')
    toast.success('Follow-up note saved. The next follow-up is scheduled.')
  }

  if (loading) return <LoadingSpinner message="Loading follow-up plan…" />
  if (!intervention || error) return <div className="app-page"><EmptyState icon={ShieldAlert} title="Could not open follow-up plan" description={error || 'This follow-up plan is unavailable.'} action={<Button onClick={() => { setLoading(true); void load() }}><RefreshCw className="h-4 w-4" aria-hidden="true" />Try again</Button>} /></div>

  const studentPath = cohortStudentPath(intervention.enrollment.cohort.id, intervention.enrollment.student.id, 'support')
  const terminal = intervention.status === 'resolved' || intervention.status === 'canceled'
  const { cohort, student } = intervention.enrollment
  const evidence = Object.entries(intervention.evidence_snapshot).filter(([key]) => !HIDDEN_SNAPSHOT_KEYS.has(key))
  // Saved ids that still open, linked through the destination contract (L-2.5); the rest stay plain text.
  const links = intervention.evidence_links ?? []
  const evidenceLink = (key: string, id: unknown, label: ReactNode) => {
    const link = links.find((item) => item.key === key && String(item.id) === String(id))
    const record = link?.destination ? recordRefFromDestination(link.destination) : null
    return record ? <RecordLink record={record} variant="inline" returnLabel={`${TERMS.followUpPlan} · ${student.full_name}`}>{label}</RecordLink> : label
  }
  // The source request and where it was asked: linked when the server resolved
  // them, otherwise the saved id as plain text, never dropped.
  const snapshot = intervention.evidence_snapshot as Record<string, unknown>
  const savedId = (key: string) => (typeof snapshot[key] === 'number' || typeof snapshot[key] === 'string') && String(snapshot[key]).trim() ? String(snapshot[key]) : null
  const requestLink = links.find((item) => item.key === 'help_request_id')
  const contextLink = links.find((item) => item.key === 'context_id')
  const sourceRequest = requestLink ? evidenceLink('help_request_id', requestLink.id, requestLink.label) : savedId('help_request_id') && `Help request #${savedId('help_request_id')}`
  const contextType = typeof snapshot.context_type === 'string' ? snapshot.context_type : null
  const contextLabel = contextLink?.destination?.kind === 'recording' ? 'Recording' : contextType === 'recording' ? 'Recording' : 'Asked from'
  const sourceContext = contextLink ? evidenceLink('context_id', contextLink.id, contextLink.label) : savedId('context_id') && `${contextType ? followUpLabel(contextType) : 'Item'} #${savedId('context_id')}`
  const renderEvidence = (key: string, value: unknown): ReactNode => key === 'submission_ids' && Array.isArray(value)
    ? value.length ? <span className="flex flex-wrap gap-x-2 gap-y-1">{value.map((id, index) => <span key={String(id)}>{evidenceLink(key, id, `#${id}`)}{index < value.length - 1 ? ',' : ''}</span>)}</span> : 'None'
    : formatEvidence(key, value)
  const rows = related.related ? relatedRows(related.related, { viewer, returnTo: `${location.pathname}${location.search}`, actions: { message: () => void openMessage(), scrollTo: scrollToSection } }) : []

  return <ReturnOrigin label={`${TERMS.followUpPlan} · ${student.full_name}`}><div className="app-page-wide space-y-6">
    <RecordHeader
      back={back}
      breadcrumb={staffBreadcrumb({ cohort: { label: cohort.name, to: cohortPath(cohort.id) }, student: { label: student.full_name, to: cohortStudentPath(cohort.id, student.id) }, record: TERMS.followUpPlan })}
      type={<span>{TERMS.followUpPlan} · {followUpLabel(intervention.trigger_type)}</span>}
      title={student.full_name}
      status={<>{intervention.severity === 'urgent' && <ValueBadge value="urgent" urgent />}<ValueBadge value={intervention.status} /></>}
      context={<>
        <RecordLink record={{ type: 'cohort', id: cohort.id }} variant="plain" touchTarget className="font-normal text-ink-muted">{cohort.name}</RecordLink>
        <span aria-hidden="true">·</span>
        <span className="tabular-nums">Started {formatShortDateTime(intervention.created_at)}</span>
      </>}
      actions={<><Button variant="secondary" size="sm" onClick={() => void openMessage()} disabled={saving}><MessageSquareText className="h-4 w-4" aria-hidden="true" />Message</Button><LinkButton to={studentPath} variant="secondary" size="sm"><UserRound className="h-4 w-4" aria-hidden="true" />Student page</LinkButton></>}
    />

    <section className={`rounded-2xl border p-5 shadow-raised sm:p-6 ${intervention.follow_up_due ? 'border-warning-line bg-warning-soft' : 'border-line bg-surface-raised'}`}>
      <div className="flex flex-wrap items-center gap-2"><ValueBadge value={intervention.severity} urgent={intervention.severity === 'urgent'} /><ValueBadge value={intervention.status} /><ValueBadge value={intervention.trigger_type} /></div>
      {intervention.owner_valid === false && <p role="status" className="mt-4 text-sm text-warning-ink">This owner no longer has access to this cohort. Ask an admin to give this follow-up plan to an instructor or admin in this cohort.</p>}
      <dl className="mt-4 grid gap-4 sm:grid-cols-3"><Info label="Owner" value={intervention.owner.full_name} /><Info label="Next follow-up" value={formatShortDateTime(intervention.next_follow_up_at, 'Not scheduled')} /><Info label="Created by" value={intervention.created_by.full_name} /></dl>
      {intervention.follow_up_due && <p className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-warning-ink"><CalendarClock className="h-4 w-4" aria-hidden="true" />Follow-up is due now</p>}
    </section>

    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
      <div className="space-y-6">
        <section id="evidence" tabIndex={-1} className="app-surface scroll-mt-24 p-5 outline-none sm:p-6"><h2 className="text-lg font-bold text-ink">Why this plan started</h2><p className="mt-1 text-sm text-ink-muted">Dates, categories and counts saved when the plan started. Messages, student work and private feedback aren't copied here.</p><dl className="mt-4 grid gap-3 sm:grid-cols-2">{sourceRequest && <Info label="Help request" value={sourceRequest} />}{sourceContext && <Info label={contextLabel} value={sourceContext} />}{evidence.map(([key, value]) => <Info key={key} label={snapshotLabel(key)} value={renderEvidence(key, value)} />)}{evidence.length === 0 && !sourceRequest && <p className="text-sm text-ink-muted">Started by staff, so there are no saved details.</p>}</dl></section>

        {!terminal && <form onSubmit={saveWorkflow} className="app-surface p-5 sm:p-6"><h2 className="text-lg font-bold text-ink">Next steps</h2><div className="mt-4 grid gap-4"><label className="text-sm font-semibold text-ink">Status<select value={intervention.status} onChange={(event) => void setStatus(event.target.value as InterventionStatus)} className="app-control mt-2 w-full font-normal">{activeStatuses.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}</select></label><label className="text-sm font-semibold text-ink">Next step<textarea value={actionSummary} onChange={(event) => setActionSummary(event.target.value)} rows={4} maxLength={2000} className="app-control mt-2 w-full font-normal leading-6" placeholder="Document what staff will do next." /></label><label className="text-sm font-semibold text-ink">Next follow-up<input type="datetime-local" required value={followUpAt} onChange={(event) => setFollowUpAt(event.target.value)} className="app-control mt-2 w-full font-normal tabular-nums" /></label><Button type="submit" className="justify-self-start" disabled={saving || !followUpAt}><CalendarClock className="h-4 w-4" aria-hidden="true" />{saving ? 'Saving…' : 'Save next steps'}</Button></div></form>}

        <section className="app-surface overflow-hidden"><div className="border-b border-line px-5 py-4 sm:px-6"><h2 className="text-lg font-bold text-ink">Private staff history</h2><p className="mt-1 text-sm text-ink-muted">Only staff can see these notes.</p></div><div className="divide-y divide-line">{(intervention.notes || []).map((note) => <article key={note.id} className="px-5 py-4 sm:px-6"><p className="whitespace-pre-wrap text-sm leading-6 text-ink [overflow-wrap:anywhere]">{note.body}</p><p className="mt-2 text-xs font-semibold tabular-nums text-ink-muted">{note.author.full_name} · {formatShortDateTime(note.created_at)}</p></article>)}{!intervention.notes?.length && <p className="px-6 py-5 text-sm text-ink-muted">No private notes yet.</p>}</div>{!terminal && <form onSubmit={addNote} className="border-t border-line p-5 sm:p-6"><label className="block text-sm font-semibold text-ink">Add private note<textarea value={noteBody} onChange={(event) => setNoteBody(event.target.value)} rows={4} maxLength={4000} className="app-control mt-2 w-full font-normal leading-6" /></label><Button className="mt-3" variant="secondary" type="submit" disabled={saving || !noteBody.trim()}><History className="h-4 w-4" aria-hidden="true" />Add to history</Button></form>}</section>
      </div>

      <div className="space-y-6">
        <RelatedPanel rows={rows} loading={related.loading} error={related.error} onRetry={related.retry} returnLabel={`${TERMS.followUpPlan} · ${student.full_name}`} />
        <div id="recovery-plan" tabIndex={-1} className="scroll-mt-24 outline-none"><RecoveryPlanCard planPath={plan ? `${cohortStudentPath(cohort.id, student.id, 'support')}?plan_id=${plan.id}` : null} plan={plan} showForm={showPlanForm} draft={planDraft} setDraft={setPlanDraft} onShowForm={() => setShowPlanForm(true)} onCreate={createPlan} checkInBody={checkInBody} setCheckInBody={setCheckInBody} onCheckIn={addCheckIn} saving={saving} /></div>
        {!terminal ? <form onSubmit={resolveIntervention} className="rounded-2xl border border-success-line bg-success-soft p-5 sm:p-6"><CheckCircle2 className="h-7 w-7 text-success-ink" aria-hidden="true" /><h2 className="mt-3 text-lg font-bold text-ink">Resolve with an outcome</h2><p className="mt-1 text-sm text-success-ink">Choose an outcome and write a short summary to close this plan.</p><label className="mt-4 block text-sm font-semibold text-ink">Outcome<select value={outcome} onChange={(event) => setOutcome(event.target.value as InterventionOutcome)} className="app-control mt-2 w-full font-normal">{outcomes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label className="mt-4 block text-sm font-semibold text-ink">Resolution summary<textarea value={resolution} onChange={(event) => setResolution(event.target.value)} rows={5} maxLength={2000} className="app-control mt-2 w-full font-normal leading-6" /></label><Button className="mt-4" type="submit" disabled={saving || !resolution.trim()}><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Resolve follow-up plan</Button></form> : <section className={`rounded-2xl border p-5 sm:p-6 ${intervention.status === 'resolved' ? 'border-success-line bg-success-soft' : 'border-line bg-surface-sunken'}`}><CheckCircle2 className={`h-7 w-7 ${intervention.status === 'resolved' ? 'text-success-ink' : 'text-ink-muted'}`} aria-hidden="true" /><h2 className="mt-3 text-lg font-bold text-ink">{intervention.status === 'resolved' ? 'Resolved' : 'Canceled'}</h2>{intervention.outcome && <p className="mt-2 text-sm font-semibold text-ink">Outcome: {FOLLOW_UP_OUTCOME_LABELS[intervention.outcome] ?? followUpLabel(intervention.outcome)}</p>}<p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink-secondary [overflow-wrap:anywhere]">{intervention.resolution_summary}</p><p className="mt-3 text-xs font-semibold tabular-nums text-ink-muted">Closed {formatShortDateTime(intervention.resolved_at)}</p></section>}
      </div>
    </div>
  </div></ReturnOrigin>
}

function RecoveryPlanCard({ planPath, plan, showForm, draft, setDraft, onShowForm, onCreate, checkInBody, setCheckInBody, onCheckIn, saving }: { planPath: string | null; plan: RecoveryPlan | null; showForm: boolean; draft: { target_pace: string; required_scope: string; optional_scope: string }; setDraft: React.Dispatch<React.SetStateAction<{ target_pace: string; required_scope: string; optional_scope: string }>>; onShowForm: () => void; onCreate: (event: React.FormEvent) => void; checkInBody: string; setCheckInBody: (value: string) => void; onCheckIn: (event: React.FormEvent) => void; saving: boolean }) {
  if (!plan && !showForm) return <section className="app-surface p-5 sm:p-6"><ClipboardCheck className="h-7 w-7 text-ink-muted" aria-hidden="true" /><h2 className="mt-3 text-lg font-bold text-ink">No return plan</h2><p className="mt-1 text-sm leading-6 text-ink-secondary">When a student is coming back after time away, set a pace, the required work, and a weekly follow-up.</p><Button className="mt-4" variant="secondary" onClick={onShowForm}><ClipboardCheck className="h-4 w-4" aria-hidden="true" />Create return plan</Button></section>
  if (!plan) return <form onSubmit={onCreate} className="app-surface p-5 sm:p-6"><h2 className="text-lg font-bold text-ink">Create return plan</h2><div className="mt-4 grid gap-4"><PlanField label="Target pace" value={draft.target_pace} onChange={(value) => setDraft((current) => ({ ...current, target_pace: value }))} /><PlanField label="Required work" value={draft.required_scope} onChange={(value) => setDraft((current) => ({ ...current, required_scope: value }))} multiline /><PlanField label="Optional work" value={draft.optional_scope} onChange={(value) => setDraft((current) => ({ ...current, optional_scope: value }))} multiline /><Button type="submit" className="justify-self-start" disabled={saving || !draft.target_pace.trim() || !draft.required_scope.trim()}>Create plan</Button></div></form>
  return <section className={`rounded-2xl border p-5 shadow-raised sm:p-6 ${plan.check_in_due ? 'border-warning-line bg-warning-soft' : 'border-line bg-surface-raised'}`}><div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="text-xs font-semibold text-ink-muted">{TERMS.returnPlan}</p><h2 className="mt-1 text-lg font-bold text-ink">{plan.target_pace}</h2></div><ValueBadge value={plan.status} /></div>{planPath && <LinkButton to={planPath} variant="quiet" size="sm" className="mt-2 -ml-2">Open in student page <ArrowRight className="h-4 w-4" aria-hidden="true" /></LinkButton>}{plan.owner_valid === false && <p role="status" className="mt-4 text-sm text-warning-ink">This plan's owner no longer has access to this cohort. Ask an admin to give the plan to someone else.</p>}<p className="mt-4 text-sm font-semibold text-ink">Required</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink-secondary">{plan.required_scope}</p>{plan.optional_scope && <><p className="mt-4 text-sm font-semibold text-ink">Optional</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink-secondary">{plan.optional_scope}</p></>}<p className={`mt-4 inline-flex items-center gap-2 text-sm font-semibold tabular-nums ${plan.check_in_due ? 'text-warning-ink' : 'text-ink-secondary'}`}><CalendarClock className="h-4 w-4" aria-hidden="true" />Next follow-up {formatShortDateTime(plan.next_check_in_at)}</p>{plan.check_ins?.map((checkIn) => <article key={checkIn.id} className="mt-4 border-t border-line pt-4"><p className="text-sm leading-6 text-ink-secondary [overflow-wrap:anywhere]">{checkIn.body}</p><p className="mt-1 text-xs font-semibold tabular-nums text-ink-muted">{checkIn.author.full_name} · {formatShortDateTime(checkIn.created_at)}</p></article>)}{plan.status === 'active' && <form onSubmit={onCheckIn} className="mt-5 border-t border-line pt-4"><label className="block text-sm font-semibold text-ink">Add follow-up note<textarea value={checkInBody} onChange={(event) => setCheckInBody(event.target.value)} rows={4} maxLength={4000} className="app-control mt-2 w-full font-normal leading-6" /></label><Button className="mt-3" type="submit" disabled={saving || !checkInBody.trim()}><ClipboardCheck className="h-4 w-4" aria-hidden="true" />Save follow-up note</Button></form>}</section>
}

function PlanField({ label, value, onChange, multiline = false }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean }) {
  return <label className="text-sm font-semibold text-ink">{label}{multiline ? <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={3} maxLength={2000} className="app-control mt-2 w-full font-normal leading-6" /> : <input value={value} onChange={(event) => onChange(event.target.value)} maxLength={200} className="app-control mt-2 w-full font-normal" />}</label>
}

function ValueBadge({ value, urgent = false }: { value: string; urgent?: boolean }) { return <Badge tone={urgent ? 'danger' : 'neutral'}>{followUpLabel(value)}</Badge> }
function Info({ label, value }: { label: string; value: ReactNode }) { return <div className="min-w-0"><dt className="text-xs font-semibold text-ink-muted">{label}</dt><dd className="mt-1 text-sm font-semibold tabular-nums text-ink [overflow-wrap:anywhere]">{value}</dd></div> }
/** A saved snapshot value as words: dates formatted, submissions as "#812", stored values through labels. */
function formatEvidence(key: string, value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => key === 'submission_ids' ? `#${item}` : String(item)).join(', ') || 'None'
  if (value && typeof value === 'object') return Object.entries(value).map(([name, item]) => `${snapshotLabel(name)}: ${item}`).join(' · ')
  if (typeof value === 'string' && key.endsWith('_at')) return formatShortDateTime(value)
  if (typeof value === 'string' && ['category', 'urgency', 'context_type'].includes(key)) return followUpLabel(value)
  return String(value)
}
function toLocalDateTime(value: string | null) { if (!value) return ''; const date = new Date(value); const offset = date.getTimezoneOffset() * 60_000; return new Date(date.getTime() - offset).toISOString().slice(0, 16) }
