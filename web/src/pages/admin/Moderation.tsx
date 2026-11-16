import { useLocation } from 'react-router-dom'
import { SafetyPersonLink } from '../../components/admin/SafetyPersonLink'
import { useCallback, useEffect, useState } from 'react'
import { Ban, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Flag, History, MessageSquareText, RefreshCw, ShieldAlert, Trash2, XCircle } from 'lucide-react'
import { api } from '../../lib/api'
import { formatShortDateTime } from '../../lib/format'
import { urlParsers, useUrlParam } from '../../lib/useUrlState'
import { useToast } from '../../contexts/ToastContext'
import { EmptyState } from '../../components/shared/EmptyState'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { RecordLink } from '../../components/shared/RecordLink'
import { Button } from '../../components/ui/Button'
import { Avatar } from '../../components/ui/Avatar'
import { Badge } from '../../components/ui/Badge'
import { PageHeader } from '../../components/ui/PageHeader'
import { SegmentButton, SegmentedControl } from '../../components/ui/Choice'
import type { ContentReport, DataDeletionRequest, SafetyUserBlock } from '../../types/api'
import type { components } from '../../types/api.generated'
import { humanize } from '../../lib/glossary'

type PaginationMeta = components['schemas']['PaginationMeta']
type SafetyView = 'open' | 'resolved' | 'blocks'

// Open, resolved and blocks live in the URL (L-0.6), so Back and a copied link return to the same list and page.
const SAFETY_VIEW = urlParsers.oneOf(['open', 'resolved', 'blocks'] as const, 'open')
const SAFETY_PAGE = urlParsers.int(1, 10_000, 1)
const PER_PAGE = 25
/** The open queue is small; one request holds all of it. */
const OPEN_LIMIT = 100

const OUTCOMES: Record<string, string> = { actioned: 'Actioned', dismissed: 'Dismissed', completed: 'Completed', declined: 'Declined' }

