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
import { Button } from '../../components/ui/Button'
import { useToast } from '../../contexts/ToastContext'
import type { HelpRequest } from '../../types/api'

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
  if (!request || error) return <div className="app-page"><EmptyState icon={LifeBuoy} title="Could not open this help request" description={error || 'The record was not found.'} action={<Button onClick={() => void load()}><RefreshCw className="h-4 w-4" />Try again</Button>} /></div>

  const returnTo = safeInternalReturnPath(searchParams.get('return_to'), '/admin/support')
  const source = { type: 'help_request' as const, id: request.id, label: request.context_label }
  const terminal = request.status === 'resolved' || request.status === 'canceled'

  return <div className="app-page space-y-6">
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm font-semibold text-slate-500"><Link to={returnTo} className="app-link inline-flex min-h-11 items-center gap-1 px-1"><ArrowLeft className="h-4 w-4" />Back to support</Link><span className="text-slate-300">/</span><span className="px-1 text-slate-700">Help request #{request.id}</span></nav>

    <header className="app-surface p-5 sm:p-6">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div><div className="flex flex-wrap items-center gap-2"><p className="app-eyebrow">Help request record</p>{request.urgency === 'urgent' && <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-1 text-xs font-extrabold text-red-700"><ShieldAlert className="h-3.5 w-3.5" />Urgent</span>}<span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-extrabold capitalize text-slate-700">{request.status}</span></div><h1 className="app-title mt-2">{request.context_label}</h1><div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-500"><button type="button" onClick={() => setShowStudent(true)} className="app-link inline-flex min-h-11 items-center gap-1 font-bold"><UserRound className="h-4 w-4" />{request.student?.full_name}</button><span className="inline-flex items-center gap-1"><BookOpen className="h-4 w-4" />{request.cohort.name}</span><span className="inline-flex items-center gap-1"><Clock3 className="h-4 w-4" />Asked {formatShortDateTime(request.created_at)}</span></div></div>
        <div className="flex flex-wrap gap-2">{request.student && <Button variant="secondary" onClick={() => setShowStudent(true)}><UserRound className="h-4 w-4" />Student context</Button>} {request.student && <Button variant="secondary" onClick={() => void openMessage()} disabled={saving}><MessageSquareText className="h-4 w-4" />Message in {request.cohort.name}</Button>}</div>
      </div>
    </header>

    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <main className="space-y-5"><section className="app-surface p-5 sm:p-6"><div className="flex flex-wrap gap-2"><span className="rounded-full bg-primary-50 px-2.5 py-1 text-xs font-bold capitalize text-primary-700">{request.category}</span><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold capitalize text-slate-600">{request.context_type}</span></div><h2 className="mt-5 text-sm font-extrabold uppercase tracking-wide text-slate-500">Student message</h2><p className="mt-2 whitespace-pre-wrap text-base leading-7 text-slate-900">{request.message}</p></section>{request.staff_response && <section className="rounded-2xl border border-green-200 bg-green-50 p-5 sm:p-6"><h2 className="text-sm font-extrabold uppercase tracking-wide text-green-800">Staff response</h2><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-green-950">{request.staff_response}</p><p className="mt-3 text-xs font-semibold text-green-700">Resolved {formatShortDateTime(request.resolved_at)}</p></section>}</main>
      <aside className="space-y-3"><section className="app-surface p-4"><h2 className="text-sm font-extrabold text-slate-950">Related records</h2><div className="mt-3 space-y-2"><Link to={request.context_path} className="inline-flex min-h-11 w-full items-center justify-between rounded-xl border border-slate-200 px-3 text-sm font-bold text-slate-700 hover:border-primary-300"><span>Open learning context</span><ExternalLink className="h-4 w-4" /></Link>{request.student && <Link to={cohortStudentPath(request.cohort.id, request.student.id, 'support')} className="inline-flex min-h-11 w-full items-center justify-between rounded-xl border border-slate-200 px-3 text-sm font-bold text-slate-700 hover:border-primary-300"><span>Student workspace</span><UserRound className="h-4 w-4" /></Link>}</div></section>{!terminal && <section className="app-surface space-y-2 p-4">{request.status === 'open' && <Button variant="secondary" fullWidth onClick={() => void acknowledge()} disabled={saving}><UserRoundCheck className="h-4 w-4" />Acknowledge</Button>}<Button fullWidth onClick={() => setShowResolve(true)} disabled={saving}><CheckCircle2 className="h-4 w-4" />Respond & resolve</Button></section>}{request.owner && <p className="px-2 text-xs font-semibold text-slate-500">Owned by {request.owner.full_name}</p>}</aside>
    </div>

    {request.student && <StudentContextDrawer open={showStudent} cohortId={request.cohort.id} studentId={request.student.id} source={source} onClose={() => setShowStudent(false)} />}
    <Modal open={showResolve} onClose={() => { if (!saving) setShowResolve(false) }} title="Respond and resolve" subtitle={`${request.student?.full_name} · ${request.context_label}`} size="md"><form className="space-y-4" onSubmit={resolve}><div className="rounded-xl bg-slate-50 p-3 text-sm leading-6 text-slate-700">{request.message}</div><div><label htmlFor="help-record-response" className="text-sm font-bold text-slate-900">Response visible to the student</label><textarea id="help-record-response" value={response} onChange={(event) => setResponse(event.target.value)} maxLength={2000} rows={6} required className="mt-2 w-full rounded-xl border border-slate-300 px-3.5 py-3 text-sm leading-6 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-200" /></div><Button type="submit" fullWidth disabled={!response.trim() || saving}><CheckCircle2 className="h-4 w-4" />{saving ? 'Sending…' : 'Send response and resolve'}</Button></form></Modal>
  </div>
}
