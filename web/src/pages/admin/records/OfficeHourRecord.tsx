import { CalendarClock, CalendarDays, ExternalLink, Layers3, PencilLine, UserRound, Users } from 'lucide-react'
import { ReturnOrigin } from '../../../contexts/PreviewNavigationContext'
import { RecordHeader } from '../../../components/shared/RecordHeader'
import { RelatedPanel, scrollToSection } from '../../../components/shared/RelatedPanel'
import { RecordLink } from '../../../components/shared/RecordLink'
import { Badge } from '../../../components/ui/Badge'
import { AnchorButton, LinkButton } from '../../../components/ui/Button'
import { useBackLink } from '../../../lib/recordOrigin'
import { useRecordDetail } from '../../../lib/recordDetail'
import { cohortPath } from '../../../lib/routes'
import { plural } from '../../../lib/recordUsage'
import { formatDateTimeRange } from '../../../lib/format'
import { sanitizeUrl } from '../../../lib/sanitizeUrl'
import { TERMS } from '../../../lib/glossary'
import type { RelatedRow } from '../../../lib/recordRelated'
import type { OfficeHourDetail } from '../../../types/api'
import { DetailGate, EmptyRow, Facts, RecordLayout, Section, useRouteId } from './RecordParts'

/** An office-hour or live-class session's staff page (L-5.2). */
export function OfficeHourRecord() {
  const state = useRecordDetail('office_hour', useRouteId())
  return <DetailGate state={state} label="session" icon={CalendarClock} fallback={{ returnTo: '/admin/cohorts', returnLabel: 'Cohorts' }}>{(detail) => <OfficeHourPage key={detail.id} detail={detail} />}</DetailGate>
}

function OfficeHourPage({ detail }: { detail: OfficeHourDetail }) {
  const { cohort } = detail
  const kind = detail.event_kind === 'live_class' ? TERMS.liveClass : TERMS.officeHours
  const back = useBackLink({ returnTo: cohortPath(cohort.id, 'schedule'), returnLabel: `${cohort.name} · Schedule` })
  const next = detail.upcoming[0]
  const rows: RelatedRow[] = [
    { key: 'cohort', icon: Layers3, label: TERMS.cohort, value: cohort.name, to: cohortPath(cohort.id) },
    { key: 'schedule', icon: CalendarDays, label: 'Cohort schedule', to: cohortPath(cohort.id, 'schedule') },
    { key: 'team', icon: UserRound, label: 'Teaching team', count: detail.teaching_team.length, onSelect: () => scrollToSection('people') },
    { key: 'invited', icon: Users, label: 'Invited learners', count: detail.invited_count, to: cohortPath(cohort.id, 'students') },
  ]

  return <ReturnOrigin label={`${kind} · ${detail.title}`}><div className="app-page-wide space-y-6">
    <RecordHeader
      back={back}
      breadcrumb={[{ label: cohort.name, to: cohortPath(cohort.id) }, { label: 'Schedule', to: cohortPath(cohort.id, 'schedule') }, { label: detail.title }]}
      type={<span>{kind}{detail.recurrence === 'weekly' ? ' · Weekly' : ''}</span>}
      title={detail.title}
      titleText={detail.title}
      status={detail.active ? (next ? undefined : <Badge>Ended</Badge>) : <Badge>Off</Badge>}
      context={<>
        <RecordLink record={{ type: 'cohort', id: cohort.id }} variant="plain" touchTarget>{cohort.name}</RecordLink>
        <span aria-hidden="true">·</span>
        <span className="tabular-nums">{next ? `Next ${formatDateTimeRange(next.starts_at, next.ends_at, '', detail.timezone)}` : formatDateTimeRange(detail.starts_at, detail.ends_at, '', detail.timezone)}</span>
      </>}
      actions={<>
        {detail.active && next && <AnchorButton href={sanitizeUrl(detail.meeting_url)} target="_blank" rel="noopener noreferrer" variant="primary" size="sm"><ExternalLink className="h-4 w-4" aria-hidden="true" />Join</AnchorButton>}
        {detail.can_edit && <LinkButton to={cohortPath(cohort.id, 'schedule')} size="sm" variant="secondary"><PencilLine className="h-4 w-4" aria-hidden="true" />Edit in schedule</LinkButton>}
      </>}
    />

    <RecordLayout related={<RelatedPanel rows={rows} returnLabel={`${kind} · ${detail.title}`} />}>
      <Section id="overview" title="When it meets">
        <Facts items={[
          { label: detail.recurrence === 'weekly' ? 'First session' : 'Time', value: <span className="tabular-nums">{formatDateTimeRange(detail.starts_at, detail.ends_at, 'Not scheduled', detail.timezone)}</span> },
          { label: 'Repeats', value: detail.recurrence === 'weekly' ? 'Every week' : 'Once' },
          { label: 'Join link', value: <a href={sanitizeUrl(detail.meeting_url)} target="_blank" rel="noopener noreferrer" className="app-link inline-flex min-h-11 items-center break-all sm:min-h-0">{detail.meeting_url}</a> },
          detail.description ? { label: 'Description', value: <span className="whitespace-pre-wrap">{detail.description}</span> } : null,
        ]} />
        {detail.upcoming.length > 0 && <div className="border-t border-line px-4 py-3 sm:px-5">
          <h3 className="text-xs font-semibold text-ink-muted">Coming up</h3>
          <ul className="mt-2 space-y-1">
            {detail.upcoming.map((time) => <li key={time.starts_at} className="text-sm tabular-nums text-ink">{formatDateTimeRange(time.starts_at, time.ends_at, '', detail.timezone)}</li>)}
          </ul>
        </div>}
      </Section>

      <Section id="people" title="Who's involved">
        <Facts items={[
          { label: 'Scheduled by', value: detail.scheduled_by ? <RecordLink record={{ type: 'staff', id: detail.scheduled_by.id }} variant="plain">{detail.scheduled_by.name}</RecordLink> : 'Unknown' },
          { label: 'Invited', value: <RecordLink record={{ type: 'cohort', id: cohort.id, tab: 'students' }} variant="plain">{plural(detail.invited_count, 'active learner')} in {cohort.name}</RecordLink> },
        ]} />
        <div className="border-t border-line">
          <h3 className="px-4 pt-3 text-xs font-semibold text-ink-muted sm:px-5">Teaching team</h3>
          {detail.teaching_team.length ? <ul className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-2 sm:px-5">
            {detail.teaching_team.map((person) => <li key={person.id}><RecordLink record={{ type: 'staff', id: person.id }} variant="plain" touchTarget>{person.name}</RecordLink></li>)}
          </ul> : <EmptyRow>No instructors are assigned to <RecordLink record={{ type: 'cohort', id: cohort.id, tab: 'team' }} variant="inline">{cohort.name}</RecordLink>.</EmptyRow>}
        </div>
        <p className="border-t border-line px-4 py-3 text-xs text-ink-muted sm:px-5">The app doesn't track who joins a session, so this lists who is invited.</p>
      </Section>
    </RecordLayout>
  </div></ReturnOrigin>
}
