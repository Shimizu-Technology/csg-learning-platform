import { useLocation } from 'react-router-dom'
import { SafetyPersonLink } from '../../components/admin/SafetyPersonLink'
import { useCallback, useEffect, useState } from 'react'
import { Ban, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Flag, History, MessageSquareText, RefreshCw, ShieldAlert, Trash2, UserRound, X, XCircle } from 'lucide-react'
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
// One person's reports and blocks (L-3.2), from a student or team member page.
const SAFETY_PERSON = urlParsers.id()
const PER_PAGE = 25

const OUTCOMES: Record<string, string> = { actioned: 'Actioned', dismissed: 'Dismissed', completed: 'Completed', declined: 'Declined' }

export function Moderation() {
  const toast = useToast()
  const location = useLocation()
  const [view, setView] = useUrlParam('view', SAFETY_VIEW)
  const [page, setPage] = useUrlParam('page', SAFETY_PAGE)
  const [personId, setPersonId] = useUrlParam('person_id', SAFETY_PERSON)
  const [person, setPerson] = useState<{ id: number; full_name: string } | null>(null)
  const returnTo = `${location.pathname}${location.search}`
  const [reports, setReports] = useState<ContentReport[]>([])
  const [reportMeta, setReportMeta] = useState<PaginationMeta | null>(null)
  const [blocks, setBlocks] = useState<SafetyUserBlock[]>([])
  const [blockMeta, setBlockMeta] = useState<PaginationMeta | null>(null)
  const [deletionRequests, setDeletionRequests] = useState<DataDeletionRequest[]>([])
  // A link (#report-12 or #deletion-4, from an alert) to a record that isn't in this list or page: shown pinned above it.
  const [linkedReport, setLinkedReport] = useState<ContentReport | null>(null)
  const [linkedDeletion, setLinkedDeletion] = useState<DataDeletionRequest | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [reportNotes, setReportNotes] = useState<Record<number, string>>({})
  const [deletionNotes, setDeletionNotes] = useState<Record<number, string>>({})

  const load = useCallback(async () => {
    setError(null)
    setLoading(true)
    const userId = personId ?? undefined
    if (view === 'blocks') {
      const result = await api.getSafetyUserBlocks({ page, per_page: PER_PAGE, user_id: userId })
      if (result.data && !result.error) { setBlocks(result.data.user_blocks); setBlockMeta(result.data.meta); setPerson(result.data.person ?? null) }
      else setError(result.error || 'Could not load blocks.')
    } else {
      const [reportResult, deletionResult] = await Promise.all([
        api.getContentReports({ view, page, per_page: PER_PAGE, user_id: userId }),
        api.getDataDeletionRequests(),
      ])
      if (!reportResult.data || !deletionResult.data) {
        setError(reportResult.error || deletionResult.error || 'Could not load Safety.')
      } else {
        setReports(reportResult.data.content_reports)
        setReportMeta(reportResult.data.meta)
        setPerson(reportResult.data.person ?? null)
        setDeletionRequests(deletionResult.data.data_deletion_requests)
      }
    }
    setLoading(false)
  }, [view, page, personId])

  useEffect(() => { void load() }, [load])

  // Each pin depends on whether its record is shown, not on the list itself, so
  // acting on a pinned record doesn't fetch it again.
  const hashReportId = /^#report-([0-9]+)$/.exec(location.hash)?.[1]
  const linkedReportShown = reports.some((report) => report.id === Number(hashReportId))
  useEffect(() => {
    if (loading || view === 'blocks' || !hashReportId || linkedReportShown) { setLinkedReport(null); return }
    let active = true
    void api.getContentReport(Number(hashReportId)).then((result) => { if (active) setLinkedReport(result.data?.content_report ?? null) })
    return () => { active = false }
  }, [loading, view, hashReportId, linkedReportShown])

  // The deletion list holds the 200 newest, split by view, so an alert's request
  // can be missing (resolved by another admin, or older). Fetch it by id instead.
  const hashDeletionId = /^#deletion-([0-9]+)$/.exec(location.hash)?.[1]
  const linkedDeletionShown = deletionRequests.some((request) => request.id === Number(hashDeletionId) && isOpen(request.status) === (view === 'open'))
  useEffect(() => {
    if (loading || view === 'blocks' || !hashDeletionId || linkedDeletionShown) { setLinkedDeletion(null); return }
    let active = true
    void api.getDataDeletionRequest(Number(hashDeletionId)).then((result) => { if (active) setLinkedDeletion(result.data?.data_deletion_request ?? null) })
    return () => { active = false }
  }, [loading, view, hashDeletionId, linkedDeletionShown])

  useEffect(() => {
    if (loading || !/^#(?:report|deletion)-[0-9]+$/.test(location.hash)) return
    const item = document.getElementById(location.hash.slice(1))
    item?.scrollIntoView?.({ block: 'center' }); item?.focus({ preventScroll: true })
  }, [loading, location.hash, reports, deletionRequests, linkedReport, linkedDeletion])

  const changeView = (next: SafetyView) => { if (next !== view) { setView(next); setPage(1, { history: 'replace' }) } }
  const clearPerson = () => { setPersonId(null); setPage(1, { history: 'replace' }) }

  const updateReport = async (report: ContentReport, status: 'reviewing' | 'actioned' | 'dismissed') => {
    const note = reportNotes[report.id]?.trim()
    if ((status === 'actioned' || status === 'dismissed') && !note) {
      toast.error('Add a resolution note explaining what action was taken or why this report was dismissed.')
      return
    }
    const key = `report-${report.id}`
    setSavingKey(key)
    const result = await api.updateContentReport(report.id, status, note || undefined)
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
    const updated = result.data.data_deletion_request
    setDeletionRequests((current) => current.map((item) => item.id === request.id ? updated : item))
    setLinkedDeletion((current) => current?.id === request.id ? updated : current)
    toast.success('Deletion request updated.')
  }

  const openReports = reports.filter((report) => isOpen(report.status))
  // The server's count of the whole queue, less any this page has just resolved.
  const openReportCount = reportMeta ? Math.max(0, reportMeta.total_count - (reports.length - openReports.length)) : openReports.length
  const openDeletions = deletionRequests.filter((request) => isOpen(request.status))
  const resolvedDeletions = deletionRequests.filter((request) => !isOpen(request.status))
  const header = <>
    <PageHeader eyebrow="Trust & safety" title="Safety" description="Review community reports, account-deletion requests and blocks. Nothing here deletes source evidence on its own." />
    <SegmentedControl label="Safety view">
      <SegmentButton dense selected={view === 'open'} onClick={() => changeView('open')}><Flag className="h-4 w-4" aria-hidden="true" />Open</SegmentButton>
      <SegmentButton dense selected={view === 'resolved'} onClick={() => changeView('resolved')}><History className="h-4 w-4" aria-hidden="true" />Resolved</SegmentButton>
      <SegmentButton dense selected={view === 'blocks'} onClick={() => changeView('blocks')}><Ban className="h-4 w-4" aria-hidden="true" />Blocks</SegmentButton>
    </SegmentedControl>
    {personId && <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface-sunken px-4 py-2 text-sm text-ink-secondary" role="status">
      <UserRound className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{person ? <>Showing reports and blocks involving <span className="font-semibold text-ink">{person.full_name}</span>.</> : loading ? 'Loading this person…' : 'No one has this id, so nothing is listed.'}</span>
      <Button variant="secondary" size="sm" onClick={clearPerson}><X className="h-4 w-4" aria-hidden="true" />Show everyone</Button>
    </div>}
  </>

  if (loading && !reports.length && !blocks.length && !deletionRequests.length) return <div className="app-page">{header}<LoadingSpinner message="Loading Safety…" /></div>
  if (error) return <div className="app-page">{header}<EmptyState icon={ShieldAlert} title="Could not load Safety" description={error} action={<Button onClick={() => void load()}><RefreshCw className="h-4 w-4" aria-hidden="true" />Try again</Button>} /></div>

  const reportCard = (report: ContentReport, pinned = false) => (
    <ReportCard
      key={report.id}
      report={report}
      returnTo={returnTo}
      pinned={pinned}
      note={reportNotes[report.id] ?? report.resolution_note ?? ''}
      onNote={(note) => setReportNotes((current) => ({ ...current, [report.id]: note }))}
      saving={savingKey === `report-${report.id}`}
      onUpdate={(status) => void updateReport(report, status)}
    />
  )
  const openDeletionCard = (request: DataDeletionRequest, pinned = false) => (
    <OpenDeletionCard key={request.id} request={request} returnTo={returnTo} pinned={pinned} note={deletionNotes[request.id] || ''}
      onNote={(note) => setDeletionNotes((current) => ({ ...current, [request.id]: note }))}
      saving={savingKey === `deletion-${request.id}`} onUpdate={(status) => void updateDeletion(request, status)} />
  )

  return (
    <div className="app-page">
      {header}

      {linkedReport && <section className="app-surface overflow-hidden" aria-label="Linked report">
        <p className="border-b border-line px-5 py-3 text-sm text-ink-secondary sm:px-6">{isOpen(linkedReport.status) ? 'The report you opened:' : 'The report you opened is already resolved:'}</p>
        {reportCard(linkedReport, true)}
      </section>}

      {linkedDeletion && <section className="app-surface overflow-hidden" aria-label="Linked deletion request">
        <p className="border-b border-line px-5 py-3 text-sm text-ink-secondary sm:px-6">{isOpen(linkedDeletion.status) ? 'The deletion request you opened:' : 'The deletion request you opened is already resolved:'}</p>
        {isOpen(linkedDeletion.status) ? openDeletionCard(linkedDeletion, true) : <ResolvedDeletion request={linkedDeletion} returnTo={returnTo} pinned />}
      </section>}

      {view === 'blocks' ? <BlocksList blocks={blocks} meta={blockMeta} returnTo={returnTo} onPage={setPage} /> : view === 'open' ? <>
        <section className="app-surface overflow-hidden" aria-labelledby="safety-open-reports">
          <SectionHeading id="safety-open-reports" icon={Flag} title="Community reports" detail={`${openReportCount} waiting for action, oldest first`} />
          {openReports.length ? <div className="divide-y divide-line">{openReports.map((report) => reportCard(report))}</div> : <EmptyState icon={CheckCircle2} title="No open community reports" description="New reports from students and staff appear here, and admins get a notification." />}
          {reportMeta && <Pager meta={reportMeta} label="Open reports" previous="Earlier" next="Later" onPage={setPage} />}
        </section>

        <section className="app-surface overflow-hidden" aria-labelledby="safety-open-deletions">
          <SectionHeading id="safety-open-deletions" icon={Trash2} title="Account-deletion requests" detail={`${openDeletions.length} waiting for action. Mark complete only after the deletion or anonymization work is finished.`} />
          {openDeletions.length ? <div className="divide-y divide-line">{openDeletions.map((request) => openDeletionCard(request))}</div> : <EmptyState icon={CheckCircle2} title="No open deletion requests" description="Students can ask from their profile or the public deletion page. Admins get a notification for each one." />}
        </section>
      </> : <>
        <section className="app-surface overflow-hidden" aria-labelledby="safety-resolved-reports">
          <SectionHeading id="safety-resolved-reports" icon={History} title="Resolved reports" detail={reportMeta ? `${reportMeta.total_count} resolved, most recent first` : undefined} />
          {reports.length ? <div className="divide-y divide-line">{reports.map((report) => reportCard(report))}</div> : <EmptyState icon={History} title="No resolved reports yet" description="Reports marked Actioned or Dismissed are kept here with who resolved them and when." />}
          {reportMeta && <Pager meta={reportMeta} label="Resolved reports" onPage={setPage} />}
        </section>

        <section className="app-surface overflow-hidden" aria-labelledby="safety-resolved-deletions">
          <SectionHeading id="safety-resolved-deletions" icon={Trash2} title="Resolved deletion requests" detail={`${resolvedDeletions.length} completed or declined`} />
          {resolvedDeletions.length ? <ul className="divide-y divide-line">{resolvedDeletions.map((request) => <li key={request.id}><ResolvedDeletion request={request} returnTo={returnTo} /></li>)}</ul> : <EmptyState icon={Trash2} title="No resolved deletion requests" description="Completed and declined requests are kept here with their resolution note." />}
        </section>
      </>}
    </div>
  )
}

function ReportCard({ report, returnTo, pinned, note, onNote, saving, onUpdate }: { report: ContentReport; returnTo: string; pinned: boolean; note: string; onNote: (note: string) => void; saving: boolean; onUpdate: (status: 'reviewing' | 'actioned' | 'dismissed') => void }) {
  const open = isOpen(report.status)
  const back = `${returnTo}#report-${report.id}`
  const conversation = report.message?.conversation
  return (
    // The pinned copy only shows when the report isn't in the list, so the id stays unique.
    <article id={`report-${report.id}`} tabIndex={-1} className={`p-5 sm:p-6 ${pinned ? 'bg-surface-selected' : ''}`}>
      <div className={open ? 'grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,1fr)]' : 'flex flex-col gap-4'}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><StatusPill status={report.status} /><Badge>{humanize(report.reason)}</Badge><span className="text-xs tabular-nums text-ink-muted">Reported {formatShortDateTime(report.created_at)}</span><RecordLink record={{ type: 'content_report', id: report.id }} returnLabel="Safety" variant="app" touchTarget peek={false} className="text-xs" aria-label={`Open report #${report.id}: ${report.reported_user.full_name} reported by ${report.reporter.full_name}`}>Open report</RecordLink></div>
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
          {!open && report.resolution_note && (
            <div className="mt-2 rounded-xl border border-line bg-surface-sunken px-4 py-3 text-sm leading-6 text-ink-secondary [overflow-wrap:anywhere]">
              <span className="block text-xs font-semibold text-ink-muted">Resolution note</span>
              <p className="mt-0.5 whitespace-pre-wrap">{report.resolution_note}</p>
            </div>
          )}
        </div>
        {open && <div className="space-y-3">
          <div>
            <label className="block text-sm font-semibold text-ink" htmlFor={`report-note-${report.id}`}>Resolution note</label>
            <textarea
              id={`report-note-${report.id}`}
              value={note}
              onChange={(event) => onNote(event.target.value)}
              maxLength={2000}
              rows={2}
              placeholder="Required for Actioned or Dismissed: what action was taken, or why it was dismissed."
              className="app-control mt-1.5 min-h-20 w-full leading-6"
            />
            <p className="mt-1 text-xs leading-5 text-ink-muted">Recording a resolution updates this report only. It leaves the message and accounts unchanged.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {report.status === 'pending' && <Button variant="secondary" disabled={saving} onClick={() => onUpdate('reviewing')}><Clock3 className="h-4 w-4" aria-hidden="true" />Reviewing</Button>}
            <Button disabled={saving} onClick={() => onUpdate('actioned')}><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Actioned</Button>
            <Button variant="secondary" disabled={saving} onClick={() => onUpdate('dismissed')}><XCircle className="h-4 w-4" aria-hidden="true" />Dismiss</Button>
          </div>
        </div>}
      </div>
    </article>
  )
}

function OpenDeletionCard({ request, returnTo, pinned, note, onNote, saving, onUpdate }: { request: DataDeletionRequest; returnTo: string; pinned: boolean; note: string; onNote: (note: string) => void; saving: boolean; onUpdate: (status: 'processing' | 'completed' | 'declined') => void }) {
  return (
    // The pinned copy only shows when the request isn't in the list, so the id stays unique.
    <article id={`deletion-${request.id}`} tabIndex={-1} className={`grid gap-4 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,1fr)] ${pinned ? 'bg-surface-selected' : ''}`}>
      <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><StatusPill status={request.status} /><span className="text-xs tabular-nums text-ink-muted">{formatShortDateTime(request.created_at)}</span></div><div className="mt-2 flex min-w-0 items-center gap-3"><Avatar name={request.user.full_name} size="md" /><div className="min-w-0"><h3 className="truncate text-base font-semibold text-ink" title={request.user.full_name}><SafetyPersonLink person={request.user} returnTo={`${returnTo}#deletion-${request.id}`} /></h3><p className="truncate text-sm text-ink-muted" title={request.user.email}>{request.user.email}</p></div></div><p className="mt-3 max-w-xl text-xs leading-5 text-ink-muted">Verify ownership and inventory the account, identity provider, learning records, files, messages, notifications, analytics, and vendor data before resolving.</p></div>
      <div>
        <label className="block text-sm font-semibold text-ink" htmlFor={`deletion-note-${request.id}`}>Resolution note</label>
        <textarea id={`deletion-note-${request.id}`} value={note} onChange={(event) => onNote(event.target.value)} maxLength={2000} rows={3} placeholder="Required to complete or decline: what was deleted or anonymized, or why it was declined or kept." className="app-control mt-2 min-h-24 w-full leading-6" />
        <div className="mt-3 flex flex-wrap gap-2">
          {request.status === 'pending' && <Button variant="secondary" disabled={saving} onClick={() => onUpdate('processing')}><Clock3 className="h-4 w-4" aria-hidden="true" />Begin processing</Button>}
          {request.status === 'processing' && <Button disabled={saving} onClick={() => onUpdate('completed')}><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Mark completed</Button>}
          <Button variant="secondary" disabled={saving} onClick={() => onUpdate('declined')}><XCircle className="h-4 w-4" aria-hidden="true" />Decline with reason</Button>
        </div>
      </div>
    </article>
  )
}

function ResolvedDeletion({ request, returnTo, pinned = false }: { request: DataDeletionRequest; returnTo: string; pinned?: boolean }) {
  return (
    <article id={`deletion-${request.id}`} tabIndex={-1} className={`p-5 sm:p-6 ${pinned ? 'bg-surface-selected' : ''}`}>
      <div className="flex flex-wrap items-center gap-2"><StatusPill status={request.status} /><span className="min-w-0 text-sm font-semibold text-ink [overflow-wrap:anywhere]"><SafetyPersonLink person={request.user} returnTo={`${returnTo}#deletion-${request.id}`} /></span></div>
      <p className="mt-1 text-xs tabular-nums text-ink-muted">{resolutionLine(OUTCOMES[request.status] || humanize(request.status), request.resolved_by?.full_name, request.resolved_at)} · asked {formatShortDateTime(request.created_at)}</p>
      {request.retention_note && <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink-secondary [overflow-wrap:anywhere]">{request.retention_note}</p>}
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

function Pager({ meta, label, onPage, previous = 'Newer', next = 'Older' }: { meta: PaginationMeta; label: string; onPage: (page: number) => void; previous?: string; next?: string }) {
  if (meta.total_pages <= 1) return null
  return (
    <nav aria-label={`${label} pages`} className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 sm:px-6">
      <Button variant="secondary" size="sm" disabled={!meta.has_prev_page} onClick={() => onPage(meta.page - 1)}><ChevronLeft className="h-4 w-4" aria-hidden="true" />{previous}</Button>
      <span className="text-sm tabular-nums text-ink-muted">Page {meta.page} of {meta.total_pages}</span>
      <Button variant="secondary" size="sm" disabled={!meta.has_next_page} onClick={() => onPage(meta.page + 1)}>{next}<ChevronRight className="h-4 w-4" aria-hidden="true" /></Button>
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
