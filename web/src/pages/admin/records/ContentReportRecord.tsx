import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Ban, CheckCircle2, Clock3, Flag, MessageSquareText, ShieldAlert, UserRound, XCircle } from 'lucide-react'
import { ReturnOrigin } from '../../../contexts/PreviewNavigationContext'
import { useToast } from '../../../contexts/ToastContext'
import { SafetyPersonLink } from '../../../components/admin/SafetyPersonLink'
import { RecordHeader } from '../../../components/shared/RecordHeader'
import { RelatedPanel, scrollToSection } from '../../../components/shared/RelatedPanel'
import { RecordLink } from '../../../components/shared/RecordLink'
import { Badge } from '../../../components/ui/Badge'
import { Button } from '../../../components/ui/Button'
import { api } from '../../../lib/api'
import { useBackLink } from '../../../lib/recordOrigin'
import { useRecordDetail } from '../../../lib/recordDetail'
import { conversationPath, safetyPersonPath } from '../../../lib/routes'
import { plural } from '../../../lib/recordUsage'
import { formatShortDateTime } from '../../../lib/format'
import { humanize } from '../../../lib/glossary'
import type { RelatedRow } from '../../../lib/recordRelated'
import type { ContentReportDetail, PersonSafety } from '../../../types/api'
import { DetailGate, EmptyRow, Facts, RecordLayout, Section, useRouteId } from './RecordParts'

const OPEN = new Set(['pending', 'reviewing'])
const OUTCOMES: Record<string, string> = { actioned: 'Actioned', dismissed: 'Dismissed' }

/**
 * One community report on Safety (L-5.2 moderation item, admins): why it was
 * reported, the quoted message and where it was posted, who resolved it, the
 * other reports about the same person and any block between the two. The
 * server answers 404 for everyone but admins.
 */
export function ContentReportRecord() {
  const state = useRecordDetail('content_report', useRouteId())
  return <DetailGate state={state} label="report" icon={Flag} fallback={{ returnTo: '/admin/moderation', returnLabel: 'Safety' }}>{(detail) => <ReportPage key={detail.id} detail={detail} onChanged={state.reload} />}</DetailGate>
}

