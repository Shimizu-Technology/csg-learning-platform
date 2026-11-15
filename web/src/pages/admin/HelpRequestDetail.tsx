import { useCallback, useEffect, useState } from 'react'
import { ReturnOrigin } from '../../contexts/PreviewNavigationContext'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { CheckCircle2, LifeBuoy, MessageSquareText, RefreshCw, ShieldAlert, UserRound, UserRoundCheck } from 'lucide-react'
import { api } from '../../lib/api'
import { trimBlankLines } from '../../lib/messageFormat'
import { cohortPath, cohortStudentPath, directMessagePath } from '../../lib/routes'
import { useBackLink } from '../../lib/recordOrigin'
import { relatedRows, useRecordRelated } from '../../lib/recordRelated'
import { useRecordViewer } from '../../lib/useRecordPath'
import { RecordHeader, staffBreadcrumb } from '../../components/shared/RecordHeader'
import { RelatedPanel, scrollToSection } from '../../components/shared/RelatedPanel'
import { formatShortDateTime } from '../../lib/format'
import { StudentContextDrawer } from '../../components/admin/StudentContextDrawer'
import { EmptyState } from '../../components/shared/EmptyState'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { Modal } from '../../components/shared/Modal'
import { Button } from '../../components/ui/Button'
import { Badge, type BadgeTone } from '../../components/ui/Badge'
import { MarkdownText } from '../../components/shared/MarkdownRenderer'
import { MarkdownEditor } from '../../components/shared/MarkdownEditor'
import { useToast } from '../../contexts/ToastContext'
import type { HelpRequest } from '../../types/api'
import { RecordLink } from '../../components/shared/RecordLink'

const STATUS_TONES: Record<string, BadgeTone> = { open: 'pending', acknowledged: 'info', resolved: 'success', canceled: 'neutral' }

