import { Activity, BookOpen, Files, Layers3, PlayCircle, UserRound } from 'lucide-react'
import { ReturnOrigin } from '../../../contexts/PreviewNavigationContext'
import { useAuthContext } from '../../../contexts/AuthContext'
import { RecordHeader } from '../../../components/shared/RecordHeader'
import { RelatedPanel } from '../../../components/shared/RelatedPanel'
import { RecordLink } from '../../../components/shared/RecordLink'
import { Badge } from '../../../components/ui/Badge'
import { useBackLink } from '../../../lib/recordOrigin'
import { useRecordDetail } from '../../../lib/recordDetail'
import { cohortPath, cohortStudentPath, recordPath, type RecordRef } from '../../../lib/routes'
import { formatShortDateTime } from '../../../lib/format'
import { humanize } from '../../../lib/glossary'
import { ACTIVITY_EVENT_LABELS } from '../../../lib/activityLabels'
import type { RelatedRow } from '../../../lib/recordRelated'
import type { ActivityEventDetail } from '../../../types/api'
import { DetailGate, Facts, RecordLayout, Section, useRouteId } from './RecordParts'

const CATEGORIES: Record<string, string> = { account: 'Sign-in', learning: 'Learning', work: 'Work and reviews', content: 'Content' }
const ROLES: Record<string, string> = { student: 'Learner', instructor: 'Instructor', admin: 'Admin' }

/** One activity event (L-5.2): what happened, who did it, when, and the record it is about. */
export function ActivityEventRecord() {
  const state = useRecordDetail('activity_event', useRouteId())
  return <DetailGate state={state} label="activity" icon={Activity}>{(detail) => <EventPage key={detail.id} detail={detail} />}</DetailGate>
}

/** The record an event is about, as a registry reference. */
function subjectRef(record: NonNullable<ActivityEventDetail['record']>): RecordRef {
  if (record.kind === 'submission') return { type: 'submission', id: record.id, cohortId: record.cohort_id, userId: record.student_id, lessonId: record.lesson_id, contentBlockId: record.content_block_id }
  if (record.kind === 'recording') return { type: 'recording', id: record.id, cohortId: record.cohort_id }
  return { type: 'lesson', id: record.id, cohortId: record.cohort_id }
}

function EventPage({ detail }: { detail: ActivityEventDetail }) {
  const { user } = useAuthContext()
  const { cohort, actor, subject, record } = detail
  const label = humanize(detail.event_type, ACTIVITY_EVENT_LABELS)
  // School activity is admin-only; instructors fall back to the cohort's Activity tab.
  const parent = user?.is_admin ? { returnTo: '/admin/activity', returnLabel: 'Activity' } : cohort ? { returnTo: cohortPath(cohort.id, 'activity'), returnLabel: 'Activity' } : { returnTo: '/admin', returnLabel: 'Today' }
  const back = useBackLink(parent)
  const learner = subject.role === 'student' && cohort
  const ref = record ? subjectRef(record) : null
  const RecordIcon = record?.kind === 'submission' ? Files : record?.kind === 'recording' ? PlayCircle : BookOpen
  const rows: RelatedRow[] = [
    ...(record && ref ? [{ key: 'record', icon: RecordIcon, label: record.kind === 'submission' ? 'Submission' : record.kind === 'recording' ? 'Recording' : 'Lesson', value: detail.record_label, to: recordPath(ref, { viewer: user }) }] : []),
    ...(learner ? [{ key: 'student', icon: UserRound, label: 'Student page', value: subject.name, to: cohortStudentPath(cohort.id, subject.id, 'activity') }] : []),
    ...(cohort ? [{ key: 'cohort', icon: Layers3, label: 'Cohort activity', value: cohort.name, to: cohortPath(cohort.id, 'activity') }] : []),
  ]
  const person = (who: ActivityEventDetail['actor']) => who.role === 'student' && cohort
    ? <RecordLink record={{ type: 'student', id: who.id, cohortId: cohort.id }} variant="plain">{who.name}</RecordLink>
    : <RecordLink record={{ type: 'staff', id: who.id }} variant="plain">{who.name}</RecordLink>

  return <ReturnOrigin label={`Activity · ${label}`}><div className="app-page-wide space-y-6">
    <RecordHeader
      back={back}
      breadcrumb={[...(cohort ? [{ label: cohort.name, to: cohortPath(cohort.id) }] : []), { label: 'Activity', to: parent.returnTo }, { label }]}
      type={<span>Activity{detail.category ? ` · ${CATEGORIES[detail.category] || humanize(detail.category)}` : ''}</span>}
      title={detail.record_label ? `${label} · ${detail.record_label}` : label}
      titleText={detail.record_label ? `${label} · ${detail.record_label}` : label}
      status={detail.evidence === 'player_reported' ? <Badge>Player reported</Badge> : undefined}
      context={<>
        <span>{person(subject)}</span>
        <span aria-hidden="true">·</span>
        <time dateTime={detail.created_at} className="tabular-nums">{formatShortDateTime(detail.created_at)}</time>
        {cohort && <><span aria-hidden="true">·</span><RecordLink record={{ type: 'cohort', id: cohort.id, tab: 'activity' }} variant="plain" touchTarget className="font-normal text-ink-muted">{cohort.name}</RecordLink></>}
      </>}
    />

    <RecordLayout related={<RelatedPanel rows={rows} returnLabel={`Activity · ${label}`} />}>
      <Section id="overview" title="What happened">
        <Facts items={[
          { label: 'Event', value: label },
          { label: 'When', value: <span className="tabular-nums">{formatShortDateTime(detail.created_at)}</span> },
          { label: actor.id === subject.id ? 'Who' : 'For', value: <>{person(subject)} <span className="text-ink-muted">· {ROLES[subject.role] || humanize(subject.role)}</span></> },
          actor.id !== subject.id && { label: 'Done by', value: <>{person(actor)} <span className="text-ink-muted">· {ROLES[actor.role] || humanize(actor.role)}</span></> },
          { label: 'Cohort', value: cohort ? <RecordLink record={{ type: 'cohort', id: cohort.id }} variant="plain">{cohort.name}</RecordLink> : 'None' },
          { label: 'Linked to', value: record && ref ? <RecordLink record={ref} variant="plain">{detail.record_label}</RecordLink> : detail.record_label ? `${detail.record_label} · No longer available` : 'Nothing else' },
          { label: 'Recorded by', value: detail.evidence === 'player_reported' ? "The video player. It doesn't show attention." : 'The app' },
        ]} />
      </Section>
    </RecordLayout>
  </div></ReturnOrigin>
}
