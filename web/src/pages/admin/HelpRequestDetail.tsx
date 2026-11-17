import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ReturnOrigin } from '../../contexts/PreviewNavigationContext'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { ClipboardCheck, LifeBuoy, MessageSquareText, RefreshCw, ShieldAlert, UserRound, UserRoundCheck } from 'lucide-react'
import { api } from '../../lib/api'
import { trimBlankLines } from '../../lib/messageFormat'
import { cohortPath, cohortStudentPath, directMessagePath, helpRequestPath } from '../../lib/routes'
import { useBackLink } from '../../lib/recordOrigin'
import { filterSupportRequests, queuePositionLabel, queueStep, scrollToRecordTop, supportQueueSource, withFreshRequest } from '../../lib/recordQueue'
import { RESTORE_LIST_STATE } from '../../lib/navigationContext'
import { useConfirm } from '../../contexts/ConfirmContext'
import { useLeaveGuard } from '../../lib/useLeaveGuard'
import { useRecordQueue } from '../../lib/useRecordQueue'
import { invalidateRecordQueues } from '../../lib/recordQueueCache'
import { relatedRows, useRecordRelated } from '../../lib/recordRelated'
import { useRecordViewer } from '../../lib/useRecordPath'
import { RecordHeader, staffBreadcrumb } from '../../components/shared/RecordHeader'
import { RelatedPanel, scrollToSection } from '../../components/shared/RelatedPanel'
import { formatShortDateTime } from '../../lib/format'
import { StudentContextDrawer } from '../../components/admin/StudentContextDrawer'
import { EmptyState } from '../../components/shared/EmptyState'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { Button, LinkButton } from '../../components/ui/Button'
import { Badge, type BadgeTone } from '../../components/ui/Badge'
import { HelpReplyBox, HelpReplyThread, useReplyAttempt, type HelpReplyAction } from '../../components/admin/HelpReplyBox'
import { FOLLOW_UP_STATUS_LABELS } from '../../lib/followUpLabels'
import { TERMS } from '../../lib/glossary'
import { useToast } from '../../contexts/ToastContext'
import type { HelpRequest, SupportQueueResponse } from '../../types/api'
import { RecordLink } from '../../components/shared/RecordLink'
import { humanize } from '../../lib/glossary'

const STATUS_TONES: Record<string, BadgeTone> = { open: 'pending', acknowledged: 'info', resolved: 'success', canceled: 'neutral' }

export function HelpRequestDetail() {
  const { id } = useParams<{ id: string }>()
  // Key the record so Previous/Next never carry one request's response draft to another.
  return <HelpRequestRecord key={id} requestId={Number(id)} />
}