function ReportPage({ detail, onChanged }: { detail: ContentReportDetail; onChanged: () => Promise<void> }) {
  const toast = useToast()
  const location = useLocation()
  const back = useBackLink({ returnTo: `/admin/moderation${OPEN.has(detail.status) ? '' : '?view=resolved'}#report-${detail.id}`, returnLabel: 'Safety' })
  const [saving, setSaving] = useState(false)
  const [resolutionNote, setResolutionNote] = useState(detail.resolution_note || '')
  const here = `${location.pathname}${location.search}`
  const { reporter, reported_user: reported, message } = detail
  const open = OPEN.has(detail.status)
  const conversation = message?.conversation
  const label = `Report #${detail.id}`

  async function update(status: 'reviewing' | 'actioned' | 'dismissed') {
    const trimmed = resolutionNote.trim()
    setSaving(true)
    const result = trimmed
      ? await api.updateContentReport(detail.id, status, trimmed)
      : await api.updateContentReport(detail.id, status)
    setSaving(false)
    if (!result.data) { toast.error(result.error || 'Could not update the report.'); return }
    toast.success(status === 'reviewing' ? 'Marked as reviewing.' : `Report ${OUTCOMES[status].toLowerCase()}.`)
    await onChanged()
  }

  const blockLine = (blockerId: number) => blockerId === reporter.id ? `${reporter.name} blocked ${reported.name}` : `${reported.name} blocked ${reporter.name}`
  const rows: RelatedRow[] = [
    ...(conversation ? [{ key: 'conversation', icon: MessageSquareText, label: conversation.kind === 'channel' ? 'Class chat' : 'Direct conversation', value: conversation.available ? 'Open' : 'Can’t open', to: conversation.available && conversation.destination && message ? conversationPath({ type: conversation.kind, id: Number(conversation.destination.id) }, { messageId: message.id }) : null }] : []),
    { key: 'about', icon: ShieldAlert, label: `Reports about ${reported.name}`, count: detail.reported_user_safety.reports_about, attention: detail.reported_user_safety.open_reports_about > 1, to: safetyPersonPath(reported.id) },
    { key: 'others', icon: Flag, label: 'Other reports', count: detail.other_reports_count, onSelect: () => scrollToSection('other-reports') },
    { key: 'blocks', icon: Ban, label: 'Blocks between them', count: detail.blocks_between.length, onSelect: () => scrollToSection('people') },
  ]

  return <ReturnOrigin label={label}><div className="app-page-wide space-y-6">
    <RecordHeader
      back={back}
      breadcrumb={[{ label: 'Safety', to: '/admin/moderation' }, { label }]}
      type={<span>Community report · {humanize(detail.reason)}</span>}
      title={`${reporter.name} reported ${message ? `a message from ${reported.name}` : reported.name}`}
      titleText={`${reporter.name} reported ${reported.name}`}
      status={<Badge tone={open ? 'pending' : 'success'}>{humanize(detail.status)}</Badge>}
      context={<>
        <span className="tabular-nums">Reported {formatShortDateTime(detail.created_at)}</span>
        {!open && <><span aria-hidden="true">·</span><span className="tabular-nums">{[OUTCOMES[detail.status] || humanize(detail.status), detail.reviewed_by ? `by ${detail.reviewed_by.name}` : null, detail.resolved_at ? formatShortDateTime(detail.resolved_at) : null].filter(Boolean).join(' · ')}</span></>}
      </>}
      actions={open ? <div className="flex flex-wrap gap-2">
        {detail.status === 'pending' && <Button variant="secondary" size="sm" disabled={saving} onClick={() => void update('reviewing')}><Clock3 className="h-4 w-4" aria-hidden="true" />Reviewing</Button>}
        <Button size="sm" disabled={saving} onClick={() => void update('actioned')}><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Actioned</Button>
        <Button variant="secondary" size="sm" disabled={saving} onClick={() => void update('dismissed')}><XCircle className="h-4 w-4" aria-hidden="true" />Dismiss</Button>
      </div> : null}
    />

    <RecordLayout related={<RelatedPanel rows={rows} returnLabel={label} />}>
      <Section id="report" title="What was reported">
        {message ? <div className="space-y-2 px-4 py-4 sm:px-5">
          <blockquote className="whitespace-pre-wrap rounded-xl border border-line bg-surface-sunken px-4 py-3 text-sm leading-6 text-ink-secondary [overflow-wrap:anywhere]">{message.body || 'The message has an attachment or no text.'}</blockquote>
          <p className="flex flex-wrap gap-x-2 text-xs tabular-nums text-ink-muted">
            <span>Posted {formatShortDateTime(message.created_at)}</span>
            {message.reply && <span>· a reply in a thread</span>}
            {message.attachments_count > 0 && <span>· {plural(message.attachments_count, 'attachment')}</span>}
            {message.deleted && <span>· since deleted</span>}
          </p>
          {conversation && <p className={`flex min-w-0 gap-1.5 text-sm text-ink-secondary ${conversation.available ? 'items-center' : 'items-start'}`}>
            <MessageSquareText className={`h-4 w-4 shrink-0 text-ink-muted ${conversation.available ? '' : 'mt-0.5'}`} aria-hidden="true" />
            {conversation.available && conversation.destination
              ? <RecordLink record={conversation.kind === 'channel' ? { type: 'channel', id: Number(conversation.destination.id), messageId: message.id } : { type: 'direct_conversation', id: Number(conversation.destination.id), messageId: message.id }} returnLabel={label} variant="app" touchTarget className="min-w-0 [overflow-wrap:anywhere]">Open in {conversation.label}</RecordLink>
              : <span className="min-w-0 [overflow-wrap:anywhere]">Posted in {conversation.label}. {conversation.kind === 'dm' ? 'You’re not in this conversation, so it can’t be opened; the message is quoted above.' : 'You can’t open this class chat.'}</span>}
          </p>}
        </div> : <EmptyRow>This report is about the person, not one message.</EmptyRow>}
        <Facts items={[
          { label: 'Reason', value: humanize(detail.reason) },
          detail.details ? { label: 'What the reporter said', value: <span className="whitespace-pre-wrap">{detail.details}</span> } : null,
          !open && detail.resolution_note ? { label: 'Resolution note', value: <span className="whitespace-pre-wrap">{detail.resolution_note}</span> } : null,
        ]} />
      </Section>

      {open && (
        <Section id="resolution" title="Resolution">
          <div className="space-y-3 px-4 py-4 sm:px-5">
            <div>
              <label htmlFor={`report-record-note-${detail.id}`} className="block text-sm font-semibold text-ink">
                Resolution note
              </label>
              <textarea
                id={`report-record-note-${detail.id}`}
                value={resolutionNote}
                onChange={(event) => setResolutionNote(event.target.value)}
                maxLength={2000}
                rows={3}
                placeholder="Describe what action was taken or why this report was dismissed so other admins have context."
                className="app-control mt-2 min-h-24 w-full leading-6"
              />
              <p className="mt-1.5 text-xs leading-5 text-ink-muted">
                Saved on this report only. It leaves the message and user accounts unchanged.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {detail.status === 'pending' && <Button variant="secondary" size="sm" disabled={saving} onClick={() => void update('reviewing')}><Clock3 className="h-4 w-4" aria-hidden="true" />Reviewing</Button>}
              <Button size="sm" disabled={saving} onClick={() => void update('actioned')}><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Actioned</Button>
              <Button variant="secondary" size="sm" disabled={saving} onClick={() => void update('dismissed')}><XCircle className="h-4 w-4" aria-hidden="true" />Dismiss</Button>
            </div>
          </div>
        </Section>
      )}

      <Section id="people" title="People">
        <ul className="divide-y divide-line">
          <PersonRow role="Reported" person={reported} safety={detail.reported_user_safety} returnTo={here} />
          <PersonRow role="Reported by" person={reporter} safety={detail.reporter_safety} returnTo={here} />
        </ul>
        <p className="border-t border-line px-4 py-3 text-sm text-ink-secondary sm:px-5">{detail.blocks_between.length
          ? detail.blocks_between.map((block) => `${blockLine(block.blocker_id)} on ${formatShortDateTime(block.created_at)}.`).join(' ')
          : 'Neither has blocked the other.'}</p>
      </Section>

      <Section id="other-reports" title={`Other reports about ${reported.name}`} count={detail.other_reports_count > detail.other_reports.length ? `Newest ${detail.other_reports.length} of ${detail.other_reports_count}` : String(detail.other_reports_count)}>
        {detail.other_reports.length ? <ul className="divide-y divide-line">
          {detail.other_reports.map((other) => (
            <li key={other.id} className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 sm:px-5">
              <RecordLink record={{ type: 'content_report', id: other.id }} variant="plain" touchTarget className="font-semibold" aria-label={`Report #${other.id} by ${other.reporter.name}`}>{humanize(other.reason)}</RecordLink>
              <span className="text-sm text-ink-secondary">by {other.reporter.name}</span>
              <Badge tone={OPEN.has(other.status) ? 'pending' : 'success'}>{humanize(other.status)}</Badge>
              <time dateTime={other.created_at} className="ml-auto text-xs tabular-nums text-ink-muted">{formatShortDateTime(other.created_at)}</time>
            </li>
          ))}
        </ul> : <EmptyRow>No other reports about {reported.name}.</EmptyRow>}
        {detail.other_reports_count > detail.other_reports.length && <p className="border-t border-line px-4 py-3 text-xs text-ink-muted sm:px-5"><Link className="app-link inline-flex min-h-11 items-center sm:min-h-0" to={safetyPersonPath(reported.id)}>See all reports about {reported.name} on Safety</Link></p>}
      </Section>
    </RecordLayout>
  </div></ReturnOrigin>
}

function PersonRow({ role, person, safety, returnTo }: { role: string; person: ContentReportDetail['reporter']; safety: PersonSafety; returnTo: string }) {
  return <li className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
    <div className="flex min-w-0 items-center gap-2">
      <UserRound className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
      <span className="text-xs font-semibold text-ink-muted">{role}</span>
      <span className="min-w-0 text-sm font-semibold text-ink [overflow-wrap:anywhere]"><SafetyPersonLink person={{ id: person.id, full_name: person.name, role: person.role }} returnTo={returnTo} returnLabel="Report" /></span>
      {person.archived && <Badge>Archived</Badge>}
    </div>
    <p className="text-xs tabular-nums text-ink-muted">
      <Link className="app-link inline-flex min-h-11 items-center sm:min-h-0" to={safetyPersonPath(person.id)} aria-label={`${person.name} on Safety: ${safetyLine(safety)}`}>{safetyLine(safety)}</Link>
    </p>
  </li>
}

function safetyLine(safety: PersonSafety) {
  return [plural(safety.reports_about, 'report about them', 'reports about them'), plural(safety.reports_by, 'report filed', 'reports filed'), plural(safety.blocks_made, 'block made', 'blocks made'), `blocked by ${safety.blocked_by}`].join(' · ')
}