export function Moderation() {
  const toast = useToast()
  const location = useLocation()
  const [view, setView] = useUrlParam('view', SAFETY_VIEW)
  const [page, setPage] = useUrlParam('page', SAFETY_PAGE)
  const returnTo = `${location.pathname}${location.search}`
  const [reports, setReports] = useState<ContentReport[]>([])
  const [reportMeta, setReportMeta] = useState<PaginationMeta | null>(null)
  const [blocks, setBlocks] = useState<SafetyUserBlock[]>([])
  const [blockMeta, setBlockMeta] = useState<PaginationMeta | null>(null)
  const [deletionRequests, setDeletionRequests] = useState<DataDeletionRequest[]>([])
  // A link (#report-12, from an alert) to a report that isn't in this list: shown pinned above it.
  const [linkedReport, setLinkedReport] = useState<ContentReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [deletionNotes, setDeletionNotes] = useState<Record<number, string>>({})

  const load = useCallback(async () => {
    setError(null)
    setLoading(true)
    if (view === 'blocks') {
      const result = await api.getSafetyUserBlocks({ page, per_page: PER_PAGE })
      if (result.data && !result.error) { setBlocks(result.data.user_blocks); setBlockMeta(result.data.meta) }
      else setError(result.error || 'Could not load blocks.')
    } else {
      const [reportResult, deletionResult] = await Promise.all([
        api.getContentReports(view === 'open' ? { view: 'open', per_page: OPEN_LIMIT } : { view: 'resolved', page, per_page: PER_PAGE }),
        api.getDataDeletionRequests(),
      ])
      if (!reportResult.data || !deletionResult.data) {
        setError(reportResult.error || deletionResult.error || 'Could not load Safety.')
      } else {
        setReports(reportResult.data.content_reports)
        setReportMeta(reportResult.data.meta)
        setDeletionRequests(deletionResult.data.data_deletion_requests)
      }
    }
    setLoading(false)
  }, [view, page])

  useEffect(() => { void load() }, [load])

  const hashReportId = /^#report-([0-9]+)$/.exec(location.hash)?.[1]
  useEffect(() => {
    if (loading || view === 'blocks' || !hashReportId) { setLinkedReport(null); return }
    const id = Number(hashReportId)
    if (reports.some((report) => report.id === id)) { setLinkedReport(null); return }
    let active = true
    void api.getContentReport(id).then((result) => { if (active) setLinkedReport(result.data?.content_report ?? null) })
    return () => { active = false }
  }, [loading, view, hashReportId, reports])

  useEffect(() => {
    if (loading || !/^#(?:report|deletion)-[0-9]+$/.test(location.hash)) return
    const item = document.getElementById(location.hash.slice(1))
    item?.scrollIntoView?.({ block: 'center' }); item?.focus({ preventScroll: true })
  }, [loading, location.hash, reports, deletionRequests, linkedReport])

  const changeView = (next: SafetyView) => { if (next !== view) { setView(next); setPage(1, { history: 'replace' }) } }

  const updateReport = async (report: ContentReport, status: 'reviewing' | 'actioned' | 'dismissed') => {
    const key = `report-${report.id}`
    setSavingKey(key)
    const result = await api.updateContentReport(report.id, status)
    setSavingKey(null)
    if (!result.data) return toast.error(result.error || 'Could not update the report.')
    const updated = result.data.content_report
    setReports((current) => current.map((item) => item.id === report.id ? updated : item))
    setLinkedReport((current) => current?.id === report.id ? updated : current)
    toast.success(status === 'reviewing' ? 'Marked as reviewing.' : `Report ${OUTCOMES[status].toLowerCase()}. It's in Resolved now.`)
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

  const openReports = reports.filter((report) => isOpen(report.status))
  const openDeletions = deletionRequests.filter((request) => isOpen(request.status))
  const resolvedDeletions = deletionRequests.filter((request) => !isOpen(request.status))
  const header = <>
    <PageHeader eyebrow="Trust & safety" title="Safety" description="Review community reports, account-deletion requests and blocks. Nothing here deletes source evidence on its own." />
    <SegmentedControl label="Safety view">
      <SegmentButton dense selected={view === 'open'} onClick={() => changeView('open')}><Flag className="h-4 w-4" aria-hidden="true" />Open</SegmentButton>
      <SegmentButton dense selected={view === 'resolved'} onClick={() => changeView('resolved')}><History className="h-4 w-4" aria-hidden="true" />Resolved</SegmentButton>
      <SegmentButton dense selected={view === 'blocks'} onClick={() => changeView('blocks')}><Ban className="h-4 w-4" aria-hidden="true" />Blocks</SegmentButton>
    </SegmentedControl>
  </>

  if (loading && !reports.length && !blocks.length && !deletionRequests.length) return <div className="app-page">{header}<LoadingSpinner message="Loading Safety…" /></div>
  if (error) return <div className="app-page">{header}<EmptyState icon={ShieldAlert} title="Could not load Safety" description={error} action={<Button onClick={() => void load()}><RefreshCw className="h-4 w-4" aria-hidden="true" />Try again</Button>} /></div>

  const reportCard = (report: ContentReport, pinned = false) => (
    <ReportCard key={report.id} report={report} returnTo={returnTo} pinned={pinned} saving={savingKey === `report-${report.id}`} onUpdate={(status) => void updateReport(report, status)} />
  )

  return (
    <div className="app-page">
      {header}

      {linkedReport && <section className="app-surface overflow-hidden" aria-label="Linked report">
        <p className="border-b border-line px-5 py-3 text-sm text-ink-secondary sm:px-6">{isOpen(linkedReport.status) ? 'The report you opened:' : 'The report you opened is already resolved:'}</p>
        {reportCard(linkedReport, true)}
      </section>}

      {view === 'blocks' ? <BlocksList blocks={blocks} meta={blockMeta} returnTo={returnTo} onPage={setPage} /> : view === 'open' ? <>
        <section className="app-surface overflow-hidden" aria-labelledby="safety-open-reports">
          <SectionHeading id="safety-open-reports" icon={Flag} title="Community reports" detail={`${openReports.length} waiting for action`} />
          {openReports.length ? <div className="divide-y divide-line">{openReports.map((report) => reportCard(report))}</div> : <EmptyState icon={CheckCircle2} title="No open community reports" description="New reports from students and staff appear here, and admins get a notification." />}
        </section>

        <section className="app-surface overflow-hidden" aria-labelledby="safety-open-deletions">
          <SectionHeading id="safety-open-deletions" icon={Trash2} title="Account-deletion requests" detail={`${openDeletions.length} waiting for action. Mark complete only after the deletion or anonymization work is finished.`} />
          {openDeletions.length ? <div className="divide-y divide-line">{openDeletions.map((request) => (
            <article key={request.id} id={`deletion-${request.id}`} tabIndex={-1} className="grid gap-4 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,1fr)]">
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><StatusPill status={request.status} /><span className="text-xs tabular-nums text-ink-muted">{formatShortDateTime(request.created_at)}</span></div><div className="mt-2 flex min-w-0 items-center gap-3"><Avatar name={request.user.full_name} size="md" /><div className="min-w-0"><h3 className="truncate text-base font-semibold text-ink" title={request.user.full_name}><SafetyPersonLink person={request.user} returnTo={`${returnTo}#deletion-${request.id}`} /></h3><p className="truncate text-sm text-ink-muted" title={request.user.email}>{request.user.email}</p></div></div><p className="mt-3 max-w-xl text-xs leading-5 text-ink-muted">Verify ownership and inventory the account, identity provider, learning records, files, messages, notifications, analytics, and vendor data before resolving.</p></div>
              <div>
                <label className="block text-sm font-semibold text-ink" htmlFor={`deletion-note-${request.id}`}>Resolution note</label>
                <textarea id={`deletion-note-${request.id}`} value={deletionNotes[request.id] || ''} onChange={(event) => setDeletionNotes((current) => ({ ...current, [request.id]: event.target.value }))} maxLength={2000} rows={3} placeholder="Required to complete or decline: what was deleted or anonymized, or why it was declined or kept." className="app-control mt-2 min-h-24 w-full leading-6" />
                <div className="mt-3 flex flex-wrap gap-2">
                  {request.status === 'pending' && <Button variant="secondary" disabled={savingKey === `deletion-${request.id}`} onClick={() => void updateDeletion(request, 'processing')}><Clock3 className="h-4 w-4" aria-hidden="true" />Begin processing</Button>}
                  {request.status === 'processing' && <Button disabled={savingKey === `deletion-${request.id}`} onClick={() => void updateDeletion(request, 'completed')}><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Mark completed</Button>}
                  <Button variant="secondary" disabled={savingKey === `deletion-${request.id}`} onClick={() => void updateDeletion(request, 'declined')}><XCircle className="h-4 w-4" aria-hidden="true" />Decline with reason</Button>
                </div>
              </div>
            </article>
          ))}</div> : <EmptyState icon={CheckCircle2} title="No open deletion requests" description="Students can ask from their profile or the public deletion page. Admins get a notification for each one." />}
        </section>
      </> : <>
        <section className="app-surface overflow-hidden" aria-labelledby="safety-resolved-reports">
          <SectionHeading id="safety-resolved-reports" icon={History} title="Resolved reports" detail={reportMeta ? `${reportMeta.total_count} resolved, most recent first` : undefined} />
          {reports.length ? <div className="divide-y divide-line">{reports.map((report) => reportCard(report))}</div> : <EmptyState icon={History} title="No resolved reports yet" description="Reports marked Actioned or Dismissed are kept here with who resolved them and when." />}
          {reportMeta && <Pager meta={reportMeta} label="Resolved reports" onPage={setPage} />}
        </section>

        <section className="app-surface overflow-hidden" aria-labelledby="safety-resolved-deletions">
          <SectionHeading id="safety-resolved-deletions" icon={Trash2} title="Resolved deletion requests" detail={`${resolvedDeletions.length} completed or declined`} />
          {resolvedDeletions.length ? <ul className="divide-y divide-line">{resolvedDeletions.map((request) => (
            <li key={request.id} id={`deletion-${request.id}`} tabIndex={-1} className="p-5 sm:p-6">
              <div className="flex flex-wrap items-center gap-2"><StatusPill status={request.status} /><span className="min-w-0 text-sm font-semibold text-ink [overflow-wrap:anywhere]"><SafetyPersonLink person={request.user} returnTo={`${returnTo}#deletion-${request.id}`} /></span></div>
              <p className="mt-1 text-xs tabular-nums text-ink-muted">{resolutionLine(OUTCOMES[request.status] || humanize(request.status), request.resolved_by?.full_name, request.resolved_at)} · asked {formatShortDateTime(request.created_at)}</p>
              {request.retention_note && <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink-secondary [overflow-wrap:anywhere]">{request.retention_note}</p>}
            </li>
          ))}</ul> : <EmptyState icon={Trash2} title="No resolved deletion requests" description="Completed and declined requests are kept here with their resolution note." />}
        </section>
      </>}
    </div>
  )
}

function ReportCard({ report, returnTo, pinned, saving, onUpdate }: { report: ContentReport; returnTo: string; pinned: boolean; saving: boolean; onUpdate: (status: 'reviewing' | 'actioned' | 'dismissed') => void }) {
  const open = isOpen(report.status)
  const back = `${returnTo}#report-${report.id}`
  const conversation = report.message?.conversation
  return (
    // The pinned copy only shows when the report isn't in the list, so the id stays unique.
    <article id={`report-${report.id}`} tabIndex={-1} className={`p-5 sm:p-6 ${pinned ? 'bg-surface-selected' : ''}`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><StatusPill status={report.status} /><Badge>{humanize(report.reason)}</Badge><span className="text-xs tabular-nums text-ink-muted">Reported {formatShortDateTime(report.created_at)}</span></div>
          <div className="mt-3 flex min-w-0 items-center gap-3"><Avatar name={report.reported_user.full_name} size="sm" /><h3 className="min-w-0 text-base font-semibold text-ink [overflow-wrap:anywhere]"><SafetyPersonLink person={report.reported_user} returnTo={back} /> reported by <SafetyPersonLink person={report.reporter} returnTo={back} /></h3></div>
          {report.message && <blockquote className="mt-3 whitespace-pre-wrap rounded-xl border border-line bg-surface-sunken px-4 py-3 text-sm leading-6 text-ink-secondary [overflow-wrap:anywhere]">{report.message.body || 'The message has an attachment or no text.'}</blockquote>}
          {conversation && <p className={`mt-2 flex min-w-0 gap-1.5 text-sm text-ink-secondary ${conversation.available ? 'items-center' : 'items-start'}`}>
            <MessageSquareText className={`h-4 w-4 shrink-0 text-ink-muted ${conversation.available ? '' : 'mt-0.5'}`} aria-hidden="true" />
            {conversation.available && conversation.destination
              ? <RecordLink record={conversation.kind === 'channel' ? { type: 'channel', id: Number(conversation.destination.id), messageId: report.message?.id } : { type: 'direct_conversation', id: Number(conversation.destination.id), messageId: report.message?.id }} returnLabel="Safety" variant="app" touchTarget className="min-w-0 [overflow-wrap:anywhere]">Open in {conversation.label}</RecordLink>
              : <span className="min-w-0 [overflow-wrap:anywhere]">Posted in {conversation.label}. {conversation.kind === 'dm' ? 'You’re not in this conversation, so it can’t be opened; the message is quoted above.' : 'You can’t open this class chat.'}</span>}
          </p>}
          {report.details && <p className="mt-3 text-sm leading-6 text-ink-secondary [overflow-wrap:anywhere]">{report.details}</p>}
          {!open && <p className="mt-3 text-xs font-semibold tabular-nums text-ink-muted">{resolutionLine(OUTCOMES[report.status] || humanize(report.status), report.reviewed_by?.full_name, report.resolved_at)}</p>}
        </div>
        {open && <div className="flex shrink-0 flex-wrap gap-2">
          {report.status === 'pending' && <Button variant="secondary" disabled={saving} onClick={() => onUpdate('reviewing')}><Clock3 className="h-4 w-4" aria-hidden="true" />Reviewing</Button>}
          <Button disabled={saving} onClick={() => onUpdate('actioned')}><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Actioned</Button>
          <Button variant="secondary" disabled={saving} onClick={() => onUpdate('dismissed')}><XCircle className="h-4 w-4" aria-hidden="true" />Dismiss</Button>
        </div>}
      </div>
    </article>
  )
}

function BlocksList({ blocks, meta, returnTo, onPage }: { blocks: SafetyUserBlock[]; meta: PaginationMeta | null; returnTo: string; onPage: (page: number) => void }) {
  return (
    <section className="app-surface overflow-hidden" aria-labelledby="safety-blocks">
      <SectionHeading id="safety-blocks" icon={Ban} title="Blocks" detail={`${meta?.total_count ?? blocks.length} in place. Read only: a block belongs to the person who made it, and only they can lift it.`} />
      {blocks.length ? <ul className="divide-y divide-line">{blocks.map((block) => (
        <li key={block.id} id={`block-${block.id}`} className="flex flex-col gap-1 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="min-w-0 text-sm text-ink [overflow-wrap:anywhere]"><span className="font-semibold"><SafetyPersonLink person={block.blocker} returnTo={returnTo} /></span>{block.blocker.archived && <span className="text-ink-muted"> (archived)</span>} blocked <span className="font-semibold"><SafetyPersonLink person={block.blocked_user} returnTo={returnTo} /></span>{block.blocked_user.archived && <span className="text-ink-muted"> (archived)</span>}</p>
          <span className="shrink-0 text-xs tabular-nums text-ink-muted">{formatShortDateTime(block.blocked_at)}</span>
        </li>
      ))}</ul> : <EmptyState icon={Ban} title="No blocks" description="When someone blocks another person, it's listed here." />}
      {meta && <Pager meta={meta} label="Blocks" onPage={onPage} />}
    </section>
  )
}

function SectionHeading({ id, icon: Icon, title, detail }: { id: string; icon: typeof Flag; title: string; detail?: string }) {
  return <div className="border-b border-line px-5 py-4 sm:px-6"><div className="flex items-center gap-2"><Icon className="h-4 w-4 text-ink-muted" aria-hidden="true" /><h2 id={id} className="text-lg font-bold text-ink">{title}</h2></div>{detail && <p className="mt-1 text-sm tabular-nums text-ink-muted">{detail}</p>}</div>
}

function Pager({ meta, label, onPage }: { meta: PaginationMeta; label: string; onPage: (page: number) => void }) {
  if (meta.total_pages <= 1) return null
  return (
    <nav aria-label={`${label} pages`} className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 sm:px-6">
      <Button variant="secondary" size="sm" disabled={!meta.has_prev_page} onClick={() => onPage(meta.page - 1)}><ChevronLeft className="h-4 w-4" aria-hidden="true" />Newer</Button>
      <span className="text-sm tabular-nums text-ink-muted">Page {meta.page} of {meta.total_pages}</span>
      <Button variant="secondary" size="sm" disabled={!meta.has_next_page} onClick={() => onPage(meta.page + 1)}>Older<ChevronRight className="h-4 w-4" aria-hidden="true" /></Button>
    </nav>
  )
}

function resolutionLine(outcome: string, by: string | null | undefined, at: string | null | undefined) {
  return [outcome, by ? `by ${by}` : null, at ? formatShortDateTime(at) : null].filter(Boolean).join(' · ')
}

function isOpen(status: string) {
  return status === 'pending' || status === 'processing' || status === 'reviewing'
}

function StatusPill({ status }: { status: string }) {
  return <Badge tone={isOpen(status) ? 'pending' : 'success'}>{humanize(status)}</Badge>
}
