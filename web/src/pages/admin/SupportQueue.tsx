import { useAuthContext } from '../../contexts/AuthContext'
import { PreviewLink as Link } from '../../contexts/PreviewNavigationContext'
import { useCohortContext } from '../../contexts/CohortContext'
import { useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { ArrowRight, CalendarClock, CheckCircle2, CircleHelp, ClipboardPlus, Clock3, LifeBuoy, MessageSquareReply, RefreshCw, ShieldAlert, UserRoundCheck } from 'lucide-react'
import { api } from '../../lib/api'
import { trimBlankLines } from '../../lib/messageFormat'
import { useStaffResource } from '../../lib/useStaffResource'
import { LoadError } from '../../components/shared/LoadError'
import { cohortStudentPath, helpRequestPath, interventionPath } from '../../lib/routes'
import { analyticsAgeBucket, captureProductEvent } from '../../lib/analytics'
import { formatShortDateTime } from '../../lib/format'
import { useToast } from '../../contexts/ToastContext'
import { EmptyState } from '../../components/shared/EmptyState'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { AttentionRow, ATTENTION_CHECKED } from '../../components/admin/AttentionList'
import { Modal } from '../../components/shared/Modal'
import { Button, LinkButton } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { Avatar } from '../../components/ui/Avatar'
import { FilterChip, SegmentButton, SegmentedControl, TextButton } from '../../components/ui/Choice'
import { cohortScopeOptions, PageHeader, ScopeControl } from '../../components/ui/PageHeader'
import { markdownExcerpt } from '../../lib/plainText'
import { HelpReplyBox, useReplyAttempt, type HelpReplyAction } from '../../components/admin/HelpReplyBox'
import { useConfirm } from '../../contexts/ConfirmContext'
import { useLeaveGuard } from '../../lib/useLeaveGuard'
import { StudentContextDrawer } from '../../components/admin/StudentContextDrawer'
import type { HelpRequest, InterventionTrigger, SupportQueue as SupportQueueData, SupportQueueStudent } from '../../types/api'
import { RecordLink } from '../../components/shared/RecordLink'
import { filterSupportRequests, supportFiltersFromSearch } from '../../lib/recordQueue'
import { useListScrollMemory } from '../../lib/navigationContext'
import { TERMS } from '../../lib/glossary'
import { FOLLOW_UP_TRIGGER_LABELS, followUpLabel } from '../../lib/followUpLabels'

export function SupportQueue() {
  const { selectedCohort, cohorts = [] } = useCohortContext()
  const { schoolFeatures } = useAuthContext()
  const interventionsEnabled = (selectedCohort?.features?.interventions ?? schoolFeatures?.interventions) !== false
  const toast = useToast()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const cohortId = supportFiltersFromSearch(searchParams).cohortId ?? undefined
  const { data: queue, loading, error, reload: loadQueue } = useStaffResource<SupportQueueData>(String(cohortId), async () => {
    const result = await api.getSupportQueue(cohortId)
    return { data: result.data?.support_queue, error: result.error, fromCache: result.fromCache }
  })
  // Back from a help request returns to this list at the same scroll position.
  useListScrollMemory(Boolean(queue))
  const [savingId, setSavingId] = useState<number | null>(null)
  // One reply box open at a time (U-4.7), with the action that opened it as its primary button.
  const [replying, setReplying] = useState<{ id: number; primary: HelpReplyAction } | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState<HelpReplyAction | null>(null)
  const attempt = useReplyAttempt()
  const confirm = useConfirm()
  const guard = useLeaveGuard({
    dirty: Boolean(draft.trim()),
    confirm: () => confirm({ title: 'Discard your reply?', description: 'Your unsent reply to this help request will be lost.', confirmLabel: 'Discard reply', cancelLabel: 'Keep editing', tone: 'danger' }),
  })
  const [selectedStudent, setSelectedStudent] = useState<{ id: number; cohortId: number } | null>(null)
  const [creatingFor, setCreatingFor] = useState<SupportQueueStudent | null>(null)
  const [triggerType, setTriggerType] = useState<InterventionTrigger>('manual')
  const [actionSummary, setActionSummary] = useState('')
  const [followUpAt, setFollowUpAt] = useState(() => localDateTime(7))

  async function openReply(request: HelpRequest, primary: HelpReplyAction) {
    if (replying?.id === request.id) return setReplying({ id: request.id, primary })
    // Another request's unsent reply: ask before replacing it.
    if (!(await guard.confirmLeave())) return
    setDraft('')
    attempt.done()
    setReplying({ id: request.id, primary })
  }

  async function sendReply(request: HelpRequest, action: HelpReplyAction) {
    if (!draft.trim() || sending) return
    setSending(action)
    setSavingId(request.id)
    // A failed or lost send keeps its attempt id, so pressing again can't answer twice.
    const result = await api.replyToHelpRequest(request.id, { body: trimBlankLines(draft), resolve: action === 'resolve', client_request_id: attempt.id() })
    setSending(null)
    setSavingId(null)
    if (!result.data) {
      toast.error(result.error || 'Could not send this reply.')
      return
    }
    if (action === 'resolve') {
      captureProductEvent('help_request_resolved', {
        cohort_id: request.cohort.id,
        help_request_id: request.id,
        category: request.category,
        resolution_bucket: analyticsAgeBucket(request.created_at),
      })
    }
    guard.release()
    attempt.done()
    setReplying(null)
    setDraft('')
    toast.success(action === 'resolve' ? 'Reply sent and request resolved.' : 'Reply sent. The request stays open.')
    await loadQueue()
  }

  function startIntervention(student: SupportQueueStudent) {
    const trigger: InterventionTrigger = student.urgent_help_count || student.help_request_count ? 'help_request' : student.redo_count ? 'redo' : student.ungraded_count ? 'ungraded' : student.inactive ? 'inactivity' : 'manual'
    setCreatingFor(student)
    setTriggerType(trigger)
    setActionSummary(trigger === 'help_request' ? 'Answer the request and agree on the next lesson to work on.' : trigger === 'redo' ? 'Review the redo feedback and agree on a resubmission plan.' : trigger === 'ungraded' ? 'Review outstanding work and give the student a clear next step.' : trigger === 'inactivity' ? 'Contact the student and agree on a pace they can keep.' : '')
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
    if (!result.data) return toast.error(result.error || 'Could not start the follow-up plan.')
    captureProductEvent('intervention_opened', { cohort_id: creatingFor.cohort_id, intervention_id: result.data.intervention.id, trigger_type: result.data.intervention.trigger_type, severity: result.data.intervention.severity })
    setCreatingFor(null)
    toast.success('Follow-up plan started. You own it, and the first follow-up is scheduled.')
    await loadQueue()
  }

  if (loading && !queue) return <LoadingSpinner message="Loading Support…" />
  if (error && !queue) return <EmptyState icon={LifeBuoy} title="Could not load Support" description={error} action={<Button onClick={() => { void loadQueue() }}><RefreshCw className="h-4 w-4" />Try again</Button>} />
  if (!queue) return null

  // Shared with the help-request record, so its Previous/Next walk this exact filtered list (L-0.7).
  const { view, urgentOnly } = supportFiltersFromSearch(searchParams)
  const filteredRequests = filterSupportRequests(queue, { view, urgentOnly })
  const returnTo = `${location.pathname}${location.search}`
  // Choosing a filter adds a history entry, so browser Back undoes it.
  const setFilter = (key: 'view' | 'urgency', value: string) => {
    const next = new URLSearchParams(searchParams)
    if ((key === 'view' && value !== 'resolved') || (key === 'urgency' && value !== 'urgent')) next.delete(key)
    else next.set(key, value)
    setSearchParams(next, { preventScrollReset: true })
  }

  return (
    <div className="app-page-wide">
      <PageHeader
        title="Support"
        description={<>{queue.summary.open_help_count === 1 ? '1 open request' : `${queue.summary.open_help_count} open requests`}{cohortId ? <> in {cohorts.find((cohort) => cohort.id === cohortId)?.name || 'this cohort'}</> : null} · Student requests first, then signals from current learning activity</>}
        scope={<ScopeControl value={cohortId ? String(cohortId) : ''} options={cohortScopeOptions(!cohortId || cohorts.some((cohort) => cohort.id === cohortId) ? cohorts : [...cohorts, { id: cohortId, name: `Cohort ${cohortId}` }])} onChange={(value) => { const next = new URLSearchParams(searchParams); if (value) next.set('cohort_id', value); else next.delete('cohort_id'); setSearchParams(next) }} />}
        menu={[{ key: 'refresh', label: loading ? 'Refreshing…' : 'Refresh', icon: <RefreshCw aria-hidden="true" />, onSelect: () => void loadQueue() }]}
      />

      {error && <LoadError error={error} stale retry={() => void loadQueue()} />}
      <section aria-label="Support summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard label="Open requests" value={queue.summary.open_help_count} icon={CircleHelp} tone="pending" />
        {interventionsEnabled && queue.summary.active_intervention_count > 0 && <SummaryCard label="Active follow-up plans" value={queue.summary.active_intervention_count} icon={UserRoundCheck} tone="neutral" />}
        {interventionsEnabled && queue.summary.due_follow_up_count > 0 && <SummaryCard label="Follow-ups due" value={queue.summary.due_follow_up_count} icon={CalendarClock} tone="warning" />}
        {interventionsEnabled && queue.summary.due_recovery_check_in_count > 0 && <SummaryCard label="Return plan follow-ups due" value={queue.summary.due_recovery_check_in_count} icon={ClipboardPlus} tone="warning" />}
      </section>

      {interventionsEnabled && <details key={queue.summary.due_follow_up_count > 0 ? "due" : "quiet"} open={queue.summary.due_follow_up_count > 0} aria-label="Follow-up plans" className="app-surface overflow-hidden">
        <summary className="min-h-11 cursor-pointer px-5 py-4 text-sm font-semibold text-ink">{queue.interventions.length ? `${TERMS.followUpPlans} · ${queue.summary.active_intervention_count} active${queue.summary.due_follow_up_count ? ` · ${queue.summary.due_follow_up_count} due` : ""}` : "No open follow-up plans"}</summary>
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-5 py-4 sm:px-6"><div className="min-w-0"><p className="text-xs font-semibold text-ink-muted">Assigned to staff</p><h2 id="interventions-heading" className="mt-1 text-lg font-bold text-ink">{TERMS.followUpPlans}</h2><p className="mt-1 text-sm text-ink-muted">Every active plan has an owner, a next step, and a follow-up date.</p></div><Badge className="tabular-nums">{queue.summary.active_intervention_count} active</Badge></div>
        {queue.interventions.length === 0 ? <p className="px-6 py-8 text-center text-sm text-ink-muted">No active follow-up plans. Start one from a student under Needs attention.</p> : <div className="divide-y divide-line">{queue.interventions.map((intervention) => <Link key={intervention.id} to={interventionPath(intervention.id, returnTo)} className={`group pressable grid min-h-11 gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(160px,0.6fr)_minmax(160px,0.7fr)_auto] sm:items-center sm:px-6 ${intervention.follow_up_due ? 'bg-warning-soft hover:bg-warning-soft' : 'hover:bg-surface-sunken'}`}><div className="flex min-w-0 items-center gap-3"><Avatar name={intervention.enrollment.student.full_name} size="sm" /><div className="min-w-0"><div className="flex min-w-0 flex-wrap items-center gap-2"><p className="min-w-0 max-w-full truncate font-semibold text-ink group-hover:underline" title={intervention.enrollment.student.full_name}>{intervention.enrollment.student.full_name}</p>{intervention.severity === 'urgent' && <Badge tone="danger">Urgent</Badge>}</div><p className="mt-0.5 truncate text-xs text-ink-muted" title={`${intervention.enrollment.cohort.name} · ${followUpLabel(intervention.trigger_type)}`}>{intervention.enrollment.cohort.name} · {followUpLabel(intervention.trigger_type)}</p></div></div><div className="min-w-0"><p className="text-xs font-semibold text-ink-muted">Owner</p><p className="mt-1 truncate text-sm font-semibold text-ink-secondary" title={intervention.owner.full_name}>{intervention.owner.full_name}</p></div><div>{intervention.follow_up_due ? <Badge tone="warning" icon={<CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />}>Follow-up due</Badge> : <p className="text-xs font-semibold text-ink-muted">Next follow-up</p>}<p className="mt-1 text-sm font-semibold tabular-nums text-ink-secondary">{formatShortDateTime(intervention.next_follow_up_at)}</p></div><ArrowRight className="hidden h-4 w-4 text-ink-muted transition-colors duration-150 group-hover:text-ink sm:block" aria-hidden="true" /></Link>)}</div>}
      </details>}

      {interventionsEnabled && <details key={queue.summary.due_recovery_check_in_count > 0 ? 'recovery-due' : 'recovery-quiet'} open={queue.summary.due_recovery_check_in_count > 0} className="app-surface overflow-hidden">
        <summary className="min-h-11 cursor-pointer px-5 py-4 text-sm font-semibold text-ink">{queue.recovery_plans.length ? `Return plans · ${queue.recovery_plans.length}${queue.summary.due_recovery_check_in_count ? ` · ${queue.summary.due_recovery_check_in_count} follow-ups due` : ''}` : 'No active return plans'}</summary>
        <div className="divide-y divide-line">{queue.recovery_plans.map((plan) => <Link key={plan.id} to={plan.intervention_id ? interventionPath(plan.intervention_id, returnTo) : cohortStudentPath(plan.enrollment.cohort.id, plan.enrollment.student.id, 'support')} state={{ returnTo, returnLabel: 'Support' }} className={`flex min-h-11 flex-wrap items-center justify-between gap-3 px-5 py-4 ${plan.check_in_due ? 'bg-warning-soft' : ''}`}><span className="font-semibold text-ink">{plan.enrollment.student.full_name} · {plan.target_pace}</span><span className="text-sm text-ink-secondary">{plan.check_in_due ? 'Follow-up due · ' : 'Next follow-up · '}{formatShortDateTime(plan.next_check_in_at)}</span></Link>)}</div>
      </details>}

      <section aria-labelledby="requests-heading" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><p className="text-xs font-semibold text-ink-muted">Direct requests</p><h2 id="requests-heading" className="mt-1 text-lg font-bold text-ink">{view === 'active' ? 'Students who asked for help' : 'Recently resolved requests'}</h2></div>
          <div role="group" className="flex flex-wrap items-center gap-2" aria-label="Support filters"><SegmentedControl label="Request status">{(['active', 'resolved'] as const).map((value) => <SegmentButton key={value} selected={view === value} onClick={() => setFilter('view', value)} >{value === 'active' ? 'Active' : 'Resolved'}</SegmentButton>)}</SegmentedControl><FilterChip selected={urgentOnly} onClick={() => setFilter('urgency', urgentOnly ? 'all' : 'urgent')}><ShieldAlert className="h-4 w-4" aria-hidden="true" />Urgent only</FilterChip></div>
        </div>
        {filteredRequests.length === 0 ? (
          <div className="app-surface flex items-center gap-4 p-5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-success-soft text-success-ink"><CheckCircle2 className="h-5 w-5" aria-hidden="true" /></span>
            <div><p className="text-sm font-semibold text-ink">No matching help requests.</p><p className="mt-0.5 text-xs text-ink-muted">Change the filters above or check again later.</p></div>
          </div>
        ) : filteredRequests.map((request) => (
          <article key={request.id} className={`overflow-hidden rounded-2xl border bg-surface-raised shadow-raised ${request.urgency === 'urgent' ? 'border-danger-line' : 'border-line'}`}>
            <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start lg:p-6">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  {request.urgency === 'urgent' && <Badge tone="danger" icon={<ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />}>Urgent</Badge>}
                  <Badge tone={request.status === 'acknowledged' ? 'info' : 'pending'}>{request.status === 'acknowledged' ? 'Acknowledged' : 'Open'}</Badge>
                  <Badge>{followUpLabel(request.category)}</Badge>
                </div>
                <div className="mt-3 flex min-w-0 items-center gap-3">
                  <Avatar name={request.student?.full_name} size="md" />
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-semibold text-ink" title={request.student?.full_name}>{request.student && <RecordLink record={{ type: 'student', id: request.student.id, cohortId: request.cohort.id }} variant="plain" touchTarget truncate>{request.student.full_name}</RecordLink>}</h3>
                    <p className="mt-0.5 text-sm text-ink-muted [overflow-wrap:anywhere]"><RecordLink record={{ type: 'cohort', id: request.cohort.id }} variant="plain" touchTarget className="font-normal text-ink-muted">{request.cohort.name}</RecordLink> · On <Link className="record-link-plain inline-flex min-h-11 items-center font-normal text-ink-muted sm:min-h-0" to={request.context_path}>{request.context_label}</Link></p>
                  </div>
                </div>
                <p className="mt-4 whitespace-pre-wrap rounded-2xl bg-surface-sunken p-4 text-sm leading-6 text-ink [overflow-wrap:anywhere]">{request.message}</p>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-semibold text-ink-muted">
                  <span className="inline-flex items-center gap-1.5 tabular-nums"><Clock3 className="h-3.5 w-3.5" aria-hidden="true" />Asked {formatShortDateTime(request.created_at)}</span>
                  {request.owner && <span>Owner: {request.owner.full_name}</span>}
                  {(request.replies?.length ?? 0) > 0 && <span className="tabular-nums">{request.replies!.length === 1 ? '1 reply' : `${request.replies!.length} replies`}</span>}
                </div>
                {replying?.id === request.id && (
                  <div className="mt-4 border-t border-line pt-4">
                    <HelpReplyBox
                      id={`support-reply-${request.id}`}
                      studentName={request.student?.full_name}
                      value={draft}
                      onChange={setDraft}
                      primary={replying.primary}
                      sending={savingId === request.id ? sending : null}
                      autoFocus
                      onSend={(action) => void sendReply(request, action)}
                      onCancel={() => { void guard.confirmLeave().then((ok) => { if (ok) { attempt.done(); setReplying(null); setDraft('') } }) }}
                    />
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-2 lg:w-44 lg:flex-col">
                {/* At most four actions (U-4.7): Reply, Reply & resolve, the request, and its lesson above. */}
                <Button fullWidth onClick={() => void openReply(request, 'reply')} disabled={savingId === request.id} aria-expanded={replying?.id === request.id}><MessageSquareReply className="h-4 w-4" aria-hidden="true" />Reply</Button>
                <Button variant="secondary" fullWidth onClick={() => void openReply(request, 'resolve')} disabled={savingId === request.id}><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Reply & resolve</Button>
                <LinkButton to={helpRequestPath(request.id, returnTo)} variant="quiet" fullWidth>Open request <ArrowRight className="h-4 w-4" aria-hidden="true" /></LinkButton>
              </div>
            </div>
          </article>
        ))}
      </section>

      <section aria-labelledby="signals-heading" className="app-surface overflow-hidden">
        <div className="border-b border-line px-5 py-4 sm:px-6">
          <p className="text-xs font-semibold text-ink-muted">From recent activity</p>
          <h2 id="signals-heading" className="mt-1 text-lg font-bold text-ink">Needs attention</h2>
          <p className="mt-1 text-sm text-ink-muted">Students who may need a hand, with the reason and a next step.</p>
        </div>
        {queue.students.length === 0 ? <p className="px-6 py-8 text-center text-sm text-ink-muted">Everyone’s on track. {ATTENTION_CHECKED}</p> : (
          <div className="divide-y divide-line">
            {queue.students.map((student) => <StudentSignalRow key={`${student.cohort_id}-${student.user_id}`} student={student} onSelect={() => setSelectedStudent({ id: student.user_id, cohortId: student.cohort_id })} canCreate={interventionsEnabled} onCreate={() => startIntervention(student)} />)}
          </div>
        )}
      </section>

      {view === 'active' && queue.recently_resolved.length > 0 && (
        <details className="app-surface overflow-hidden">
          <summary className="min-h-11 cursor-pointer px-5 py-4 text-sm font-semibold tabular-nums text-ink transition-colors duration-150 hover:bg-surface-sunken sm:px-6">Recently resolved · {queue.recently_resolved.length}</summary>
          <div className="divide-y divide-line border-t border-line">
            {queue.recently_resolved.map((request) => (
              <Link to={helpRequestPath(request.id, returnTo)} key={request.id} className="pressable grid min-h-11 gap-2 px-5 py-4 text-sm hover:bg-surface-sunken sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto] sm:px-6">
                <div className="min-w-0"><p className="truncate font-semibold text-ink" title={request.student?.full_name}>{request.student?.full_name}</p><p className="text-xs text-ink-muted [overflow-wrap:anywhere]">{request.context_label}</p></div>
                <p className="leading-6 text-ink-secondary [overflow-wrap:anywhere]">{markdownExcerpt(request.staff_response, 280)}</p>
                <span className="text-xs font-semibold tabular-nums text-ink-muted">{formatShortDateTime(request.resolved_at)}</span>
              </Link>
            ))}
          </div>
        </details>
      )}

      <Modal open={Boolean(creatingFor)} onClose={() => { if (!savingId) setCreatingFor(null) }} title={TERMS.startFollowUpPlan} subtitle={creatingFor ? `${creatingFor.full_name} · ${creatingFor.cohort_name}` : undefined} icon={<span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-sunken text-ink-secondary"><ClipboardPlus className="h-5 w-5" aria-hidden="true" /></span>} size="md">
        <form className="space-y-4" onSubmit={createIntervention}><label className="block text-sm font-semibold text-ink">Reason<select value={triggerType} onChange={(event) => setTriggerType(event.target.value as InterventionTrigger)} className="app-control mt-2 w-full font-normal">{(['help_request', 'redo', 'ungraded', 'inactivity', 'extended_absence', 'manual'] as const).map((value) => <option key={value} value={value}>{FOLLOW_UP_TRIGGER_LABELS[value]}</option>)}</select></label><label className="block text-sm font-semibold text-ink">Next step<textarea value={actionSummary} onChange={(event) => setActionSummary(event.target.value)} rows={5} maxLength={2000} required className="app-control mt-2 w-full font-normal leading-6" /></label><label className="block text-sm font-semibold text-ink">Next follow-up<input type="datetime-local" value={followUpAt} onChange={(event) => setFollowUpAt(event.target.value)} required className="app-control mt-2 w-full font-normal tabular-nums" /></label><p className="rounded-xl bg-surface-sunken p-3 text-xs leading-5 text-ink-secondary">You become the owner. The plan saves dates, categories and counts about the reason, never messages or student work.</p><Button type="submit" fullWidth disabled={savingId === -1 || !actionSummary.trim() || !followUpAt}><ClipboardPlus className="h-4 w-4" aria-hidden="true" />{savingId === -1 ? 'Starting…' : TERMS.startFollowUpPlan}</Button></form>
      </Modal>
      {selectedStudent && <StudentContextDrawer open cohortId={selectedStudent.cohortId} studentId={selectedStudent.id} onClose={() => setSelectedStudent(null)} />}
    </div>
  )
}

function SummaryCard({ label, value, icon: Icon, tone }: { label: string; value: number; icon: typeof CircleHelp; tone: 'pending' | 'neutral' | 'warning' }) {
  // Tinted only when there is something to act on; zero counts stay neutral.
  const tones = { pending: 'bg-surface-sunken text-ink-secondary', neutral: 'bg-surface-sunken text-ink-secondary', warning: 'bg-warning-soft text-warning-ink' }
  return <div className="app-surface p-4 sm:p-5"><span className={`flex h-10 w-10 items-center justify-center rounded-xl ${value > 0 ? tones[tone] : tones.neutral}`}><Icon className="h-5 w-5" aria-hidden="true" /></span><p className="mt-4 text-3xl font-bold tabular-nums text-ink">{value}</p><p className="mt-1 text-xs font-semibold text-ink-muted">{label}</p></div>
}

function StudentSignalRow({ student, onSelect, onCreate, canCreate = true }: { canCreate?: boolean; student: SupportQueueStudent; onSelect: () => void; onCreate: () => void }) {
  return <div><AttentionRow student={student} /><div className="flex flex-wrap gap-3 px-5 pb-4"><TextButton onClick={onSelect} aria-label={`View context for ${student.full_name || student.email}`}>Student context</TextButton>{canCreate && !student.active_intervention_id && <TextButton onClick={onCreate} aria-label={`Start follow-up plan for ${student.full_name || student.email}`}>{TERMS.startFollowUpPlan}</TextButton>}</div></div>
}

function localDateTime(daysFromNow: number) { const date = new Date(Date.now() + daysFromNow * 86_400_000); const offset = date.getTimezoneOffset() * 60_000; return new Date(date.getTime() - offset).toISOString().slice(0, 16) }
