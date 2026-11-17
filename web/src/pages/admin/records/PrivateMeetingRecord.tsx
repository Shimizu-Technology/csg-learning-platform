import { CalendarCheck, CalendarDays, ExternalLink, History, Layers3, MessageSquare, UserRound } from 'lucide-react'
import { ReturnOrigin } from '../../../contexts/PreviewNavigationContext'
import { RecordHeader } from '../../../components/shared/RecordHeader'
import { RelatedPanel, scrollToSection } from '../../../components/shared/RelatedPanel'
import { RecordLink } from '../../../components/shared/RecordLink'
import { Badge } from '../../../components/ui/Badge'
import { AnchorButton, LinkButton } from '../../../components/ui/Button'
import { useBackLink } from '../../../lib/recordOrigin'
import { useRecordDetail } from '../../../lib/recordDetail'
import { cohortPath, cohortStudentPath } from '../../../lib/routes'
import { formatDateTimeRange, formatShortDateTime } from '../../../lib/format'
import { sanitizeUrl } from '../../../lib/sanitizeUrl'
import { TERMS } from '../../../lib/glossary'
import type { RelatedRow } from '../../../lib/recordRelated'
import type { PrivateMeetingDetail } from '../../../types/api'
import { DetailGate, EmptyRow, Facts, RecordLayout, Section, useRouteId } from './RecordParts'

const ACTIONS: Record<string, string> = { booked: 'Booked', rescheduled: 'Moved', link_updated: 'Changed the meeting link', canceled: 'Canceled' }

/** A private-meeting booking's staff page (L-5.2). The learner keeps their booking on My meetings. */
export function PrivateMeetingRecord() {
  const state = useRecordDetail('private_meeting', useRouteId())
  return <DetailGate state={state} label="meeting" icon={CalendarCheck}>{(detail) => <MeetingPage key={detail.id} detail={detail} />}</DetailGate>
}

/** Meetings, focused on this booking's cohort, week and card. */
function meetingsPath(detail: PrivateMeetingDetail) {
  return `/admin/meetings?cohort_id=${detail.cohort.id}&booking_id=${detail.id}&week=${detail.week_number}`
}

function MeetingPage({ detail }: { detail: PrivateMeetingDetail }) {
  const { cohort, student, host } = detail
  const canceled = detail.status === 'canceled'
  const title = `Meeting with ${student.name}`
  const back = useBackLink({ returnTo: '/admin/meetings', returnLabel: TERMS.meetings })
  const studentPage = cohortStudentPath(cohort.id, student.id, 'communication')
  const rows: RelatedRow[] = [
    { key: 'student', icon: UserRound, label: 'Student page', value: student.name, to: cohortStudentPath(cohort.id, student.id) },
    { key: 'cohort', icon: Layers3, label: TERMS.cohort, value: cohort.name, to: cohortPath(cohort.id) },
    { key: 'conversation', icon: MessageSquare, label: 'Conversation', value: detail.direct_conversation_id ? 'Open' : 'None yet', to: detail.direct_conversation_id ? `/messages/dm/${detail.direct_conversation_id}?cohort_id=${cohort.id}` : studentPage },
    { key: 'meetings', icon: CalendarDays, label: `Week ${detail.week_number} in ${TERMS.meetings}`, to: meetingsPath(detail) },
    { key: 'history', icon: History, label: 'History', count: detail.history.length, onSelect: () => scrollToSection('history') },
  ]

  return <ReturnOrigin label={title}><div className="app-page-wide space-y-6">
    <RecordHeader
      back={back}
      breadcrumb={[{ label: cohort.name, to: cohortPath(cohort.id) }, { label: student.name, to: cohortStudentPath(cohort.id, student.id) }, { label: 'Meeting' }]}
      type={<span>Meeting · Week {detail.week_number}</span>}
      title={title}
      titleText={title}
      status={canceled ? <Badge tone="danger">Canceled</Badge> : <Badge tone="success">Booked</Badge>}
      context={<>
        <span className="tabular-nums">{formatDateTimeRange(detail.starts_at, detail.ends_at, '', detail.timezone)}</span>
        <span aria-hidden="true">·</span>
        <span>with <RecordLink record={{ type: 'staff', id: host.id }} variant="plain">{host.name}</RecordLink></span>
      </>}
      actions={<>
        {!canceled && detail.zoom_url && <AnchorButton href={sanitizeUrl(detail.zoom_url)} target="_blank" rel="noopener noreferrer" variant="primary" size="sm"><ExternalLink className="h-4 w-4" aria-hidden="true" />Join</AnchorButton>}
        <LinkButton to={meetingsPath(detail)} size="sm" variant="secondary"><CalendarDays className="h-4 w-4" aria-hidden="true" />{canceled ? 'Open in Meetings' : 'Move or cancel'}</LinkButton>
      </>}
    />

    <RecordLayout related={<RelatedPanel rows={rows} returnLabel={title} />}>
      <Section id="overview" title="Details">
        <Facts items={[
          { label: 'Student', value: <RecordLink record={{ type: 'student', id: student.id, cohortId: cohort.id }} variant="plain">{student.name}</RecordLink> },
          { label: 'Host', value: <RecordLink record={{ type: 'staff', id: host.id }} variant="plain">{host.name}</RecordLink> },
          { label: 'Time', value: <span className="tabular-nums">{formatDateTimeRange(detail.starts_at, detail.ends_at, '', detail.timezone)}</span> },
          { label: 'Status', value: canceled ? 'Canceled' : 'Booked' },
          { label: 'Meeting link', value: detail.zoom_url ? <a href={sanitizeUrl(detail.zoom_url)} target="_blank" rel="noopener noreferrer" className="app-link inline-flex min-h-11 items-center break-all sm:min-h-0">{detail.zoom_url}</a> : 'Not added yet' },
          { label: 'Student changes', value: detail.reschedule_count ? `Moved ${detail.reschedule_count} ${detail.reschedule_count === 1 ? 'time' : 'times'}` : 'Not moved' },
        ]} />
      </Section>

      <Section id="history" title="History" count={String(detail.history.length)}>
        <p className="border-b border-line px-4 py-2 text-xs text-ink-muted sm:px-5">Bookings don't have notes. Each change is recorded here.</p>
        {detail.history.length ? <ol className="divide-y divide-line">
          {detail.history.map((event, index) => (
            <li key={`${event.created_at}-${index}`} className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 sm:px-5">
              <span className="font-semibold text-ink">{ACTIONS[event.action] || 'Updated'}</span>
              {event.previous_starts_at && <span className="text-sm tabular-nums text-ink-secondary">from {formatShortDateTime(event.previous_starts_at, '', detail.timezone)}</span>}
              <span className="text-sm text-ink-muted">by {event.actor.name}</span>
              <time dateTime={event.created_at} className="ml-auto text-xs tabular-nums text-ink-muted">{formatShortDateTime(event.created_at, '', detail.timezone)}</time>
            </li>
          ))}
        </ol> : <EmptyRow>No changes recorded yet.</EmptyRow>}
      </Section>
    </RecordLayout>
  </div></ReturnOrigin>
}
