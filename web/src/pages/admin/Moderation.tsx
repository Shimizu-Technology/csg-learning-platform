import { useLocation } from 'react-router-dom'
import { SafetyPersonLink } from '../../components/admin/SafetyPersonLink'
import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Clock3, Flag, RefreshCw, ShieldAlert, Trash2, XCircle } from 'lucide-react'
import { api } from '../../lib/api'
import { formatShortDateTime } from '../../lib/format'
import { useToast } from '../../contexts/ToastContext'
import { EmptyState } from '../../components/shared/EmptyState'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { Button } from '../../components/ui/Button'
import { Avatar } from '../../components/ui/Avatar'
import { Badge } from '../../components/ui/Badge'
import { PageHeader } from '../../components/ui/PageHeader'
import type { ContentReport, DataDeletionRequest } from '../../types/api'

export function Moderation() {
  const toast = useToast()
  const location = useLocation()
  const returnTo = `${location.pathname}${location.search}`
  const [reports, setReports] = useState<ContentReport[]>([])
  const [deletionRequests, setDeletionRequests] = useState<DataDeletionRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [deletionNotes, setDeletionNotes] = useState<Record<number, string>>({})

  const load = useCallback(async () => {
    setError(null)
    const [reportResult, deletionResult] = await Promise.all([api.getContentReports(), api.getDataDeletionRequests()])
    if (!reportResult.data || !deletionResult.data) {
      setError(reportResult.error || deletionResult.error || 'Could not load the safety queue.')
    } else {
      setReports(reportResult.data.content_reports)
      setDeletionRequests(deletionResult.data.data_deletion_requests)
    }
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (loading || !/^#(?:report|deletion)-[0-9]+$/.test(location.hash)) return
    const item = document.getElementById(location.hash.slice(1))
    item?.scrollIntoView({ block: 'center' }); item?.focus({ preventScroll: true })
  }, [loading, location.hash, reports, deletionRequests])

  const updateReport = async (report: ContentReport, status: 'reviewing' | 'actioned' | 'dismissed') => {
    const key = `report-${report.id}`
    setSavingKey(key)
    const result = await api.updateContentReport(report.id, status)
    setSavingKey(null)
    if (!result.data) return toast.error(result.error || 'Could not update the report.')
    setReports((current) => current.map((item) => item.id === report.id ? result.data!.content_report : item))
    toast.success('Report updated.')
  }

  const updateDeletion = async (request: DataDeletionRequest, status: 'processing' | 'completed' | 'declined') => {
    const note = deletionNotes[request.id]?.trim()
    if ((status === 'completed' || status === 'declined') && !note) {
      toast.error('Add a resolution note before completing or declining this request.')
      return
    }
    const key = `deletion-${request.id}`
    setSavingKey(key)
    const result = await api.updateDataDeletionRequest(request.id, { status, retention_note: note })
    setSavingKey(null)
    if (!result.data) return toast.error(result.error || 'Could not update the deletion request.')
    setDeletionRequests((current) => current.map((item) => item.id === request.id ? result.data!.data_deletion_request : item))
    toast.success('Deletion request updated.')
  }

  if (loading) return <LoadingSpinner message="Loading safety queue…" />
  if (error && !reports.length && !deletionRequests.length) return <EmptyState icon={ShieldAlert} title="Could not load the safety queue" description={error} action={<Button onClick={() => { setLoading(true); void load() }}><RefreshCw className="h-4 w-4" aria-hidden="true" />Try again</Button>} />

  const openReports = reports.filter((report) => report.status === 'pending' || report.status === 'reviewing')
  const openDeletions = deletionRequests.filter((request) => request.status === 'pending' || request.status === 'processing')

  return (
    <div className="app-page">
      <PageHeader eyebrow="Trust & safety" title="Safety queue" description="Review community reports and manage verified account-deletion work without erasing source evidence automatically." />

      <section className="app-surface overflow-hidden">
        <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
          <div className="min-w-0"><div className="flex items-center gap-2"><Flag className="h-4 w-4 text-ink-muted" aria-hidden="true" /><h2 className="text-lg font-bold text-ink">Community reports</h2></div><p className="mt-1 text-sm tabular-nums text-ink-muted">{openReports.length} awaiting action</p></div>
          <Button variant="secondary" onClick={() => { setLoading(true); void load() }}><RefreshCw className="h-4 w-4" aria-hidden="true" />Refresh</Button>
        </div>
        {openReports.length ? <div className="divide-y divide-line">{openReports.map((report) => (
          <article key={report.id} id={`report-${report.id}`} tabIndex={-1} className="p-5 sm:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><StatusPill status={report.status} /><Badge className="capitalize">{report.reason.replaceAll('_', ' ')}</Badge><span className="text-xs tabular-nums text-ink-muted">{formatShortDateTime(report.created_at)}</span></div>
                <div className="mt-3 flex min-w-0 items-center gap-3"><Avatar name={report.reported_user.full_name} size="sm" /><h3 className="min-w-0 text-base font-semibold text-ink [overflow-wrap:anywhere]"><SafetyPersonLink person={report.reported_user} returnTo={`${returnTo}#report-${report.id}`} /> reported by <SafetyPersonLink person={report.reporter} returnTo={`${returnTo}#report-${report.id}`} /></h3></div>
                {report.message && <blockquote className="mt-3 whitespace-pre-wrap rounded-xl border border-line bg-surface-sunken px-4 py-3 text-sm leading-6 text-ink-secondary [overflow-wrap:anywhere]">{report.message.body || 'Message contains an attachment or no text.'}</blockquote>}
                {report.details && <p className="mt-3 text-sm leading-6 text-ink-secondary [overflow-wrap:anywhere]">{report.details}</p>}
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {report.status === 'pending' && <Button variant="secondary" disabled={savingKey === `report-${report.id}`} onClick={() => void updateReport(report, 'reviewing')}><Clock3 className="h-4 w-4" aria-hidden="true" />Reviewing</Button>}
                <Button disabled={savingKey === `report-${report.id}`} onClick={() => void updateReport(report, 'actioned')}><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Actioned</Button>
                <Button variant="secondary" disabled={savingKey === `report-${report.id}`} onClick={() => void updateReport(report, 'dismissed')}><XCircle className="h-4 w-4" aria-hidden="true" />Dismiss</Button>
              </div>
            </div>
          </article>
        ))}</div> : <EmptyState icon={CheckCircle2} title="No open community reports" description="New reports from students and staff will appear here." />}
      </section>

      <section className="app-surface overflow-hidden">
        <div className="border-b border-line px-5 py-4 sm:px-6"><div className="flex items-center gap-2"><Trash2 className="h-4 w-4 text-ink-muted" aria-hidden="true" /><h2 className="text-lg font-bold text-ink">Account-deletion requests</h2></div><p className="mt-1 text-sm tabular-nums text-ink-muted">{openDeletions.length} awaiting action. Mark complete only after the underlying deletion or anonymization work is finished.</p></div>
        {openDeletions.length ? <div className="divide-y divide-line">{openDeletions.map((request) => (
          <article key={request.id} id={`deletion-${request.id}`} tabIndex={-1} className="grid gap-4 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,1fr)]">
            <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><StatusPill status={request.status} /><span className="text-xs tabular-nums text-ink-muted">{formatShortDateTime(request.created_at)}</span></div><div className="mt-2 flex min-w-0 items-center gap-3"><Avatar name={request.user.full_name} size="md" /><div className="min-w-0"><h3 className="truncate text-base font-semibold text-ink" title={request.user.full_name}><SafetyPersonLink person={request.user} returnTo={`${returnTo}#deletion-${request.id}`} /></h3><p className="truncate text-sm text-ink-muted" title={request.user.email}>{request.user.email}</p></div></div><p className="mt-3 max-w-xl text-xs leading-5 text-ink-muted">Verify ownership and inventory the account, identity provider, learning records, files, messages, notifications, analytics, and vendor data before resolving.</p></div>
            <div>
              <label className="block text-sm font-semibold text-ink" htmlFor={`deletion-note-${request.id}`}>Resolution note</label>
              <textarea id={`deletion-note-${request.id}`} value={deletionNotes[request.id] || ''} onChange={(event) => setDeletionNotes((current) => ({ ...current, [request.id]: event.target.value }))} maxLength={2000} rows={3} placeholder="Required to complete or decline: document what was deleted/anonymized or the specific retention/decline reason." className="app-control mt-2 min-h-24 w-full leading-6" />
              <div className="mt-3 flex flex-wrap gap-2">
                {request.status === 'pending' && <Button variant="secondary" disabled={savingKey === `deletion-${request.id}`} onClick={() => void updateDeletion(request, 'processing')}><Clock3 className="h-4 w-4" aria-hidden="true" />Begin processing</Button>}
                {request.status === 'processing' && <Button disabled={savingKey === `deletion-${request.id}`} onClick={() => void updateDeletion(request, 'completed')}><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Record completed</Button>}
                <Button variant="secondary" disabled={savingKey === `deletion-${request.id}`} onClick={() => void updateDeletion(request, 'declined')}><XCircle className="h-4 w-4" aria-hidden="true" />Decline with reason</Button>
              </div>
            </div>
          </article>
        ))}</div> : <EmptyState icon={CheckCircle2} title="No open deletion requests" description="Students can submit a request from their profile or the public deletion page." />}
      </section>
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const open = status === 'pending' || status === 'processing' || status === 'reviewing'
  return <Badge tone={open ? 'pending' : 'success'} className="capitalize">{status}</Badge>
}
