import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, BookOpen, CheckCircle2, Clock3, ExternalLink, LifeBuoy, MessageSquareText, RefreshCw, ShieldAlert, UserRound, UserRoundCheck } from 'lucide-react'
import { api } from '../../lib/api'
import { cohortStudentPath, directMessagePath, safeInternalReturnPath } from '../../lib/routes'
import { formatShortDateTime } from '../../lib/format'
import { StudentContextDrawer } from '../../components/admin/StudentContextDrawer'
import { EmptyState } from '../../components/shared/EmptyState'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { Modal } from '../../components/shared/Modal'
import { Button, LinkButton } from '../../components/ui/Button'
import { Avatar } from '../../components/ui/Avatar'
import { Badge, type BadgeTone } from '../../components/ui/Badge'
import { TextButton } from '../../components/ui/Choice'
import { useToast } from '../../contexts/ToastContext'
import type { HelpRequest } from '../../types/api'

const STATUS_TONES: Record<string, BadgeTone> = { open: 'pending', acknowledged: 'info', resolved: 'success', canceled: 'neutral' }

export function HelpRequestDetail() {
  const { id } = useParams<{ id: string }>()
  const requestId = Number(id)
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
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
    const result = await api.updateHelpRequest(request.id, { status: 'resolved', staff_response: response.trim() })
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
    if (result.data) navigate(directMessagePath(result.data.direct_conversation.id, { type: 'help_request', id: request.id, label: request.context_label }))
    else toast.error(result.error || 'Could not open a direct message.')
  }

  if (loading) return <LoadingSpinner message="Loading help request…" />
  if (!request || error) return <div className="app-page"><EmptyState icon={LifeBuoy} title="Could not open this help request" description={error || 'The record was not found.'} action={<Button onClick={() => void load()}><RefreshCw className="h-4 w-4" aria-hidden="true" />Try again</Button>} /></div>

  const returnTo = safeInternalReturnPath(searchParams.get('return_to'), '/admin/support')
  const source = { type: 'help_request' as const, id: request.id, label: request.context_label }
  const terminal = request.status === 'resolved' || request.status === 'canceled'

  return <div className="app-page space-y-6">
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm font-semibold text-ink-muted"><Link to={returnTo} className="app-link inline-flex min-h-11 items-center gap-1 px-1"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to support</Link><span aria-hidden="true" className="text-ink-muted">/</span><span className="px-1 tabular-nums text-ink-secondary">Help request #{request.id}</span></nav>

    <header className="app-surface p-5 sm:p-6">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="app-eyebrow">Help request record</p>{request.urgency === 'urgent' && <Badge tone="danger" icon={<ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />}>Urgent</Badge>}<Badge tone={STATUS_TONES[request.status] || 'neutral'} className="capitalize">{request.status}</Badge></div><h1 className="app-title mt-2 [overflow-wrap:anywhere]">{request.context_label}</h1><div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink-muted"><TextButton onClick={() => setShowStudent(true)} className="min-w-0 max-w-full gap-2" title={request.student?.full_name}><Avatar name={request.student?.full_name} size="sm" /><span className="truncate">{request.student?.full_name}</span></TextButton><span className="inline-flex min-w-0 items-center gap-1 [overflow-wrap:anywhere]"><BookOpen className="h-4 w-4 shrink-0" aria-hidden="true" />{request.cohort.name}</span><span className="inline-flex items-center gap-1 tabular-nums"><Clock3 className="h-4 w-4" aria-hidden="true" />Asked {formatShortDateTime(request.created_at)}</span></div></div>
        <div className="flex flex-wrap gap-2">{request.student && <Button variant="secondary" onClick={() => setShowStudent(true)}><UserRound className="h-4 w-4" aria-hidden="true" />Student context</Button>} {request.student && <Button variant="secondary" onClick={() => void openMessage()} disabled={saving} className="max-w-full"><MessageSquareText className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="truncate">Message in {request.cohort.name}</span></Button>}</div>
      </div>
    </header>

    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <main className="min-w-0 space-y-5"><section className="app-surface p-5 sm:p-6"><div className="flex flex-wrap gap-2"><Badge className="capitalize">{request.category}</Badge><Badge className="capitalize">{request.context_type}</Badge></div><h2 className="mt-5 text-sm font-semibold text-ink-muted">Student message</h2><p className="mt-2 whitespace-pre-wrap text-base leading-7 text-ink [overflow-wrap:anywhere]">{request.message}</p></section>{request.staff_response && <section className="rounded-2xl border border-success-200 bg-success-50 p-5 sm:p-6"><h2 className="text-sm font-semibold text-success-800">Staff response</h2><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-success-900 [overflow-wrap:anywhere]">{request.staff_response}</p><p className="mt-3 text-xs font-semibold tabular-nums text-success-700">Resolved {formatShortDateTime(request.resolved_at)}</p></section>}</main>
      <aside className="space-y-3"><section className="app-surface p-4"><h2 className="text-base font-semibold text-ink">Related records</h2><div className="mt-3 space-y-2"><LinkButton to={request.context_path} variant="secondary" fullWidth><span className="flex-1 text-left">Open learning context</span><ExternalLink className="h-4 w-4" aria-hidden="true" /></LinkButton>{request.student && <LinkButton to={cohortStudentPath(request.cohort.id, request.student.id, 'support')} variant="secondary" fullWidth><span className="flex-1 text-left">Student workspace</span><UserRound className="h-4 w-4" aria-hidden="true" /></LinkButton>}</div></section>{!terminal && <section className="app-surface space-y-2 p-4">{request.status === 'open' && <Button variant="secondary" fullWidth onClick={() => void acknowledge()} disabled={saving}><UserRoundCheck className="h-4 w-4" aria-hidden="true" />Acknowledge</Button>}<Button fullWidth onClick={() => setShowResolve(true)} disabled={saving}><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Respond & resolve</Button></section>}{request.owner && <p className="px-2 text-xs font-semibold text-ink-muted">Owned by {request.owner.full_name}</p>}</aside>
    </div>

    {request.student && <StudentContextDrawer open={showStudent} cohortId={request.cohort.id} studentId={request.student.id} source={source} onClose={() => setShowStudent(false)} />}
    <Modal open={showResolve} onClose={() => { if (!saving) setShowResolve(false) }} title="Respond and resolve" subtitle={`${request.student?.full_name} · ${request.context_label}`} size="md"><form className="space-y-4" onSubmit={resolve}><div className="whitespace-pre-wrap rounded-xl bg-surface-sunken p-3 text-sm leading-6 text-ink-secondary [overflow-wrap:anywhere]">{request.message}</div><div><label htmlFor="help-record-response" className="text-sm font-semibold text-ink">Response visible to the student</label><textarea id="help-record-response" value={response} onChange={(event) => setResponse(event.target.value)} maxLength={2000} rows={6} required className="app-control mt-2 w-full leading-6" /></div><Button type="submit" fullWidth disabled={!response.trim() || saving}><CheckCircle2 className="h-4 w-4" aria-hidden="true" />{saving ? 'Sending…' : 'Send response and resolve'}</Button></form></Modal>
  </div>
}