function HelpRequestRecord({ requestId }: { requestId: number }) {
  const navigate = useNavigate()
  const location = useLocation()
  const viewer = useRecordViewer()
  const back = useBackLink({ returnTo: '/admin/support', returnLabel: 'Support' })
  const related = useRecordRelated('help_request', Number.isInteger(requestId) && requestId > 0 ? requestId : null)
  const toast = useToast()
  const [request, setRequest] = useState<HelpRequest | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [showStudent, setShowStudent] = useState(false)
  const [response, setResponse] = useState('')
  const [sending, setSending] = useState<HelpReplyAction | null>(null)
  const attempt = useReplyAttempt()
  const confirm = useConfirm()
  // Opened from Support: walk that list as filtered (L-0.7). Fetched again with this viewer's access.
  const supportSource = back.fallback ? null : supportQueueSource(back.to)
  const sourceKey = supportSource ? JSON.stringify(supportSource) : ''
  // Shared by viewer and cohort and briefly remembered, so Previous/Next fetch it once; leaving aborts
  // a request in flight, and resolving invalidates it (recordQueueCache). Fetched with this viewer's access.
  const queueLoad = useRecordQueue<SupportQueueResponse['support_queue']>(supportSource ? `support:${supportSource.cohortId ?? ''}${supportSource.studentId ? `:${supportSource.studentId}` : ''}` : null, async (signal) => {
    const result = supportSource?.studentId ? await api.getSupportQueue(supportSource.cohortId ?? undefined, signal, supportSource.studentId) : await api.getSupportQueue(supportSource?.cohortId ?? undefined, signal)
    return result.data && !result.error && !result.fromCache ? { status: 'ready', items: result.data.support_queue } : { status: 'error', error: result.error || 'Queue unavailable.' }
  }, {
    // Resolved (or reopened) elsewhere since the queue was fetched: fetch it again.
    staleToken: (items) => (withFreshRequest(items, request) && request ? `${request.id}:${request.status}:${request.urgency}` : null),
  })
  const queue = useMemo(() => {
    if (queueLoad?.status !== 'ready' || !sourceKey) return null
    // Until the refetch lands, the fresh request's own status decides whether it is still in the list.
    const items = withFreshRequest(queueLoad.items, request) ?? queueLoad.items
    return filterSupportRequests(items, JSON.parse(sourceKey) as NonNullable<typeof supportSource>)
  }, [queueLoad, sourceKey, request])
  const [queueFinished, setQueueFinished] = useState(false)

  const load = useCallback(async () => {
    if (!Number.isInteger(requestId) || requestId <= 0) {
      setError('This help-request link is invalid.')
      setLoading(false)
      return
    }
    setLoading(true)
    const result = await api.getHelpRequest(requestId)
    setLoading(false)
    if (result.data) {
      setRequest(result.data.help_request)
      setError(null)
    } else setError(result.error || 'Could not load this help request.')
  }, [requestId])

  useEffect(() => { void load() }, [load])

  // Arrived by Previous/Next or Resolve and next: focus the request's heading once it shows, so a
  // keyboard or screen-reader user continues from the new request instead of the top of the page.
  const heading = useRef<HTMLHeadingElement>(null)
  const notice = useRef<HTMLDivElement>(null)
  const arrivedFromQueue = Boolean((location.state as { focusRecord?: unknown } | null)?.focusRecord)
  const focusedHeading = useRef(false)
  useEffect(() => {
    if (!arrivedFromQueue || !request || focusedHeading.current) return
    focusedHeading.current = true
    heading.current?.focus({ preventScroll: true })
  }, [arrivedFromQueue, request])
  // The last one in the list: the completion notice takes focus.
  useEffect(() => {
    if (queueFinished) notice.current?.focus({ preventScroll: true })
  }, [queueFinished])

  async function acknowledge() {
    if (!request) return
    setSaving(true)
    const result = await api.updateHelpRequest(request.id, { status: 'acknowledged' })
    setSaving(false)
    if (result.data) {
      setRequest(result.data.help_request)
      toast.success('The student can now see that you are taking a look.')
    } else toast.error(result.error || 'Could not acknowledge this request.')
  }

  // Reply keeps the request open; Reply & resolve closes it and moves on (U-4.7).
  async function sendReply(action: HelpReplyAction) {
    if (!request || !response.trim() || sending) return
    setSending(action)
    setSaving(true)
    // A failed or lost send keeps its attempt id, so pressing again can't answer twice.
    const result = await api.replyToHelpRequest(request.id, { body: trimBlankLines(response), resolve: action === 'resolve', client_request_id: attempt.id() })
    setSaving(false)
    setSending(null)
    if (!result.data) {
      toast.error(result.error || 'Could not send this reply.')
      return
    }
    setRequest(result.data.help_request)
    setResponse('')
    attempt.done()
    // Sent: the move to the next request below happens before the cleared draft renders.
    guard.release()
    invalidateRecordQueues()
    if (action === 'reply') {
      toast.success('Reply sent. The request stays open.')
      return
    }
    toast.success('Reply sent and request resolved.')
    // Resolve and next: the active list drops resolved requests, so the one before is next when this was last.
    const following = step?.next ?? (step && step.index >= 0 && supportSource?.view === 'active' ? step.previous : null)
    if (following) goTo(following.id, true)
    else if (step) {
      setQueueFinished(true)
      scrollToRecordTop()
    }
  }

  const step = queue ? queueStep(queue, (item) => item.id === requestId) : null
  // An unsent response (the dialog was closed without sending) is a draft worth asking about,
  // whichever way the page is left: links, Previous/Next, browser Back, reload.
  const guard = useLeaveGuard({
    dirty: Boolean(response.trim()),
    confirm: () => confirm({ title: 'Discard your response?', description: 'Your unsent response to this help request will be lost.', confirmLabel: 'Discard and move on', cancelLabel: 'Keep editing', tone: 'danger' }),
  })
  const confirmLeave = guard.confirmLeave
  async function goTo(targetId: number, saved = false) {
    if (!saved && !(await confirmLeave())) return
    // The next request's heading takes focus once it loads (the button pressed is gone with this one).
    navigate(helpRequestPath(targetId, back.to), { state: { returnTo: back.to, returnLabel: back.label.replace(/^Back to /, ''), focusRecord: true } })
    scrollToRecordTop()
  }
  const guardedBack = async (event: React.MouseEvent<HTMLAnchorElement>, to: string) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !response.trim()) return
    event.preventDefault()
    if (await confirmLeave()) navigate(to, { state: RESTORE_LIST_STATE })
  }

  async function openMessage() {
    if (!request?.student) return
    setSaving(true)
    const result = await api.createDirectConversation({ cohort_id: request.cohort.id, user_ids: [request.student.id] })
    setSaving(false)
    if (result.data) navigate(directMessagePath(result.data.direct_conversation.id, { type: 'help_request', id: request.id, label: request.context_label, returnTo: back.fallback ? undefined : back.to }))
    else toast.error(result.error || 'Could not open a direct message.')
  }

  if (loading) return <LoadingSpinner message="Loading help request…" />
  if (!request || error) return <div className="app-page"><EmptyState icon={LifeBuoy} title="Could not open this help request" description={error || 'This help request wasn’t found.'} action={<Button onClick={() => void load()}><RefreshCw className="h-4 w-4" aria-hidden="true" />Try again</Button>} /></div>

  const source = { type: 'help_request' as const, id: request.id, label: request.context_label }
  const terminal = request.status === 'resolved' || request.status === 'canceled'
  const rows = related.related ? relatedRows(related.related, { viewer, returnTo: `${location.pathname}${location.search}`, actions: { message: request.student ? () => void openMessage() : undefined, scrollTo: scrollToSection } }) : []

  return <ReturnOrigin label={`Help request · ${request.student?.full_name || 'Student'}`}><div className="app-page-wide space-y-6">
    <RecordHeader
      back={back}
      headingRef={heading}
      onBack={(event, to) => void guardedBack(event, to)}
      queue={step ? {
        position: queuePositionLabel(step),
        onPrevious: step.previous ? () => void goTo(step.previous!.id) : undefined,
        onNext: step.next ? () => void goTo(step.next!.id) : undefined,
        previousLabel: 'Previous help request',
        nextLabel: 'Next help request',
      } : undefined}
      breadcrumb={staffBreadcrumb({
        cohort: { label: request.cohort.name, to: cohortPath(request.cohort.id) },
        student: request.student ? { label: request.student.full_name, to: cohortStudentPath(request.cohort.id, request.student.id) } : null,
        record: 'Help request',
      })}
      type={<span>Help request · {humanize(request.category)}</span>}
      title={request.context_label}
      status={<>{request.urgency === 'urgent' && <Badge tone="danger" icon={<ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />}>Urgent</Badge>}<Badge tone={STATUS_TONES[request.status] || 'neutral'} >{humanize(request.status)}</Badge></>}
      context={<>
        {request.student && <RecordLink record={{ type: 'student', id: request.student.id, cohortId: request.cohort.id }} variant="plain" touchTarget>{request.student.full_name}</RecordLink>}
        {request.student && <span aria-hidden="true">·</span>}
        <RecordLink record={{ type: 'cohort', id: request.cohort.id }} variant="plain" touchTarget className="font-normal text-ink-muted">{request.cohort.name}</RecordLink>
        <span aria-hidden="true">·</span>
        <span className="tabular-nums">Asked {formatShortDateTime(request.created_at)}</span>
        {request.follow_up && <>
          <span aria-hidden="true">·</span>
          <RecordLink record={{ type: 'intervention', id: request.follow_up.id }} variant="plain" touchTarget returnLabel={`Help request · ${request.student?.full_name || 'Student'}`}>
            <ClipboardCheck className="mr-1 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{TERMS.followUpPlan} · {FOLLOW_UP_STATUS_LABELS[request.follow_up.status] ?? humanize(request.follow_up.status)}
          </RecordLink>
        </>}
      </>}
      actions={request.student ? <>
        <Button variant="secondary" size="sm" onClick={() => setShowStudent(true)}><UserRound className="h-4 w-4" aria-hidden="true" />Student context</Button>
        <Button variant="secondary" size="sm" onClick={() => void openMessage()} disabled={saving} className="max-w-full"><MessageSquareText className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="truncate">Message in {request.cohort.name}</span></Button>
      </> : null}
    />

    {queueFinished && <div ref={notice} tabIndex={-1} role="status" className="app-surface flex flex-wrap items-center justify-between gap-3 p-4 focus:outline-none"><p className="text-sm font-semibold text-ink">That was the last request in this list.</p><LinkButton to={back.to} state={RESTORE_LIST_STATE} variant="secondary" size="sm">{back.label}</LinkButton></div>}
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
      <div className="min-w-0 space-y-5">
        <section className="app-surface p-5 sm:p-6"><div className="flex flex-wrap gap-2"><Badge>{humanize(request.category)}</Badge><Badge>{humanize(request.context_type)}</Badge></div><h2 className="mt-5 text-sm font-semibold text-ink-muted">Student message</h2><p className="mt-2 whitespace-pre-wrap text-base leading-7 text-ink [overflow-wrap:anywhere]">{request.message}</p></section>
        <HelpReplyThread request={request} />
        {request.status === 'resolved' && <p className="px-2 text-xs font-semibold tabular-nums text-success-ink">Resolved {formatShortDateTime(request.resolved_at)}</p>}
        {!terminal && <section aria-label="Reply" className="app-surface space-y-3 p-5 sm:p-6">
          <HelpReplyBox id="help-record-response" studentName={request.student?.full_name} value={response} onChange={setResponse} sending={sending} onSend={(action) => void sendReply(action)} />
          {request.status === 'open' && <div className="border-t border-line pt-3"><Button variant="quiet" size="sm" onClick={() => void acknowledge()} disabled={saving}><UserRoundCheck className="h-4 w-4" aria-hidden="true" />Acknowledge without replying</Button></div>}
        </section>}
        {request.owner && <p className="px-2 text-xs font-semibold text-ink-muted">Owner: {request.owner.full_name}</p>}
      </div>
      <RelatedPanel rows={rows} loading={related.loading} error={related.error} onRetry={related.retry} returnLabel={`Help request · ${request.student?.full_name || 'Student'}`} className="lg:sticky lg:top-20" />
    </div>

    {request.student && <StudentContextDrawer open={showStudent} cohortId={request.cohort.id} studentId={request.student.id} source={source} onClose={() => setShowStudent(false)} />}
  </div></ReturnOrigin>
}