export function HelpRequestDetail() {
  const { id } = useParams<{ id: string }>()
  const requestId = Number(id)
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
  const [showResolve, setShowResolve] = useState(false)
  const [showStudent, setShowStudent] = useState(false)
  const [response, setResponse] = useState('')

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

  async function resolve(event: React.FormEvent) {
    event.preventDefault()
    if (!request || !response.trim()) return
    setSaving(true)
    const result = await api.updateHelpRequest(request.id, { status: 'resolved', staff_response: trimBlankLines(response) })
    setSaving(false)
    if (result.data) {
      setRequest(result.data.help_request)
      setShowResolve(false)
      setResponse('')
      toast.success('Response sent and request resolved.')
    } else toast.error(result.error || 'Could not resolve this request.')
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
  if (!request || error) return <div className="app-page"><EmptyState icon={LifeBuoy} title="Could not open this help request" description={error || 'The record was not found.'} action={<Button onClick={() => void load()}><RefreshCw className="h-4 w-4" aria-hidden="true" />Try again</Button>} /></div>

  const source = { type: 'help_request' as const, id: request.id, label: request.context_label }
  const terminal = request.status === 'resolved' || request.status === 'canceled'
  const rows = related.related ? relatedRows(related.related, { viewer, returnTo: `${location.pathname}${location.search}`, actions: { message: request.student ? () => void openMessage() : undefined, scrollTo: scrollToSection } }) : []

  return <ReturnOrigin label={`Help request #${request.id}`}><div className="app-page-wide space-y-6">
    <RecordHeader
      back={back}
      breadcrumb={staffBreadcrumb({
        cohort: { label: request.cohort.name, to: cohortPath(request.cohort.id) },
        student: request.student ? { label: request.student.full_name, to: cohortStudentPath(request.cohort.id, request.student.id) } : null,
        record: `Help request #${request.id}`,
      })}
      type={<span className="tabular-nums">Help request #{request.id} · <span className="capitalize">{request.category}</span></span>}
      title={request.context_label}
      status={<>{request.urgency === 'urgent' && <Badge tone="danger" icon={<ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />}>Urgent</Badge>}<Badge tone={STATUS_TONES[request.status] || 'neutral'} className="capitalize">{request.status}</Badge></>}
      context={<>
        {request.student && <RecordLink record={{ type: 'student', id: request.student.id, cohortId: request.cohort.id }} variant="plain" touchTarget>{request.student.full_name}</RecordLink>}
        {request.student && <span aria-hidden="true">·</span>}
        <RecordLink record={{ type: 'cohort', id: request.cohort.id }} variant="plain" touchTarget className="font-normal text-ink-muted">{request.cohort.name}</RecordLink>
        <span aria-hidden="true">·</span>
        <span className="tabular-nums">Asked {formatShortDateTime(request.created_at)}</span>
      </>}
      actions={request.student ? <>
        <Button variant="secondary" size="sm" onClick={() => setShowStudent(true)}><UserRound className="h-4 w-4" aria-hidden="true" />Student context</Button>
        <Button variant="secondary" size="sm" onClick={() => void openMessage()} disabled={saving} className="max-w-full"><MessageSquareText className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="truncate">Message in {request.cohort.name}</span></Button>
      </> : null}
    />

    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
      <div className="min-w-0 space-y-5">
        <section className="app-surface p-5 sm:p-6"><div className="flex flex-wrap gap-2"><Badge className="capitalize">{request.category}</Badge><Badge className="capitalize">{request.context_type}</Badge></div><h2 className="mt-5 text-sm font-semibold text-ink-muted">Student message</h2><p className="mt-2 whitespace-pre-wrap text-base leading-7 text-ink [overflow-wrap:anywhere]">{request.message}</p></section>
        {request.staff_response && <section className="rounded-2xl border border-success-200 bg-success-50 p-5 sm:p-6"><h2 className="text-sm font-semibold text-success-800">Staff response</h2><div className="mt-2 text-sm leading-6 text-success-900 [overflow-wrap:anywhere]"><MarkdownText content={request.staff_response} /></div><p className="mt-3 text-xs font-semibold tabular-nums text-success-700">Resolved {formatShortDateTime(request.resolved_at)}</p></section>}
        {!terminal && <section className="app-surface flex flex-wrap gap-2 p-4">{request.status === 'open' && <Button variant="secondary" onClick={() => void acknowledge()} disabled={saving}><UserRoundCheck className="h-4 w-4" aria-hidden="true" />Acknowledge</Button>}<Button onClick={() => setShowResolve(true)} disabled={saving}><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Respond & resolve</Button></section>}
        {request.owner && <p className="px-2 text-xs font-semibold text-ink-muted">Owned by {request.owner.full_name}</p>}
      </div>
      <RelatedPanel rows={rows} loading={related.loading} error={related.error} onRetry={related.retry} returnLabel={`Help request #${request.id}`} className="lg:sticky lg:top-20" />
    </div>

    {request.student && <StudentContextDrawer open={showStudent} cohortId={request.cohort.id} studentId={request.student.id} source={source} onClose={() => setShowStudent(false)} />}
    <Modal open={showResolve} onClose={() => { if (!saving) setShowResolve(false) }} title="Respond and resolve" subtitle={`${request.student?.full_name} · ${request.context_label}`} size="md"><form className="space-y-4" onSubmit={resolve}><div className="whitespace-pre-wrap rounded-xl bg-surface-sunken p-3 text-sm leading-6 text-ink-secondary [overflow-wrap:anywhere]">{request.message}</div><div><label htmlFor="help-record-response" className="text-sm font-semibold text-ink">Response visible to the student</label><MarkdownEditor id="help-record-response" label="Response visible to the student" value={response} onChange={setResponse} className="mt-2" minHeight={144} maxHeight={420} /><p className={`mt-1 text-right text-xs tabular-nums ${response.length > 2000 ? 'font-semibold text-danger-700' : 'text-ink-muted'}`}>{response.length.toLocaleString()}/2,000</p></div><Button type="submit" fullWidth disabled={!response.trim() || response.length > 2000 || saving}><CheckCircle2 className="h-4 w-4" aria-hidden="true" />{saving ? 'Sending…' : 'Send response and resolve'}</Button></form></Modal>
  </div></ReturnOrigin>
}
