import { Activity, Hash, Layers3, MessageSquare, Settings, ShieldCheck, Users } from 'lucide-react'
import { ReturnOrigin } from '../../../contexts/PreviewNavigationContext'
import { RecordHeader } from '../../../components/shared/RecordHeader'
import { RelatedPanel, scrollToSection } from '../../../components/shared/RelatedPanel'
import { RecordLink } from '../../../components/shared/RecordLink'
import { Badge } from '../../../components/ui/Badge'
import { LinkButton } from '../../../components/ui/Button'
import { useBackLink } from '../../../lib/recordOrigin'
import { useRecordDetail } from '../../../lib/recordDetail'
import { cohortPath, conversationPath } from '../../../lib/routes'
import { plural } from '../../../lib/recordUsage'
import { formatShortDateTime } from '../../../lib/format'
import type { RelatedRow } from '../../../lib/recordRelated'
import { TERMS } from '../../../lib/glossary'
import type { ChannelDetail } from '../../../types/api'
import { DetailGate, EmptyRow, Facts, RecordLayout, Section, useRouteId } from './RecordParts'

/** A channel as a cohort record (L-5.2): who's in it, recent activity, and the way into Messages. */
export function ChannelRecord() {
  const state = useRecordDetail('channel', useRouteId())
  return <DetailGate state={state} label="conversation" icon={Hash}>{(detail) => <ChannelPage key={detail.id} detail={detail} />}</DetailGate>
}

function ChannelPage({ detail }: { detail: ChannelDetail }) {
  const { cohort } = detail
  const staffOnly = detail.visibility === 'staff_only'
  const kind = staffOnly ? 'Staff-only conversation' : cohort ? TERMS.classChat : 'Group conversation'
  const messages = conversationPath({ type: 'channel', id: detail.id }, { cohortId: cohort?.id })
  const back = useBackLink(cohort ? { returnTo: cohortPath(cohort.id, 'communication'), returnLabel: `${cohort.name} · Communication` } : { returnTo: '/messages', returnLabel: TERMS.messages })
  const learners = detail.members.count - detail.members.staff_count
  const rows: RelatedRow[] = [
    ...(cohort ? [{ key: 'cohort', icon: Layers3, label: TERMS.cohort, value: cohort.name, to: cohortPath(cohort.id) }] : []),
    { key: 'messages', icon: MessageSquare, label: `Open in ${TERMS.messages}`, count: detail.activity.messages_count, to: messages },
    { key: 'members', icon: Users, label: 'Members', count: detail.members.count, ...(detail.members.list ? { onSelect: () => scrollToSection('members') } : cohort ? { to: cohortPath(cohort.id, 'students') } : {}) },
    { key: 'activity', icon: Activity, label: 'Messages in the last 7 days', count: detail.activity.last_7_days, onSelect: () => scrollToSection('activity') },
    ...(cohort && detail.can_manage ? [{ key: 'settings', icon: Settings, label: 'Conversation settings', to: cohortPath(cohort.id, 'communication') }] : []),
  ]

  return <ReturnOrigin label={`#${detail.name}`}><div className="app-page-wide space-y-6">
    <RecordHeader
      back={back}
      breadcrumb={[...(cohort ? [{ label: cohort.name, to: cohortPath(cohort.id) }, { label: 'Communication', to: cohortPath(cohort.id, 'communication') }] : [{ label: detail.workspace.name }]), { label: `#${detail.name}` }]}
      type={<span>{kind}</span>}
      title={`#${detail.name}`}
      titleText={detail.name}
      status={<>
        {staffOnly && <Badge icon={<ShieldCheck className="h-3 w-3" aria-hidden="true" />}>Staff only</Badge>}
        {detail.status === 'archived' && <Badge>Archived</Badge>}
      </>}
      context={<>
        {cohort ? <RecordLink record={{ type: 'cohort', id: cohort.id }} variant="plain" touchTarget>{cohort.name}</RecordLink> : <span>{detail.workspace.name}</span>}
        <span aria-hidden="true">·</span>
        <span className="tabular-nums">{plural(detail.members.count, 'member')}</span>
        {detail.activity.last_message_at && <><span aria-hidden="true">·</span><span className="tabular-nums">Last message {formatShortDateTime(detail.activity.last_message_at)}</span></>}
      </>}
      actions={<LinkButton to={messages} size="sm"><MessageSquare className="h-4 w-4" aria-hidden="true" />Open in {TERMS.messages}</LinkButton>}
    />

    <RecordLayout related={<RelatedPanel rows={rows} returnLabel={`#${detail.name}`} />}>
      <Section id="overview" title="About this conversation">
        <Facts items={[
          { label: 'Who can read it', value: staffOnly ? 'Staff on this cohort and admins' : cohort ? `Everyone in ${cohort.name}` : `Members of ${detail.workspace.name}` },
          { label: 'Members', value: <span className="tabular-nums">{plural(learners, 'learner')}, {detail.members.staff_count} staff</span> },
          detail.description ? { label: 'Description', value: detail.description } : null,
        ]} />
      </Section>

      <Section id="activity" title="Recent activity" count={`${detail.activity.last_7_days} this week`}>
        {detail.activity.recent.length ? <ul className="divide-y divide-line">
          {detail.activity.recent.map((message) => (
            <li key={message.id} className="flex min-h-14 gap-3 px-4 py-2 sm:px-5">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 text-xs text-ink-muted">
                  <span className="font-semibold text-ink">{message.author.name}</span>
                  <time dateTime={message.created_at} className="tabular-nums">{formatShortDateTime(message.created_at)}</time>
                </p>
                <p className={`mt-0.5 truncate text-sm ${message.hidden ? 'italic text-ink-muted' : 'text-ink-secondary'}`} title={message.hidden ? undefined : message.preview}>{message.preview}</p>
              </div>
              <RecordLink record={{ type: 'channel', id: detail.id, messageId: message.id }} variant="app" touchTarget className="shrink-0 self-center text-xs" aria-label={`Open the message from ${message.author.name} in ${TERMS.messages}`}>Open</RecordLink>
            </li>
          ))}
        </ul> : <EmptyRow>No messages yet.</EmptyRow>}
      </Section>

      <Section id="members" title="Members" count={String(detail.members.count)}>
        {detail.members.list ? <>
          <ul className="grid gap-x-4 sm:grid-cols-2">
            {detail.members.list.map((member) => (
              <li key={member.id} className="flex min-h-11 items-center gap-2 border-b border-line px-4 sm:px-5">
                {member.role === 'student' && cohort
                  ? <RecordLink record={{ type: 'student', id: member.id, cohortId: cohort.id }} variant="plain" truncate>{member.name}</RecordLink>
                  : <RecordLink record={{ type: 'staff', id: member.id }} variant="plain" truncate>{member.name}</RecordLink>}
                {member.role !== 'student' && <Badge>{member.role === 'admin' ? 'Admin' : 'Instructor'}</Badge>}
              </li>
            ))}
          </ul>
          {detail.members.count > detail.members.list.length && <p className="px-4 py-3 text-xs text-ink-muted sm:px-5">Showing {detail.members.list.length} of {detail.members.count}.</p>}
        </> : <p className="px-4 py-4 text-sm text-ink-secondary sm:px-5">
          {plural(learners, 'learner')} and {detail.members.staff_count} staff are in this conversation.{cohort ? <> See who they are on <RecordLink record={{ type: 'cohort', id: cohort.id, tab: 'students' }} variant="inline">{cohort.name}'s Students tab</RecordLink>.</> : null}
        </p>}
      </Section>
    </RecordLayout>
  </div></ReturnOrigin>
}
